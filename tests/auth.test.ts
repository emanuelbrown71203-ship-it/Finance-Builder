import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

// Sign-in only exists with real data, so this file runs the app in live mode.
process.env.DEMO_MODE = "0";
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.APP_URL = "https://passbook.test";
process.env.SIGNUP_CODE = "walnut-harbor-42";

import { POST as confirmRoute } from "@/app/api/auth/confirm/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutAllRoute } from "@/app/api/auth/logout-all/route";
import { POST as passkeyConfirmOptionsRoute } from "@/app/api/auth/passkey/confirm-options/route";
import { POST as passkeyConfirmRoute } from "@/app/api/auth/passkey/confirm/route";
import { POST as passkeyLoginOptionsRoute } from "@/app/api/auth/passkey/login-options/route";
import { POST as passkeyRegisterOptionsRoute } from "@/app/api/auth/passkey/register-options/route";
import { POST as passkeyRegisterRoute } from "@/app/api/auth/passkey/register/route";
import { POST as passwordRoute } from "@/app/api/auth/password/route";
import { POST as signupRoute } from "@/app/api/auth/signup/route";
import { POST as connectorRoute } from "@/app/api/connector/route";
import { DELETE as deleteAccountRoute, GET as meRoute } from "@/app/api/me/route";
import { getDb, type DB } from "@/db";
import { connectorTokens, items, passkeys, rateLimits, sessions, users } from "@/db/schema";
import { databaseNeedsTls, databaseTls, databaseUrl, liveConfigProblem } from "@/lib/config";
import { contextForKey } from "@/server/connector";
import { decryptSecret, encryptSecret, hashPassword, passwordNeedsUpgrade, sha256, verifyPassword } from "@/server/crypto";
import { describeError } from "@/server/errors";
import { removeItem } from "@/server/plaid";
import { assertUnderLimit, clientAddress, limitKey } from "@/server/rate-limit";

const SITE = "https://passbook.test";
const none = { params: Promise.resolve({}) };
let address = 0;

/** A request as a browser on our own site would send it. */
function req(path: string, options: { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string; headers?: Record<string, string> } = {}) {
  const method = options.method ?? "POST";
  const headers = new Headers({ "x-forwarded-for": options.ip ?? "203.0.113.7", ...options.headers });
  if (options.origin !== null && method !== "GET") headers.set("origin", options.origin ?? SITE);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${SITE}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}
const cookieOf = (response: Response) => (response.headers.get("set-cookie") ?? "").split(";")[0];
const freshIp = () => `198.51.100.${++address}`;

let db: DB;
const person = { name: "Jordan", email: "jordan@example.com", password: "correct horse battery" };
let cookie = "";

beforeAll(async () => {
  db = await getDb();
});

describe("creating an account", () => {
  it("is by invitation: no code or a wrong code is refused before anything else is looked at", async () => {
    const without = await signupRoute(req("/api/auth/signup", { body: person, ip: freshIp() }));
    expect(without.status).toBe(403);
    const wrong = await signupRoute(req("/api/auth/signup", { body: { ...person, code: "walnut-harbor-43" }, ip: freshIp() }));
    expect(wrong.status).toBe(403);
    expect(await db.select().from(users).where(eq(users.email, person.email))).toHaveLength(0);
  });

  it("is closed altogether when no invite code has been set", async () => {
    const saved = process.env.SIGNUP_CODE;
    delete process.env.SIGNUP_CODE;
    try {
      const response = await signupRoute(req("/api/auth/signup", { body: { ...person, code: "" }, ip: freshIp() }));
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("New accounts are closed.");
    } finally {
      process.env.SIGNUP_CODE = saved;
    }
  });

  it("works with the code, refuses weak passwords, and stores the password only as a strong hash", async () => {
    const weak = await signupRoute(req("/api/auth/signup", { body: { ...person, password: "password123", code: "walnut-harbor-42" }, ip: freshIp() }));
    expect(weak.status).toBe(400);
    const made = await signupRoute(req("/api/auth/signup", { body: { ...person, code: "walnut-harbor-42" }, ip: freshIp() }));
    expect(made.status).toBe(200);
    cookie = cookieOf(made);
    expect(cookie).toMatch(/^passbook_session=.{20,}/);
    expect(made.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Lax/);
    const [row] = await db.select().from(users).where(eq(users.email, person.email));
    expect(row.passwordHash).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect(row.passwordHash).not.toContain(person.password);
    // The session is stored as a hash of the cookie, never the cookie itself.
    const token = cookie.split("=")[1];
    expect(await db.select().from(sessions).where(eq(sessions.id, token))).toHaveLength(0);
    expect(await db.select().from(sessions).where(eq(sessions.id, sha256(token)))).toHaveLength(1);
  });
});

