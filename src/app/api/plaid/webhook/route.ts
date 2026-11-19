import { after } from "next/server";
import { getDb } from "@/db";
import { plaidConfig } from "@/lib/config";
import { json } from "@/server/http";
import { handleWebhook, verifyWebhook } from "@/server/plaid";

/**
 * Plaid calls this when a bank has new data. We check the signature, answer
 * right away, and do the sync after the response so Plaid never times out.
 */
export async function POST(request: Request) {
  if (!plaidConfig()) return json({ error: "Not configured." }, { status: 404 });
  const raw = await request.text();
  if (!(await verifyWebhook(raw, request.headers.get("plaid-verification")))) {
    return json({ error: "Invalid signature." }, { status: 401 });
  }
  const body = JSON.parse(raw);
  after(async () => {
    try {
      await handleWebhook(await getDb(), body);
    } catch (error) {
      console.error("Webhook handling failed", error);
    }
  });
  return json({ received: true });
}
