import { z } from "zod";
import { getContext, type Ctx } from "./auth";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, { ...init, headers: { "cache-control": "no-store", ...init?.headers } });
}

/**
 * Rejects cross-site writes. The session cookie is SameSite=Lax already; this
 * is a second check that the browser says the request came from our own pages.
 */
function assertSameOrigin(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  if (!origin) return; // Non-browser clients don’t send Origin and don’t carry cookies ambiently.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (new URL(origin).host !== host) throw new HttpError(403, "Cross-site request blocked.");
}

function failure(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return json({ error: "That request wasn’t valid.", details: error.issues }, { status: 400 });
  console.error(error);
  return json({ error: "Something went wrong on our side. Try again." }, { status: 500 });
}

/** Wraps a route handler that needs a signed-in person. */
export function withUser<P = unknown>(handler: (ctx: Ctx, request: Request, params: P) => Promise<Response | object>) {
  return async (request: Request, route: { params: Promise<P> }): Promise<Response> => {
    try {
      assertSameOrigin(request);
      const ctx = await getContext(request);
      if (!ctx) return json({ error: "Sign in to continue." }, { status: 401 });
      const result = await handler(ctx, request, await route.params);
      return result instanceof Response ? result : json(result);
    } catch (error) {
      return failure(error);
    }
  };
}

/** Wraps a route handler that anyone may call (sign in, webhooks). */
export function publicRoute(handler: (request: Request) => Promise<Response | object>) {
  return async (request: Request): Promise<Response> => {
    try {
      assertSameOrigin(request);
      const result = await handler(request);
      return result instanceof Response ? result : json(result);
    } catch (error) {
      return failure(error);
    }
  };
}

export async function readBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "Expected a JSON body.");
  }
  return schema.parse(raw);
}
