/**
 * Sends a short note about something that broke in the browser to
 * /api/client-error. Never throws. At most a few notes per page load.
 */
let sent = 0;

export function reportClientError(kind: "error" | "rejection" | "resource" | "csp" | "boundary", error: unknown, extra?: { message?: string }) {
  if (typeof window === "undefined" || sent >= 6) return;
  sent++;
  const e = error instanceof Error ? error : null;
  const digest = (error as { digest?: unknown } | null)?.digest;
  try {
    void fetch("/api/client-error", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        message: String(extra?.message ?? e?.message ?? error ?? "").slice(0, 500),
        stack: e?.stack?.slice(0, 2500),
        path: window.location.pathname,
        digest: typeof digest === "string" ? digest : undefined,
        build: process.env.NEXT_PUBLIC_BUILD_ID,
        agent: navigator.userAgent.slice(0, 200),
      }),
    }).catch(() => {});
  } catch {}
}
