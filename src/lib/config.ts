/**
 * Runtime configuration, read from environment variables.
 *
 * The app has two modes:
 *  - Demo: no Plaid keys. Everyone sees one seeded sample household and a
 *    simulator adds transactions while you watch. No sign-in.
 *  - Live: Plaid keys are set. People sign in and link their own banks.
 */

export const APP_NAME = "Passbook";
/** Shown in Settings. Bump it with every change: small fixes 0.2.0 → 0.2.1, new features 0.2 → 0.3. */
export const APP_VERSION = "0.3.1";

export type PlaidEnv = "sandbox" | "production";

export function plaidConfig() {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) return null;
  const env: PlaidEnv = process.env.PLAID_ENV === "production" ? "production" : "sandbox";
  return {
    clientId,
    secret,
    env,
    webhookUrl: process.env.PLAID_WEBHOOK_URL || (process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, "")}/api/plaid/webhook` : undefined),
    redirectUri: process.env.PLAID_REDIRECT_URI || undefined,
  };
}

export function isDemoMode(): boolean {
  if (process.env.DEMO_MODE === "1") return true;
  if (process.env.DEMO_MODE === "0") return false;
  return plaidConfig() === null;
}

/**
 * The one address this app is served from, e.g. "https://passbook.example.com".
 * With real data it must be set: sign-in, passkeys and the "did this come from
 * our own pages" check are all tied to it, never to whatever a request claims.
 */
export function siteOrigin(): string | null {
  const raw = process.env.APP_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * With real data, everything the app needs to keep it safe has to be in
 * place before it will answer. Returns what is missing, or null when ready.
 * (Checked on a deployed site only, so local testing can use the built-in database.)
 */
export function liveConfigProblem(): string | null {
  if (isDemoMode() || process.env.NODE_ENV !== "production") return null;
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!siteOrigin()) missing.push("APP_URL");
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key || Buffer.from(key, "base64").length !== 32) missing.push("TOKEN_ENCRYPTION_KEY");
  return missing.length ? `Not ready for real data. Missing or invalid: ${missing.join(", ")}.` : null;
}

/** New accounts need this code. With none set, nobody new can sign up. */
export function signupCode(): string | null {
  return process.env.SIGNUP_CODE?.trim() || null;
}

/** The one Tasks for Two server the bills link may talk to, e.g. "abcd1234.supabase.co". */
export function tasksHost(): string | null {
  return process.env.TASKS_FOR_TWO_HOST?.trim().toLowerCase() || null;
}

export const DEMO_USER_ID = "demo-user";
export const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || "America/New_York";
/**
 * In production the cookie name starts with "__Host-". Browsers then refuse it
 * unless it is Secure, for this exact site only, and set over https, which
 * stops another site or a sub-domain from planting a session.
 */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-passbook_session" : "passbook_session";