describe("signing in", () => {
  it("lets the right password in and gives the same answer for a wrong password as for an unknown email", async () => {
    const good = await loginRoute(req("/api/auth/login", { body: { email: "  Jordan@Example.com ", password: person.password }, ip: freshIp() }));
    expect(good.status).toBe(200);
    const wrong = await loginRoute(req("/api/auth/login", { body: { email: person.email, password: "not the password" }, ip: freshIp() }));
    const unknown = await loginRoute(req("/api/auth/login", { body: { email: "nobody@example.com", password: "not the password" }, ip: freshIp() }));
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("slows guessing from one address without letting a stranger lock the owner out", async () => {
    const attacker = freshIp();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await loginRoute(req("/api/auth/login", { body: { email: person.email, password: `guess number ${i}` }, ip: attacker }))).status;
    expect(last).toBe(429);
    // The owner, from their own address, still gets in.
    const owner = await loginRoute(req("/api/auth/login", { body: { email: person.email, password: person.password }, ip: freshIp() }));
    expect(owner.status).toBe(200);
  });

  it("re-stores a password that was saved with older, weaker settings", async () => {
    const { scryptSync, randomBytes } = await import("node:crypto");
    const salt = randomBytes(16);
    const legacy = `scrypt$${salt.toString("base64url")}$${scryptSync("an older password", salt, 64).toString("base64url")}`;
    expect(passwordNeedsUpgrade(legacy)).toBe(true);
    await db.insert(users).values({ id: "legacy-user", email: "legacy@example.com", name: "Lee", passwordHash: legacy });
    const response = await loginRoute(req("/api/auth/login", { body: { email: "legacy@example.com", password: "an older password" }, ip: freshIp() }));
    expect(response.status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, "legacy-user"));
    expect(row.passwordHash).toMatch(/^scrypt\$131072\$/);
    expect(await verifyPassword("an older password", row.passwordHash)).toBe(true);
  });
});

describe("requests must come from the app itself", () => {
  it("refuses a write from another site, with no origin at all, or over plain http", async () => {
    const body = { password: person.password };
    for (const origin of ["https://evil.example", "http://passbook.test", "https://passbook.test.evil.example", "null"]) {
      expect((await confirmRoute(req("/api/auth/confirm", { body, cookie, origin }), none)).status, origin).toBe(403);
    }
    expect((await confirmRoute(req("/api/auth/confirm", { body, cookie, origin: null }), none)).status).toBe(403);
    // Pretending to be us by sending our own Host header from somewhere else doesn't help: only APP_URL counts.
    expect((await confirmRoute(req("/api/auth/confirm", { body, cookie, origin: "https://evil.example", headers: { "x-forwarded-host": "evil.example", host: "evil.example" } }), none)).status).toBe(403);
    expect((await confirmRoute(req("/api/auth/confirm", { body, cookie }), none)).status).toBe(200);
  });

  it("and need a session: no cookie, or a made-up one, is turned away", async () => {
    expect((await meRoute(req("/api/me", { method: "GET" }), none)).status).toBe(401);
    expect((await meRoute(req("/api/me", { method: "GET", cookie: "passbook_session=made-up-token" }), none)).status).toBe(401);
    expect((await meRoute(req("/api/me", { method: "GET", cookie }), none)).status).toBe(200);
  });
});

