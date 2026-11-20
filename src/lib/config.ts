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
export const APP_VERSION = "0.2.0";

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

export const DEMO_USER_ID = "demo-user";
export const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || "America/New_York";
export const SESSION_COOKIE = "passbook_session";
