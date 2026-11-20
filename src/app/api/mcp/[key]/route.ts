import { contextForKey, handleRpc } from "@/server/connector";
import { describeError } from "@/server/errors";
import { HttpError } from "@/server/http";
import { assertUnderLimit, clientAddress, limit, limitKey } from "@/server/rate-limit";

/**
 * The Claude connector endpoint: POST …/api/mcp/<key>. The key in the address
 * is what proves who is asking, so no cookies are read here and the answers
 * are never cached.
 */
const answer = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, route: { params: Promise<{ key: string }> }) {
  const { key } = await route.params;
  try {
    // Wrong keys are limited per address so the key can't be guessed by trying many.
    await limit(request, "mcp-address", 300, 60_000);
    // After ten wrong keys from one address, nothing from it is looked up for ten minutes, right key or not.
    await assertUnderLimit("mcp-miss", clientAddress(request), 10, 10 * 60_000);
    const ctx = await contextForKey(key);
    if (!ctx) {
      await limit(request, "mcp-miss", 10, 10 * 60_000).catch(() => {});
      return answer({ error: "This connector link was switched off. Make a new one in Passbook, Settings, Connect to Claude." }, 404);
    }
    await limitKey("mcp-key", ctx.userId, 120, 60_000);

    const text = await request.text();
    if (text.length > 100_000) return answer({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return answer({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }
    if (Array.isArray(payload)) {
      const out = (await Promise.all(payload.slice(0, 20).map((m) => handleRpc(m, ctx)))).filter((r) => r !== null);
      return out.length ? answer(out) : new Response(null, { status: 202 });
    }
    const out = await handleRpc(payload as never, ctx);
    return out === null ? new Response(null, { status: 202 }) : answer(out);
  } catch (error) {
    if (error instanceof HttpError) return answer({ error: error.message }, error.status);
    console.error(describeError(error));
    return answer({ error: "Something went wrong on our side. Try again." }, 500);
  }
}

export function GET() {
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
}
