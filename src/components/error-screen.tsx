"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { reportClientError } from "@/lib/client-errors";
import { Button } from "./ui";

/**
 * What a screen shows when something on it breaks, instead of going blank.
 * Says what happened, offers a way out, and quietly reports the cause.
 */
export function ErrorScreen({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportClientError("boundary", error);
  }, [error]);
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return (
    <main className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col justify-center px-5 py-12">
      <h1 className="display text-headline">This screen didn’t load</h1>
      <p className="mt-2 text-ink-2">Something on it broke. It has been reported, so it can be fixed. Reloading usually gets you going again.</p>
      <div className="mt-6 flex flex-col gap-2">
        <Button
          variant="primary"
          onClick={() => {
            retry();
            window.location.reload();
          }}
        >
          <RotateCcw size={17} /> Reload
        </Button>
        <Button
          onClick={() => {
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign("/");
          }}
        >
          Go to Home
        </Button>
      </div>
      {detail && <p className="mt-6 break-words text-small text-ink-3">Details: {detail.slice(0, 200)}</p>}
    </main>
  );
}