describe("confirm it’s you", () => {
  const age = (minutes: number) => db.update(sessions).set({ authAt: new Date(Date.now() - minutes * 60_000) }).where(eq(sessions.id, sha256(cookie.split("=")[1])));

  it("is needed before making a Claude link or deleting the account, once sign-in is more than a few minutes old", async () => {
    await age(11);
    const link = await connectorRoute(req("/api/connector", { cookie }), none);
    expect(link.status).toBe(403);
    expect(await link.json()).toMatchObject({ reauth: true });
    expect((await deleteAccountRoute(req("/api/me", { method: "DELETE", cookie }), none)).status).toBe(403);
    expect(await db.select().from(users).where(eq(users.email, person.email))).toHaveLength(1);

    expect((await confirmRoute(req("/api/auth/confirm", { body: { password: "wrong password here" }, cookie }), none)).status).toBe(401);
    expect((await connectorRoute(req("/api/connector", { cookie }), none)).status).toBe(403);
    expect((await confirmRoute(req("/api/auth/confirm", { body: { password: person.password }, cookie }), none)).status).toBe(200);
    const made = await connectorRoute(req("/api/connector", { cookie }), none);
    expect(made.status).toBe(200);
    expect((await made.json()).key).toHaveLength(40);
  });

  it("with Face ID, only the signed-in person's own device counts: someone else's on the same iPad confirms nothing", async () => {
    await db.insert(users).values({ id: "partner", email: "partner@example.com", name: "Alex", passwordHash: await hashPassword("partner has their own") });
    const [me] = await db.select().from(users).where(eq(users.email, person.email));
    await db.insert(passkeys).values([
      { id: "key-of-mine", userId: me.id, publicKey: "AAAA", name: "iPad" },
      { id: "key-of-partner", userId: "partner", publicKey: "AAAA", name: "iPad" },
    ]);
    await age(11);
    const options = await passkeyConfirmOptionsRoute(req("/api/auth/passkey/confirm-options", { cookie }), none);
    expect(options.status).toBe(200);
    // Only this account's device is offered.
    expect(((await options.json()).allowCredentials as { id: string }[]).map((c) => c.id)).toEqual(["key-of-mine"]);
    const challenge = cookieOf(options);
    // The partner's passkey answers instead. It is refused, and nobody's session changes hands.
    const answered = await passkeyConfirmRoute(req("/api/auth/passkey/confirm", { cookie: `${cookie}; ${challenge}`, body: { id: "key-of-partner", rawId: "key-of-partner", type: "public-key", response: {}, clientExtensionResults: {} } }), none);
    expect(answered.status).toBe(401);
    expect((await (await meRoute(req("/api/me", { method: "GET", cookie }), none)).json()).user.email).toBe(person.email);
    expect((await connectorRoute(req("/api/connector", { cookie }), none)).status).toBe(403);
    expect(await db.select().from(users).where(eq(users.id, "partner"))).toHaveLength(1);
    await confirmRoute(req("/api/auth/confirm", { body: { password: person.password }, cookie }), none);
  });

  it("a challenge is only good for what it was issued for: a stale session can't turn a confirm into a new device", async () => {
    const [me] = await db.select().from(users).where(eq(users.email, person.email));
    const made = { id: "planted-key", rawId: "planted-key", type: "public-key", response: { clientDataJSON: "e30", attestationObject: "oA" }, clientExtensionResults: {} };
    const count = async () => (await db.select().from(passkeys).where(eq(passkeys.userId, me.id))).length;
    expect(await count()).toBe(1);

    // Signed in eleven minutes ago. Asking to add a device is refused outright...
    await age(11);
    expect((await passkeyRegisterOptionsRoute(req("/api/auth/passkey/register-options", { cookie }), none)).status).toBe(403);
    // ...so they ask for a "confirm it's you" challenge instead (anyone signed in may), and try to
    // spend it on adding a device. The second step needs a fresh confirm of its own.
    const confirmChallenge = cookieOf(await passkeyConfirmOptionsRoute(req("/api/auth/passkey/confirm-options", { cookie }), none));
    const stale = await passkeyRegisterRoute(req("/api/auth/passkey/register", { cookie: `${cookie}; ${confirmChallenge}`, body: made }), none);
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ reauth: true });

    // Even freshly confirmed, a challenge issued for confirming, or for signing in, is not accepted for adding a device.
    await confirmRoute(req("/api/auth/confirm", { body: { password: person.password }, cookie }), none);
    for (const issue of [() => passkeyConfirmOptionsRoute(req("/api/auth/passkey/confirm-options", { cookie }), none), () => passkeyLoginOptionsRoute(req("/api/auth/passkey/login-options", { ip: freshIp() }))]) {
      const challenge = cookieOf(await issue());
      const response = await passkeyRegisterRoute(req("/api/auth/passkey/register", { cookie: `${cookie}; ${challenge}`, body: made }), none);
      expect(response.status).toBe(400);
    }
    // And a challenge issued for adding a device can't be used to confirm.
    const registerChallenge = cookieOf(await passkeyRegisterOptionsRoute(req("/api/auth/passkey/register-options", { cookie }), none));
    await age(11);
    expect((await passkeyConfirmRoute(req("/api/auth/passkey/confirm", { cookie: `${cookie}; ${registerChallenge}`, body: { id: "key-of-mine", rawId: "key-of-mine", type: "public-key", response: {}, clientExtensionResults: {} } }), none)).status).toBe(400);
    expect((await connectorRoute(req("/api/connector", { cookie }), none)).status).toBe(403);

    expect(await count()).toBe(1);
    await db.delete(passkeys).where(eq(passkeys.userId, me.id));
    await confirmRoute(req("/api/auth/confirm", { body: { password: person.password }, cookie }), none);
  });

  it("limits password guesses made from a signed-in device", async () => {
    await db.insert(users).values({ id: "guessed", email: "guessed@example.com", name: "Gus", passwordHash: await hashPassword("a perfectly fine one") });
    const login = await loginRoute(req("/api/auth/login", { body: { email: "guessed@example.com", password: "a perfectly fine one" }, ip: freshIp() }));
    const theirs = cookieOf(login);
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await confirmRoute(req("/api/auth/confirm", { body: { password: `guess ${i}` }, cookie: theirs }), none)).status;
    expect(last).toBe(429);
  });
});

