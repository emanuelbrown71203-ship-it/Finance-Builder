import { contextForTapKey, recordTap } from "@/server/card-taps";
import { describeError } from "@/server/errors";
import { HttpError } from "@/server/http";
import { limit, limitKey } from "@/server/rate-limit";

/**
 * The tap link: POST …/api/tap/<key> with {"amount": …, "merchant": …}, sent by
 * an iPhone Shortcuts automation each time Apple Card is tapped. The key in the
 * address is what proves whose card it is, so no cookies are read here. It can
 * only add a pending Apple Card purchase; it reads nothing back.
 */
const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, route: { params: Promise<{ key: string }> }) {
  const { key } = await route.params;
  try {
    // A ceiling per address. The key itself is 240 random bits, so it can't be found by trying.
    await limit(request, "tap-address", 60, 60_000);
    const ctx = await contextForTapKey(key);
    if (!ctx) return answer({ error: "This tap link was switched off. Make a new one in Passbook: You, Accounts, Apple Card." }, 404);
    // Nobody taps a card this often: a runaway automation stops here.
    await limitKey("tap-key", ctx.userId, 20, 60_000);
    await limitKey("tap-day", ctx.userId, 200, 86_400_000);

    if (Number(request.headers.get("content-length") ?? 0) > 2_000) return answer({ error: "That was too much for one tap." }, 413);
    const text = await request.text();
    if (text.length > 2_000) return answer({ error: "That was too much for one tap." }, 413);
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(text || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      return answer({ error: "Send the tap as JSON: amount and merchant." }, 400);
    }
    // Shortcuts may name the fields with a capital letter.
    return answer(await recordTap(ctx, { amount: body.amount ?? body.Amount, merchant: body.merchant ?? body.Merchant }));
  } catch (error) {
    if (error instanceof HttpError) return answer({ error: error.message }, error.status);
    console.error("Apple Card tap:", describeError(error));
    return answer({ error: "Something went wrong on our side. The purchase will come in with your statement." }, 500);
  }
}

export function GET() {
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
}
