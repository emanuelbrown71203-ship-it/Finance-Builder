"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-errors";

/**
 * The last line of defence: shown if even the app's outer frame breaks. It
 * can't rely on the app's styles, so it carries its own.
 */
export default function GlobalError({ error }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportClientError("boundary", error);
  }, [error]);
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#f1eeff", color: "#1a1530" }}>
        <main style={{ maxWidth: 420, margin: "0 auto", padding: "64px 20px" }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>Passbook didn’t load</h1>
          <p style={{ color: "#4a4370", lineHeight: 1.5 }}>Something broke. It has been reported, so it can be fixed. Reloading usually gets you going again.</p>
          <button onClick={() => window.location.reload()} style={{ width: "100%", minHeight: 48, border: 0, borderRadius: 14, background: "#5b3df5", color: "#fff", fontSize: 16, fontWeight: 700 }}>
            Reload
          </button>
          {detail && <p style={{ marginTop: 24, fontSize: 13, color: "#6b6590", wordBreak: "break-word" }}>Details: {detail.slice(0, 200)}</p>}
        </main>
      </body>
    </html>
  );
}
