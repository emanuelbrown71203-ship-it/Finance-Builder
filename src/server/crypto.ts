import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key))));
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Compares two secrets without giving away, by how long it takes, how much of a guess was right. */
export function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a), "hex"), Buffer.from(sha256(b), "hex"));
}

/**
 * How hard a password is to guess from its stored form. These are the
 * strengths OWASP recommends for scrypt (N = 2^17). They are written into
 * each stored password, so they can be raised later and old ones upgraded
 * the next time the person signs in.
 */
const COST = { N: 2 ** 17, r: 8, p: 1 };
/** The strength of passwords stored before the cost was written down. */
const LEGACY = { N: 2 ** 14, r: 8, p: 1 };
const options = (cost: typeof COST): ScryptOptions => ({ ...cost, maxmem: 256 * cost.N * cost.r });

/** scrypt with a per-password salt. Stored as "scrypt$N$r$p$<salt>$<hash>". */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, options(COST));
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function parseStored(stored: string | null): { cost: typeof COST; salt: Buffer; hash: Buffer } | null {
  const parts = (stored ?? "").split("$");
  if (parts[0] !== "scrypt") return null;
  if (parts.length === 3) return { cost: LEGACY, salt: Buffer.from(parts[1], "base64url"), hash: Buffer.from(parts[2], "base64url") };
  if (parts.length !== 6) return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  // Refuse anything outside sane bounds, so a tampered row can't make sign-in arbitrarily expensive.
  if (!Number.isInteger(N) || N < 2 ** 14 || N > 2 ** 20 || (N & (N - 1)) !== 0 || r !== 8 || p !== 1) return null;
  return { cost: { N, r, p }, salt: Buffer.from(parts[4], "base64url"), hash: Buffer.from(parts[5], "base64url") };
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parsed = parseStored(stored);
  if (!parsed || parsed.salt.length === 0 || parsed.hash.length !== 64) {
    // Burn comparable time so a missing account isn’t distinguishable by timing.
    await scrypt(password, Buffer.alloc(16), 64, options(COST));
    return false;
  }
  const actual = await scrypt(password, parsed.salt, 64, options(parsed.cost));
  return timingSafeEqual(actual, parsed.hash);
}

/** True when a stored password was made with weaker settings than today's and should be re-stored. */
export function passwordNeedsUpgrade(stored: string): boolean {
  const parsed = parseStored(stored);
  return !parsed || parsed.cost.N < COST.N;
}

function encryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  return key;
}

const TAG_BYTES = 16;

/**
 * AES-256-GCM. Bank access tokens are only ever stored encrypted.
 *
 * `owner` says whose secret this is and what for (for example "bank:<user id>").
 * It is sealed in with the secret, so a stored value copied onto another
 * person's row can't be opened there.
 */
export function encryptSecret(plain: string, owner: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(owner, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v2", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptSecret(stored: string, owner: string): string {
  const [version, ivText, tagText, body] = stored.split(".");
  if (version !== "v2" || !ivText || !tagText || !body) throw new Error("Unrecognized secret format.");
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (iv.length !== 12 || tag.length !== TAG_BYTES) throw new Error("Unrecognized secret format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(owner, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