describe("changing the password and signing out everywhere", () => {
  it("a new password signs out every other device and stops the old password working", async () => {
    await db.delete(rateLimits); // the tests above used up this account's password-check allowance
    const other = cookieOf(await loginRoute(req("/api/auth/login", { body: { email: person.email, password: person.password }, ip: freshIp() })));
    expect((await meRoute(req("/api/me", { method: "GET", cookie: other }), none)).status).toBe(200);

    expect((await passwordRoute(req("/api/auth/password", { body: { current: "not it at all", next: "a brand new passphrase" }, cookie }), none)).status).toBe(401);
    expect((await passwordRoute(req("/api/auth/password", { body: { current: person.password, next: "jordan12345678" }, cookie }), none)).status).toBe(400);
    const linkBefore = (await (await connectorRoute(req("/api/connector", { cookie }), none)).json()).key as string;
    expect((await passwordRoute(req("/api/auth/password", { body: { current: person.password, next: "a brand new passphrase" }, cookie }), none)).status).toBe(200);
    // Whoever had the old password may have made a Claude link with it. That goes too.
    expect(await contextForKey(linkBefore)).toBeNull();

    expect((await meRoute(req("/api/me", { method: "GET", cookie: other }), none)).status).toBe(401);
    expect((await meRoute(req("/api/me", { method: "GET", cookie }), none)).status).toBe(200);
    expect((await loginRoute(req("/api/auth/login", { body: { email: person.email, password: person.password }, ip: freshIp() }))).status).toBe(401);
    person.password = "a brand new passphrase";
  });

  it("signing out everywhere ends every session and switches the Claude link off", async () => {
    const key = (await (await connectorRoute(req("/api/connector", { cookie }), none)).json()).key as string;
    expect((await contextForKey(key))?.user.email).toBe(person.email);
    expect((await logoutAllRoute(req("/api/auth/logout-all", { cookie }), none)).status).toBe(200);
    expect((await meRoute(req("/api/me", { method: "GET", cookie }), none)).status).toBe(401);
    expect(await contextForKey(key)).toBeNull();
    expect(await db.select().from(connectorTokens)).toHaveLength(0);
  });
});

