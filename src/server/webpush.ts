import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";
import { siteOrigin } from "@/lib/config";
import { derivedKey } from "./crypto";

/*
 * Web push, the standard way a home-screen app is sent a notification, written out here rather than
 * pulled in as a package:
 *  - The site has one key pair (VAPID, RFC 8292). Its private half is worked out from the encryption key,
 *    so there's no new secret to keep, and a push service only accepts notes signed with it.
 *  - Each note is encrypted for the one device (RFC 8291, "aes128gcm"), so Apple or Google pass it along
 *    without being able to read it.
 *  - Notes only ever go to the push services of Apple, Google, Mozilla and Microsoft, never to an address
 *    someone typed in.
 */

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };

const b64u = (b: Buffer) => b.toString("base64url");

/** The site's push key pair, from the encryption key. The public half goes to browsers that subscribe. */
let cached: { publicKey: Buffer; privateKey: Buffer } | null = null;
export function vapidKeys(): { publicKey: Buffer; privateKey: Buffer } {
  if (cached) return cached;
  for (let i = 0; ; i++) {
    // A private key must be below the curve's order; the odds a 32-byte value isn't are about 1 in 4 billion.
    const privateKey = derivedKey(`web-push vapid ${i}`);
    try {
      const ecdh = createECDH("prime256v1");
      ecdh.setPrivateKey(privateKey);
      return (cached = { publicKey: ecdh.getPublicKey(), privateKey });
    } catch {
      if (i > 8) throw new Error("Couldn’t make a push key.");
    }
  }
}

/** For tests: forget the key pair (after changing the encryption key). */
export function resetVapidKeys() {
  cached = null;
}

export function vapidPublicKey(): string {
  return b64u(vapidKeys().publicKey);
}

/** The push services browsers use. Anything else is refused, so the server never posts to an address of someone's choosing. */
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function isPushEndpoint(url: string): boolean {
  if (url.length > 1000) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.port === "" && !u.username && !u.password && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}

/** True when the keys a browser sent are the right shape: a P-256 public key and a 16-byte secret. */
export function isPushKeys(keys: { p256dh: string; auth: string }): boolean {
  try {
    const p = Buffer.from(keys.p256dh, "base64url");
    const a = Buffer.from(keys.auth, "base64url");
    if (p.length !== 65 || p[0] !== 4 || a.length !== 16) return false;
    // A point that isn't on the curve can't be used to encrypt to.
    const probe = createECDH("prime256v1");
    probe.generateKeys();
    probe.computeSecret(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypts a note for one device (RFC 8291). `salt` and `serverPrivate` are only passed by tests, to
 * check against the RFC's worked example; normally both are new for every note.
 */
export function encryptPayload(plain: Buffer, keys: { p256dh: string; auth: string }, fixed?: { salt: Buffer; serverPrivate: Buffer }): Buffer {
  const uaPublic = Buffer.from(keys.p256dh, "base64url");
  const authSecret = Buffer.from(keys.auth, "base64url");
  const ecdh = createECDH("prime256v1");
  if (fixed) ecdh.setPrivateKey(fixed.serverPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = fixed?.salt ?? randomBytes(16);

  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // One record: the note, then the "last record" mark (2).
  const body = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

/** HKDF-SHA-256 (extract then expand), written out so the steps can be read against the RFC. */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

/** The signed note (a JWT) that tells a push service this site is allowed to send to its devices. */
export function vapidHeader(endpoint: string, now: Date = new Date()): string {
  const { publicKey, privateKey } = vapidKeys();
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
        // Apple asks for a way to reach whoever runs the site: the site's own address, never a person's email.
        sub: siteOrigin() ?? "https://passbook.invalid",
      }),
    ),
  );
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: b64u(privateKey), x: b64u(publicKey.subarray(1, 33)), y: b64u(publicKey.subarray(33)) }, format: "jwk" });
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${b64u(publicKey)}`;
}

export type PushNote = { title: string; body: string; url: string; tag?: string };

export type PushResult = "sent" | "gone" | "failed";

/**
 * Sends one note to one device. "gone" means the device no longer takes notes (turned off, app removed):
 * its subscription should be forgotten.
 */
export async function sendPush(target: PushTarget, note: PushNote, options: { ttl?: number; urgency?: "normal" | "high" } = {}, fetchImpl: typeof fetch = fetch): Promise<PushResult> {
  if (!isPushEndpoint(target.endpoint) || !isPushKeys(target.keys)) return "gone";
  const body = encryptPayload(Buffer.from(JSON.stringify(note)), target.keys);
  try {
    const response = await fetchImpl(target.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidHeader(target.endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(options.ttl ?? 24 * 3600),
        Urgency: options.urgency ?? "normal",
      },
      body: new Uint8Array(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    // Nothing a push service says back is needed, so it isn't read.
    await response.body?.cancel().catch(() => {});
    if (response.status === 404 || response.status === 410) return "gone";
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
