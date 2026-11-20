/** An error with a status and a message that is safe to show the person. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Extra fields for the app's own screens, e.g. `{ reauth: true }`. */
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Loose = Error & {
  code?: unknown;
  query?: unknown;
  cause?: unknown;
  response?: { status?: unknown; data?: { error_code?: unknown; error_type?: unknown } };
};

const short = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").slice(0, max);

/**
 * What may be written to the server log about a failure.
 *
 * Never log an error object as it is. A failed call to another service
 * carries the request that was sent (our keys, a bank token), and a failed
 * database query carries the values it was run with (an email, a password
 * hash). This keeps the kind of error, a status or code, the SQL text
 * without its values, and where in our code it happened.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "A non-error value was thrown.";
  const e = error as Loose;
  const where = (e.stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .slice(0, 6)
    .join("\n");
  let what: string;
  if (e.response && typeof e.response === "object") {
    // A call to another service that came back with an error. The message, config and body are left out.
    what = `${e.name}: upstream answered ${short(e.response.status, 5)} ${short(e.response.data?.error_type, 40)} ${short(e.response.data?.error_code, 60)}`.trim();
  } else if (typeof e.query === "string") {
    const cause = e.cause instanceof Error ? (e.cause as Loose) : null;
    what = `Database error ${short(cause?.code, 10)}: ${short(cause?.message, 200)} in: ${short(e.query, 300)}`;
  } else if ("config" in e || "request" in e) {
    // A network failure from the HTTP client: no response, but the request is still attached.
    what = `${e.name}: ${short(e.code, 40) || "request failed"}`;
  } else {
    what = `${e.name}: ${short(e.message, 300)}`;
  }
  return where ? `${what}\n${where}` : what;
}
