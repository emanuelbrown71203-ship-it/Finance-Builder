"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { LevelBlock, XpBar } from "@/components/game/level";
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
  plan: { what: "Tune your debt payoff plan", href: "/debt" },
  nospend: { what: "Have a day with no everyday spending", href: null },
};

const ORDER: WinKind[] = ["checkin", "sort", "rename", "note", "bill", "cancel", "budget", "goal", "save", "milestone", "plan", "nospend"];

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-control bg-sunk px-3 py-2.5">
      <p className="text-micro font-bold text-ink-3">{label}</p>
      <p className="mt-1.5 truncate">{children}</p>
    </div>
  );
}

export default function ProgressPage() {
  const { data, error, mutate } = useApi<GamePayload>(GAME_URL);

  if (error && !data) {
    return (
      <>
        <PageHeader title="Progress" />
        <ErrorNote message={error.message} onRetry={() => mutate()} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Progress" />
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
      <PageHeader title="Progress" lead="Small wins with your money add up to XP, levels and badges." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <Sheet>
          <div className="flex items-center gap-4">
            <LevelBlock level={data.level} size={80} />
            <div className="min-w-0 flex-1">
              <h2 className="display text-title">Level {data.level}</h2>
              <p className="mt-1 text-ink-2">
                <span className="tabular font-bold text-ink">{data.needed - data.into} XP</span> to level {data.level + 1}
              </p>
            </div>
          </div>
          <XpBar into={data.into} needed={data.needed} blocks={16} className="mt-5" />
          <p className="mt-2 flex justify-between text-small text-ink-3">
            <span className="tabular">
              {data.into} of {data.needed} XP
            </span>
            <span className="tabular">{data.xp} XP in all</span>
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat label="Today">
              <span className="pixel text-[12px] text-accent-text">+{data.todayXp}</span>
            </Stat>
            <Stat label="Streak">
              <span className="inline-flex items-center gap-1.5">
                <Sprite id="flame" size={18} locked={data.streak === 0} />
                <span className="font-bold">
                  {data.streak} {data.streak === 1 ? "day" : "days"}
                </span>
              </span>
            </Stat>
            <Stat label="Best streak">
              <span className="font-bold">
                {data.bestStreak} {data.bestStreak === 1 ? "day" : "days"}
              </span>
            </Stat>
          </div>
        </Sheet>

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
