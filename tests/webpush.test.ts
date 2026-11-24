import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptPayload, isPushEndpoint, isPushKeys, sendPush, vapidHeader, vapidPublicKey } from "@/server/webpush";

process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");

const b = (s: string) => Buffer.from(s, "base64url");

// RFC 8291, Appendix A: the worked example of an encrypted push message.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** What a phone does with a note: the RFC's steps from the device's side. */
function decrypt(body: Buffer, uaPrivate: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(asPublic);
  const h = (salt: Buffer, ikm: Buffer, info: Buffer, n: number) => createHmac("sha256", createHmac("sha256", salt).update(ikm).digest()).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, n);
  const ikm = h(authSecret, shared, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const cek = h(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = h(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const data = body.subarray(21 + idlen);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(data.subarray(data.length - 16));
  const padded = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  expect(padded[padded.length - 1]).toBe(2);
  return padded.subarray(0, padded.length - 1).toString();
}

describe("web push", () => {
  it("encrypts exactly as RFC 8291's worked example", () => {
    const out = encryptPayload(Buffer.from(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, { salt: b(RFC.salt), serverPrivate: b(RFC.asPrivate) });
    expect(out.toString("base64url")).toBe(RFC.body);
    expect(decrypt(out, b(RFC.uaPrivate), b(RFC.auth))).toBe(RFC.plaintext);
  });

  it("a device can read a note encrypted for it, and every note looks different", () => {
    const device = createECDH("prime256v1");
    device.generateKeys();
    const keys = { p256dh: device.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") };
    const one = encryptPayload(Buffer.from("Rent is paid"), keys);
    const two = encryptPayload(Buffer.from("Rent is paid"), keys);
    expect(one.equals(two)).toBe(false);
    expect(decrypt(one, device.getPrivateKey(), Buffer.alloc(16, 1))).toBe("Rent is paid");
  });

  it("signs a VAPID token a push service can check, with the site's public key", () => {
    const header = vapidHeader("https://web.push.apple.com/abc123", new Date("2026-11-24T12:00:00Z"));
    const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(key).toBe(vapidPublicKey());
    const [h, c, s] = token.split(".");
    const claims = JSON.parse(b(c).toString());
    expect(claims.aud).toBe("https://web.push.apple.com");
    expect(claims.exp).toBe(Date.parse("2026-11-24T12:00:00Z") / 1000 + 12 * 3600);
    expect(claims.sub).toMatch(/^https:\/\//);
    const pub = b(key);
    const jwk = { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") };
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, b(s))).toBe(true);
  });

  it("only ever sends to the browsers' own push services", () => {
    expect(isPushEndpoint("https://web.push.apple.com/QGx1")).toBe(true);
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushEndpoint("https://wns2-bl2p.notify.windows.com/w/?token=abc")).toBe(true);
    for (const bad of ["http://web.push.apple.com/x", "https://web.push.apple.com:8443/x", "https://user:pw@web.push.apple.com/x", "https://evil.com/web.push.apple.com", "https://web.push.apple.com.evil.com/x", "https://169.254.169.254/latest", "https://localhost/x", "not a url"]) {
      expect(isPushEndpoint(bad), bad).toBe(false);
    }
  });

  it("checks a device's keys are real", () => {
    expect(isPushKeys({ p256dh: RFC.uaPublic, auth: RFC.auth })).toBe(true);
    expect(isPushKeys({ p256dh: RFC.uaPublic, auth: "short" })).toBe(false);
    expect(isPushKeys({ p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: RFC.auth })).toBe(false);
  });

  it("sends with the right headers, and says when a device has gone", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const reply = (status: number) => (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(null, { status });
    }) as typeof fetch;
    const target = { endpoint: "https://web.push.apple.com/QGx1", keys: { p256dh: RFC.uaPublic, auth: RFC.auth } };
    const note = { title: "Rent is paid", body: "$750.00", url: "/bills" };
    expect(await sendPush(target, note, { ttl: 3600 }, reply(201))).toBe("sent");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.TTL).toBe("3600");
    expect(headers.Authorization).toMatch(/^vapid t=/);
    expect(calls[0].init.redirect).toBe("error");
    expect(decrypt(Buffer.from(calls[0].init.body as Uint8Array), b(RFC.uaPrivate), b(RFC.auth))).toBe(JSON.stringify(note));
    expect(await sendPush(target, note, {}, reply(410))).toBe("gone");
    expect(await sendPush(target, note, {}, reply(404))).toBe("gone");
    expect(await sendPush(target, note, {}, reply(500))).toBe("failed");
    expect(await sendPush(target, note, {}, (async () => { throw new Error("offline"); }) as typeof fetch)).toBe("failed");
    // Never to an address that isn't a push service.
    calls.length = 0;
    expect(await sendPush({ ...target, endpoint: "https://evil.example/x" }, note, {}, reply(201))).toBe("gone");
    expect(calls).toHaveLength(0);
  });
});
