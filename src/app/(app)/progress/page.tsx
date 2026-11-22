"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Sprite, type SpriteId } from "@/components/game/sprites";
import { GAME_URL } from "@/components/game/game";
import { EmptyState, ErrorNote, PageHeader, Sheet, SheetHeader, Skeleton, cx } from "@/components/ui";
import { useApi } from "@/components/use-api";
import { formatShort } from "@/lib/dates";
import { WINS, type GamePayload, type WinKind } from "@/lib/game/progress";

/*
 * Progress: the level and XP, the streak, the badges (won in colour, the rest
 * greyed with how to win them), what earns XP and where to go to do it, and
 * the latest wins.
 */

const DO: Record<WinKind, { what: string; href: string | null }> = {
  checkin: { what: "Open Passbook", href: null },
  sort: { what: "Sort a charge into a category", href: "/transactions" },
  rename: { what: "Give a charge a clear name", href: "/transactions/names" },
  note: { what: "Add a note to a charge", href: "/transactions" },
  bill: { what: "Add a bill", href: "/bills" },
  cancel: { what: "Cancel a subscription", href: "/bills" },
  goal: { what: "Make a savings goal", href: "/savings" },
  save: { what: "Put money toward a goal", href: "/savings" },
  milestone: { what: "Get a goal to 25%, 50%, 75% or done", href: "/savings" },
  budget: { what: "Set a budget limit", href: "/budget" },
  under: { what: "Finish a month under budget in a category", href: "/budget" },
  allunder: { what: "Keep every budget for a whole month", href: "/budget" },
  plan: { what: "Tune your debt payoff plan", href: "/debt" },
  nospend: { what: "Have a day with no everyday spending", href: null },
  import: { what: "Bring in your Apple Card statement", href: "/accounts" },
};

const ORDER: WinKind[] = ["checkin", "budget", "under", "allunder", "sort", "rename", "note", "bill", "cancel", "goal", "save", "milestone", "plan", "import", "nospend"];

export default function ProgressPage() {
  const { data, error, mutate } = useApi<GamePayload>(GAME_URL);

  if (error && !data) {
    return (
      <>
        <PageHeader title="Badges" back={{ href: "/you", label: "You" }} />
        <ErrorNote message={error.message} onRetry={() => mutate()} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Badges" back={{ href: "/you", label: "You" }} />
        <div className="grid grid-cols-1 gap-4">
          <Skeleton className="h-56 rounded-sheet" />
          <Skeleton className="h-80 rounded-sheet" />
        </div>
      </>
    );
  }

  const won = data.badges.filter((b) => b.earned).length;

  return (
    <div className="sec-budget">
      <PageHeader title="Badges" back={{ href: "/you", label: "You" }} lead="Small wins with your money add up to XP, levels and badges." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Sheet className="lg:row-span-2">
          <SheetHeader title="Badges" hint={`${won} of ${data.badges.length} won. The grey ones say how to win them.`} />
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {data.badges.map((b) => (
              <li key={b.id} className={cx("flex flex-col items-center gap-2 rounded-control px-1.5 pb-3 pt-3.5 text-center", b.earned ? "bg-sunk" : "border border-dashed border-line")}>
                <Sprite id={b.id as SpriteId} size={44} locked={!b.earned} />
                <span className={cx("text-small font-bold leading-tight", !b.earned && "text-ink-2")}>{b.name}</span>
                <span className="text-micro leading-snug text-ink-3">{b.earned ? "Won" : b.how}</span>
              </li>
            ))}
          </ul>
        </Sheet>

        <Sheet>
          <SheetHeader title="How to earn XP" hint="Each thing counts once, up to a few a day. Undo on the same day takes the XP back." />
          <ul className="-mx-1 flex flex-col">
            {ORDER.map((kind) => {
              const row = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{DO[kind].what}</span>
                    <span className="block text-small text-ink-3">{WINS[kind].perDay === 1 ? "Once a day" : `Up to ${WINS[kind].perDay} a day`}</span>
                  </span>
                  <span className="pixel shrink-0 text-[10px] text-accent-text">+{WINS[kind].xp}</span>
                  {DO[kind].href ? <ChevronRight size={18} className="shrink-0 text-ink-3" /> : <span className="w-[18px] shrink-0" />}
                </>
              );
              return (
                <li key={kind} className="border-b border-line-soft last:border-0">
                  {DO[kind].href ? (
                    <Link href={DO[kind].href} className="flex min-h-[60px] items-center gap-3 rounded-xl px-1 active:bg-sunk">
                      {row}
                    </Link>
                  ) : (
                    <div className="flex min-h-[60px] items-center gap-3 px-1">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Sheet>

        <Sheet>
          <SheetHeader title="Latest wins" />
          {data.recent.length > 0 ? (
            <ul className="flex flex-col">
              {data.recent.map((w) => (
                <li key={w.id} className="flex min-h-[52px] items-center gap-3 border-b border-line-soft py-2 last:border-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{w.title}</span>
                    <span className="block truncate text-small text-ink-3">{w.label ? `${w.label}, ${formatShort(w.day)}` : formatShort(w.day)}</span>
                  </span>
                  <span className="pixel shrink-0 text-[10px] text-accent-text">+{w.xp}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No wins yet">Sort a charge or add a bill for your first one.</EmptyState>
          )}
        </Sheet>
      </div>
    </div>
  );
}
