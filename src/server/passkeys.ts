import { and, eq, lt } from "drizzle-orm";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { getDb, type DB } from "@/db";
import { authChallenges, passkeys, users } from "@/db/schema";
import { APP_NAME, isDemoMode, siteOrigin } from "@/lib/config";
import { endSession, markFresh, startSession, type Ctx } from "./auth";
import { randomToken } from "./crypto";
import { HttpError } from "./http";

/*
 * Passkeys: sign in with Face ID, Touch ID, a fingerprint or a security key
 * instead of a password. The device keeps the secret half and proves it has
 * it; only the public half is stored here, so there is nothing to steal from
 * the database and nothing a fake website can trick someone into typing.
 */

const CHALLENGE_COOKIE = "passbook_challenge";
const CHALLENGE_MINUTES = 5;
const MAX_PASSKEYS = 10;

/**
 * The site this passkey belongs to. With real data that is always the
 * configured APP_URL. What the request says about its own address is only
 * used for local development.
 */
function site(request: Request): { rpID: string; origin: string } {
  const configured = siteOrigin();
  if (configured) return { rpID: new URL(configured).hostname, origin: configured };
  if (!isDemoMode() && process.env.NODE_ENV === "production") throw new HttpError(503, "This site isn’t fully set up yet.");
  const host = request.headers.get("host") ?? "localhost";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return { rpID: host.split(":")[0], origin: `${proto}://${host}` };
}

function challengeCookie(id: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${CHALLENGE_COOKIE}=${id}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

/**
 * What a challenge was issued for. A challenge is only good for the thing it
 * was issued for: one handed out to confirm it's you can't be used to add a
 * new device, and one for signing in can't be used to confirm.
 */
type Purpose = "register" | "confirm" | "login";

async function saveChallenge(db: DB, purpose: Purpose, challenge: string, userId: string | null): Promise<string> {
  const id = randomToken(24);
  await db.delete(authChallenges).where(lt(authChallenges.expiresAt, new Date()));
  await db.insert(authChallenges).values({ id, userId, challenge: `${purpose}:${challenge}`, expiresAt: new Date(Date.now() + CHALLENGE_MINUTES * 60_000) });
  return challengeCookie(id, CHALLENGE_MINUTES * 60);
}

/** Reads and uses up the one-time challenge for this browser. It must have been issued for this purpose. */
async function takeChallenge(db: DB, request: Request, purpose: Purpose): Promise<{ challenge: string; userId: string | null }> {
  const id = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((p) => p.trim().split("="))
    .find(([k]) => k === CHALLENGE_COOKIE)?.[1];
  if (!id) throw new HttpError(400, "That took too long. Try again.");
  const [row] = await db.delete(authChallenges).where(eq(authChallenges.id, id)).returning();
  if (!row || row.expiresAt < new Date()) throw new HttpError(400, "That took too long. Try again.");
  const prefix = `${purpose}:`;
  if (!row.challenge.startsWith(prefix)) throw new HttpError(400, "That took too long. Try again.");
  return { challenge: row.challenge.slice(prefix.length), userId: row.userId };
}

function deviceName(request: Request): string {
  const ua = request.headers.get("user-agent") ?? "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

export async function listPasskeys(ctx: Ctx) {
  const rows = await ctx.db.select({ id: passkeys.id, name: passkeys.name, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt }).from(passkeys).where(eq(passkeys.userId, ctx.userId));
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null }));
}

export async function removePasskey(ctx: Ctx, id: string) {
  await ctx.db.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, ctx.userId)));
}

/** Step 1 of adding a passkey: what the device needs to create one. */
export async function registrationOptions(ctx: Ctx, request: Request) {
  const existing = await ctx.db.select({ id: passkeys.id, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, ctx.userId));
  if (existing.length >= MAX_PASSKEYS) throw new HttpError(400, "You’ve reached the limit of saved devices. Remove one first.");
  const { rpID } = site(request);
  const options = await generateRegistrationOptions({
    rpName: APP_NAME,
    rpID,
    userName: ctx.user.email,
    userDisplayName: ctx.user.name,
    userID: new TextEncoder().encode(ctx.userId),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: (p.transports?.split(",") ?? []) as never })),
    // A "discoverable" passkey: the device can offer it without the person typing an email first.
    // "required" means the device must check it's really you (face, fingerprint or PIN), not just be present.
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  return { options, cookie: await saveChallenge(ctx.db, "register", options.challenge, ctx.userId) };
}

