import { after } from "next/server";
import { getDb } from "@/db";
import { liveConfigProblem, plaidConfig } from "@/lib/config";
import { describeError } from "@/server/errors";
import { HttpError, json } from "@/server/http";
import { handleWebhook, verifyWebhook } from "@/server/plaid";
import { limit } from "@/server/rate-limit";

/**
 * Plaid calls this when a bank has new data. We check the signature, answer
 * right away, and do the sync after the response so Plaid never times out.
 */
export async function POST(request: Request) {
  if (!plaidConfig() || liveConfigProblem()) return json({ error: "Not configured." }, { status: 404 });
  try {
    // Anyone can call this address. A ceiling per caller keeps junk from being checked against Plaid without end.
    await limit(request, "plaid-webhook", 60, 60_000);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
    console.error(describeError(error));
    return json({ error: "Try again." }, { status: 500 });
  }
  const raw = await request.text();
  if (raw.length > 100_000 || !(await verifyWebhook(raw, request.headers.get("plaid-verification")))) {
    return json({ error: "Invalid signature." }, { status: 401 });
  }
  const body = JSON.parse(raw);
  after(async () => {
    try {
      await handleWebhook(await getDb(), body);
    } catch (error) {
      console.error("Webhook handling failed:", describeError(error));
    }
  });
  return json({ received: true });
}
