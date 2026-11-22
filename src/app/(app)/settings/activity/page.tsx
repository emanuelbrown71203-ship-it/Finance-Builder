"use client";

import { Dog, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState, ErrorNote, PageHeader, Sheet, Skeleton, Tag, cx, toast } from "@/components/ui";
import { send, useApi, useNow } from "@/components/use-api";
import type { ActivityItem } from "@/lib/types";

function ago(iso: string, now: number): string {
  if (!now) return "";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr ago`;
  const days = Math.round(minutes / 1440);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** What Nickel and Claude have changed for the owner, newest first, each with Undo. */
export default function ActivityPage() {
  const { data, error, mutate } = useApi<{ items: ActivityItem[] }>("/api/activity");
  const now = useNow(60_000);
  const [busy, setBusy] = useState<string | null>(null);

  const undo = async (item: ActivityItem) => {
    setBusy(item.id);
    try {
      await send("POST", `/api/activity/${item.id}/undo`);
      toast("Undone");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t undo. Try again.", { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Activity" back={{ href: "/you", label: "You" }} lead="What Nickel and Claude changed when you asked them to. Undo any of it here for 30 days." />
      {error && !data ? (
        <ErrorNote message={error.message} onRetry={() => mutate()} />
      ) : !data ? (
        <Skeleton className="h-64 max-w-2xl rounded-sheet" />
      ) : data.items.length === 0 ? (
        <Sheet className="max-w-2xl">
          <EmptyState title="Nothing yet">Ask Nickel (hold him) or Claude to add a bill, a goal or an upcoming payment, and what they did shows up here.</EmptyState>
        </Sheet>
      ) : (
        <Sheet className="max-w-2xl">
          <ul className="divide-y divide-line-soft">
            {data.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 py-3">
                <span aria-hidden className={cx("mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-xl", item.actor === "nickel" ? "bg-mint text-mint-ink" : "bg-sky text-sky-ink")}>
                  {item.actor === "nickel" ? <Dog size={19} /> : <Sparkles size={19} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block break-words", item.undone && "text-ink-3 line-through")}>{item.summary}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-small text-ink-3">
                    <span suppressHydrationWarning>
                      {item.actor === "nickel" ? "Nickel" : "Claude"}, {ago(item.createdAt, now)}
                    </span>
                    {item.undone && <Tag>Undone</Tag>}
                  </span>
                </span>
                {item.canUndo && (
                  <Button size="sm" disabled={busy === item.id} onClick={() => undo(item)}>
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </>
  );
}