/** Step 2: check what the device made and store its public half. */
export async function finishRegistration(ctx: Ctx, request: Request, response: RegistrationResponseJSON) {
  const { challenge, userId } = await takeChallenge(ctx.db, request, "register");
  if (userId !== ctx.userId) throw new HttpError(400, "That took too long. Try again.");
  const held = await ctx.db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, ctx.userId));
  if (held.length >= MAX_PASSKEYS) throw new HttpError(400, "You’ve reached the limit of saved devices. Remove one first.");
  const { rpID, origin } = site(request);
  const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }).catch(() => null);
  if (!result?.verified) throw new HttpError(400, "That didn’t work. Try again.");
  const { credential } = result.registrationInfo;
  await ctx.db.insert(passkeys).values({
    id: credential.id,
    userId: ctx.userId,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports?.join(",") ?? null,
    name: deviceName(request),
  });
  return { cookie: challengeCookie("", 0) };
}

/**
 * "Confirm it's you" with Face ID, step 1. Unlike signing in, this is for one
 * known person: only their own devices are offered.
 */
export async function confirmOptions(ctx: Ctx, request: Request) {
  const own = await ctx.db.select({ id: passkeys.id, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, ctx.userId));
  if (own.length === 0) throw new HttpError(400, "No Face ID device is set up for this account. Use your password.");
  const options = await generateAuthenticationOptions({
    rpID: site(request).rpID,
    userVerification: "required",
    allowCredentials: own.map((p) => ({ id: p.id, transports: (p.transports?.split(",") ?? undefined) as never })),
  });
  return { options, cookie: await saveChallenge(ctx.db, "confirm", options.challenge, ctx.userId) };
}

/**
 * Step 2. The passkey must belong to the person already signed in. Someone
 * else's passkey on a shared device confirms nothing, and never changes who
 * is signed in. On success this session is marked freshly checked.
 */
export async function finishConfirm(ctx: Ctx, request: Request, response: AuthenticationResponseJSON): Promise<{ cookie: string }> {
  const { challenge, userId } = await takeChallenge(ctx.db, request, "confirm");
  const failed = new HttpError(401, "That didn’t confirm it’s you. Use your password instead.");
  if (userId !== ctx.userId) throw failed;
  const [key] = await ctx.db.select().from(passkeys).where(and(eq(passkeys.id, response.id), eq(passkeys.userId, ctx.userId))).limit(1);
  if (!key) throw failed;
  const { rpID, origin } = site(request);
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")), counter: key.counter, transports: (key.transports?.split(",") ?? undefined) as never },
  }).catch(() => null);
  if (!result?.verified) throw failed;
  await ctx.db.update(passkeys).set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(and(eq(passkeys.id, key.id), eq(passkeys.userId, ctx.userId)));
  await markFresh(ctx);
  return { cookie: challengeCookie("", 0) };
}

/** Step 1 of signing in: a fresh challenge. No email is asked for. */
export async function loginOptions(request: Request) {
  const db = await getDb();
  const options = await generateAuthenticationOptions({ rpID: site(request).rpID, userVerification: "required" });
  return { options, cookie: await saveChallenge(db, "login", options.challenge, null) };
}

/** Step 2: check the device's answer against the stored public half, then start a session. */
export async function finishLogin(request: Request, response: AuthenticationResponseJSON): Promise<{ cookies: string[] }> {
  const db = await getDb();
  const { challenge } = await takeChallenge(db, request, "login");
  const failed = new HttpError(401, "That passkey wasn’t recognized. Sign in with your password instead.");
  const [key] = await db.select().from(passkeys).where(eq(passkeys.id, response.id)).limit(1);
  if (!key) throw failed;
  const { rpID, origin } = site(request);
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")), counter: key.counter, transports: (key.transports?.split(",") ?? undefined) as never },
  }).catch(() => null);
  if (!result?.verified) throw failed;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, key.userId)).limit(1);
  if (!user) throw failed;
  await db.update(passkeys).set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(passkeys.id, key.id));
  // Replaces whatever session this browser had, so signing in again leaves one session, not two.
  await endSession(db, request);
  return { cookies: [await startSession(db, user.id), challengeCookie("", 0)] };
}