describe("removing a bank", () => {
  it("a bank whose stored token is unreadable can still be removed, but one that merely won't open is kept", async () => {
    const saved = { id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET };
    Object.assign(process.env, { PLAID_CLIENT_ID: "test-client", PLAID_SECRET: "test-secret" });
    try {
      await db.insert(users).values({ id: "banked", email: "banked@example.com", name: "Bo" });
      // One sealed for somebody else, one in a format that is no longer read.
      await db.insert(items).values([
        { id: "item-wrong-owner", userId: "banked", institutionName: "First Bank", accessTokenEnc: encryptSecret("access-production-abc", "bank:someone-else") },
        { id: "item-old-format", userId: "banked", institutionName: "Second Bank", accessTokenEnc: "v1.aaaa.bbbb.cccc" },
      ]);
      // An old format no key will ever open: nothing to keep it for.
      await removeItem(db, "banked", "item-old-format");
      // The right format but it won't open (a wrong key on this site, say). Throwing it away would leave
      // the connection live at Plaid with no way to switch it off, so it stays and the person is told.
      await expect(removeItem(db, "banked", "item-wrong-owner")).rejects.toThrow("can’t be read right now");
      expect((await db.select().from(items).where(eq(items.userId, "banked"))).map((i) => i.id)).toEqual(["item-wrong-owner"]);
    } finally {
      for (const [key, value] of [["PLAID_CLIENT_ID", saved.id], ["PLAID_SECRET", saved.secret]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("rate limits", () => {
  it("invite-code attempts are counted across every address together, even when they all arrive at once", async () => {
    await db.delete(rateLimits);
    // 150 guesses at the same moment, each from a different address. Only 60 are even compared.
    const burst = await Promise.all(Array.from({ length: 150 }, (_, i) => signupRoute(req("/api/auth/signup", { body: { name: "Mal", email: `mal${i}@example.com`, password: "correct horse battery", code: `guess-${i}` }, ip: freshIp() }))));
    expect(burst.filter((r) => r.status === 403)).toHaveLength(60);
    expect(burst.filter((r) => r.status === 429)).toHaveLength(90);
    // Even the right code waits now, so it can't be found by trying from many places.
    expect((await signupRoute(req("/api/auth/signup", { body: { name: "Mal", email: "mal@example.com", password: "correct horse battery", code: "walnut-harbor-42" }, ip: freshIp() }))).status).toBe(429);
    await db.delete(rateLimits);
  });

  it("count in the database, refuse past the limit, and start again after the window", async () => {
    for (let i = 0; i < 3; i++) await limitKey("test-bucket", "someone", 3, 60_000);
    await expect(limitKey("test-bucket", "someone", 3, 60_000)).rejects.toThrow("Too many attempts");
    await expect(assertUnderLimit("test-bucket", "someone", 3, 60_000)).rejects.toThrow("Too many attempts");
    await assertUnderLimit("test-bucket", "someone else", 3, 60_000);
    // A window of zero has always just ended, so the count starts over.
    await limitKey("test-bucket", "someone", 3, 0);
    await limitKey("test-bucket", "someone", 3, 60_000);
  });

  it("go by the address the host reports, not one the visitor can make up", () => {
    const from = (headers: Record<string, string>) => clientAddress(new Request(SITE, { headers }));
    // Off Vercel, only the hop added by the nearest proxy counts; the rest is whatever the visitor sent.
    expect(from({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" })).toBe("203.0.113.9");
    expect(from({ "x-vercel-forwarded-for": "9.9.9.9", "x-forwarded-for": "203.0.113.9" })).toBe("203.0.113.9");
    process.env.VERCEL = "1";
    try {
      expect(from({ "x-vercel-forwarded-for": "198.51.100.20", "x-forwarded-for": "1.2.3.4" })).toBe("198.51.100.20");
    } finally {
      delete process.env.VERCEL;
    }
  });
});

describe("secrets", () => {
  it("a stored secret only opens for the person and purpose it was sealed for, and not if it was altered", () => {
    const sealed = encryptSecret("access-production-abc", "bank:user-1");
    expect(sealed).not.toContain("access-production");
    expect(decryptSecret(sealed, "bank:user-1")).toBe("access-production-abc");
    // Copied onto someone else's row, or reused for a different purpose: it won't open.
    expect(() => decryptSecret(sealed, "bank:user-2")).toThrow();
    expect(() => decryptSecret(sealed, "tasks:user-1")).toThrow();
    const [v, iv, tag, body] = sealed.split(".");
    // A shortened check value is refused outright.
    expect(() => decryptSecret([v, iv, Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url"), body].join("."), "bank:user-1")).toThrow("Unrecognized secret format");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64url")].join("."), "bank:user-1")).toThrow();
  });

  it("what gets logged about a failure never includes the keys, tokens or values that were in play", () => {
    // What the Plaid library throws: the request, with our secret and the bank token, rides along on the error.
    const upstream = Object.assign(new Error("Request failed with status code 400"), {
      name: "AxiosError",
      config: { headers: { "PLAID-CLIENT-ID": "client-id-123", "PLAID-SECRET": "plaid-secret-xyz" }, data: '{"access_token":"access-production-abc"}' },
      response: { status: 400, data: { error_type: "INVALID_INPUT", error_code: "INVALID_PUBLIC_TOKEN", error_message: "provided public token is in an invalid format" } },
    });
    const a = describeError(upstream);
    expect(a).toContain("INVALID_PUBLIC_TOKEN");
    expect(a).not.toMatch(/plaid-secret-xyz|access-production-abc|client-id-123/);

    const network = Object.assign(new Error("timeout of 10000ms exceeded"), { name: "AxiosError", code: "ECONNABORTED", config: { headers: { "PLAID-SECRET": "plaid-secret-xyz" }, data: '{"access_token":"access-production-abc"}' } });
    expect(describeError(network)).not.toMatch(/plaid-secret-xyz|access-production-abc/);

    // What the database layer throws: the values the query ran with are in its message.
    const query = Object.assign(new Error('Failed query: insert into "users" ("email", "password_hash") values ($1, $2)\nparams: someone@example.com,scrypt$131072$8$1$salt$hash'), {
      query: 'insert into "users" ("email", "password_hash") values ($1, $2)',
      params: ["someone@example.com", "scrypt$131072$8$1$salt$hash"],
      cause: Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }),
    });
    const b = describeError(query);
    expect(b).toContain("23505");
    expect(b).not.toMatch(/someone@example\.com|salt\$hash/);

    // The database driver's own error, not wrapped: its message names the problem and carries no values.
    const driver = Object.assign(new Error('database "nowhere" does not exist'), { name: "PostgresError", code: "3D000", query: "select count(*) from users", parameters: ["secret-value"] });
    expect(describeError(driver)).toContain('3D000: database "nowhere" does not exist');
    expect(describeError(driver)).not.toContain("secret-value");
    // A "bad value" error quotes the value in its message, so only its code is kept.
    const cast = Object.assign(new Error('invalid input syntax for type integer: "hunter2-password"'), { name: "PostgresError", code: "22P02", query: "select $1::int" });
    expect(describeError(cast)).toContain("22P02");
    expect(describeError(cast)).not.toContain("hunter2");
  });

  it("a deployed site with real data refuses to run until everything it needs is in place", () => {
    const saved = { ...process.env };
    Object.assign(process.env, { NODE_ENV: "production" });
    try {
      delete process.env.DATABASE_URL;
      expect(liveConfigProblem()).toContain("DATABASE_URL");
      // An address with no password isn't enough on its own...
      process.env.DATABASE_URL = "postgres://app.project@db.example:6543/postgres";
      expect(liveConfigProblem()).toContain("DATABASE_PASSWORD");
      // ...until the password is supplied beside it. Characters that mean something in an address are handled.
      process.env.DATABASE_PASSWORD = "p@ss/w:rd#1";
      expect(liveConfigProblem()).toBeNull();
      expect(decodeURIComponent(new URL(databaseUrl()!).password)).toBe("p@ss/w:rd#1");
      for (const awkward of ["ab%41cd", "tr%2Fick", "p@ss%word", "100%sure"]) {
        process.env.DATABASE_PASSWORD = awkward;
        expect(decodeURIComponent(new URL(databaseUrl()!).password), awkward).toBe(awkward);
      }
      // Encrypted in transit unless the database is on this same machine.
      expect(databaseNeedsTls("postgres://app.project@aws-0-us-east-1.pooler.example.com:6543/postgres")).toBe(true);
      expect(databaseNeedsTls("postgres://app@127.0.0.1:5432/passbook")).toBe(false);
      expect(databaseNeedsTls("not an address")).toBe(true);
      // An address that hides its real host is never taken for a local one.
      expect(databaseNeedsTls("postgres://u:p@localhost/db?host=db.example.com")).toBe(true);
      expect(databaseNeedsTls("postgres://u:p@localhost#@db.example.com/db")).toBe(true);
      // Encryption is forced, but an address that already asks for certificate checking is left in charge.
      expect(databaseTls("postgres://u:p@db.example.com/db")).toEqual({ ssl: "require" });
      expect(databaseTls("postgres://u:p@db.example.com/db?sslmode=disable")).toEqual({ ssl: "require" });
      expect(databaseTls("postgres://u:p@db.example.com/db?sslmode=verify-full")).toEqual({});
      expect(databaseTls("postgres://u:p@127.0.0.1/db")).toEqual({});
      delete process.env.DATABASE_PASSWORD;
      process.env.DATABASE_URL = "postgres://app:secret@db.example:6543/postgres";
      expect(liveConfigProblem()).toBeNull();
      process.env.TOKEN_ENCRYPTION_KEY = "too-short";
      expect(liveConfigProblem()).toContain("TOKEN_ENCRYPTION_KEY");
      process.env.TOKEN_ENCRYPTION_KEY = saved.TOKEN_ENCRYPTION_KEY;
      delete process.env.APP_URL;
      expect(liveConfigProblem()).toContain("APP_URL");
    } finally {
      for (const key of ["NODE_ENV", "DATABASE_URL", "DATABASE_PASSWORD", "APP_URL", "TOKEN_ENCRYPTION_KEY"]) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});
