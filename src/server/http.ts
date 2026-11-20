import { z } from "zod";
import { isDemoMode, liveConfigProblem, siteOrigin } from "@/lib/config";
import { getContext, type Ctx } from "./auth";
import { HttpError, describeError } from "./errors";
import { clientAddress, limitKey } from "./rate-limit";

export { HttpError };

export function json(data: unknown, init?: ResponseInit): Response {
  // Answers about someone's money are never stored by a browser or anything in between.
  const headers = new Headers(init?.headers);
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return Response.json(data, { ...init, headers });
}

/**
 * Rejects writes that didn't come from our own pages. The session cookie is
 * SameSite=Lax already; this is a second, independent check.
 *
 * Every current browser says where a write came from (the Origin header, or
 * Sec-Fetch-Site). A write that says neither is refused rather than trusted.
 *
 * With real data the only accepted origin is the configured APP_URL, scheme
 * included. What a request claims about its own host is used only for sample
 * data and local development, where there is nothing to protect.
 */
function assertSameOrigin(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const configured = siteOrigin();
  const strict = configured !== null && !isDemoMode();
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(origin);
    } catch {}
    if (parsed && configured && parsed.origin === configured) return;
    if (parsed && !strict && parsed.host === host) return;
  } else if (fetchSite === "same-origin") {
    if (!strict || host === new URL(configured!).host) return;
  }
  throw new HttpError(403, "That request didn’t come from this app, so it was blocked.");
}

/** Refuses to answer at all when the site holds real data but isn't fully set up. */
function assertReady() {
  const problem = liveConfigProblem();
  if (!problem) return;
  console.error(problem);
  throw new HttpError(503, "This site isn’t fully set up yet.");
}

function failure(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message, ...error.extra }, { status: error.status });
  if (error instanceof z.ZodError) return json({ error: "That request wasn’t valid." }, { status: 400 });
  // A short, scrubbed description goes to the server log: never the error object itself,
  // which can carry keys, bank tokens or the values a query was run with.
  console.error(describeError(error));
  return json({ error: "Something went wrong on our side. Try again." }, { status: 500 });
}

/** How recently someone must have proved who they are before changing how the account is reached. */
const FRESH_MS = 10 * 60_000;

/** Throws unless this person signed in, or confirmed their password or passkey, in the last few minutes. */
export function assertFresh(ctx: Ctx) {
  if (ctx.demo) return;
  if (ctx.authAt && Date.now() - ctx.authAt.getTime() < FRESH_MS) return;
  throw new HttpError(403, "Confirm it’s you to continue.", { reauth: true });
}

/** Wraps a route handler that needs a signed-in person. */
export function withUser<P = unknown>(handler: (ctx: Ctx, request: Request, params: P) => Promise<Response | object>, options?: { fresh?: boolean }) {
  return async (request: Request, route: { params: Promise<P> }): Promise<Response> => {
    try {
      assertReady();
      assertSameOrigin(request);
      const ctx = await getContext(request);
      if (!ctx) return json({ error: "Sign in to continue." }, { status: 401 });
      if (options?.fresh) assertFresh(ctx);
      // A ceiling on how fast anything can be changed, per person and per address.
      if (request.method !== "GET" && request.method !== "HEAD") {
        await limitKey("write", ctx.demo ? clientAddress(request) : ctx.userId, 240, 60_000);
      }
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
      assertReady();
      assertSameOrigin(request);
      const result = await handler(request);
      return result instanceof Response ? result : json(result);
    } catch (error) {
      return failure(error);
    }
  };
}

/** The largest request body any screen sends is a few kilobytes; anything far bigger is refused unread. */
const MAX_BODY = 256_000;

export async function readBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) throw new HttpError(413, "That request was too large.");
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) throw new HttpError(413, "That request was too large.");
    raw = JSON.parse(text);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Expected a JSON body.");
  }
  return schema.parse(raw);
}
