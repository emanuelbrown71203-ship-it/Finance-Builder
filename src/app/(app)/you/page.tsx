"use client";

import { CalendarCheck, ChevronRight, History, Landmark, PencilLine, Settings, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { GAME_URL } from "@/components/game/game";
import { LevelBlock, XpBar } from "@/components/game/level";
import { Sprite, type SpriteId } from "@/components/game/sprites";
import { weekId } from "@/components/recap";
import { PageHeader, Sheet, Skeleton, Tag } from "@/components/ui";
import { useApi } from "@/components/use-api";
import type { GamePayload } from "@/lib/game/progress";
import type { AccountsPayload, Me } from "@/lib/types";

/*
 * You: your level, streak and badges up top (the game's home), then
 * everything about you and the app, one tap each: the weekly recap, your
 * banks, names you've given, what Nickel and Claude changed, and settings.
 */

function Row({ href, icon: Icon, title, detail, badge }: { href: string; icon: LucideIcon; title: string; detail: string; badge?: ReactNode }) {
  return (
    <li className="border-b border-line-soft last:border-0">
      <Link href={href} className="-mx-1 flex min-h-[64px] items-center gap-3 rounded-2xl px-1 active:bg-sunk">
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-sunk text-ink-2">
          <Icon size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-bold">
            {title}
            {badge}
          </span>
          <span className="block truncate text-small text-ink-3">{detail}</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-ink-3" />
      </Link>
    </li>
  );
}

/** Whether this week's recap hasn't been opened yet (kept on this device, like the nudge on Home was). */
function useRecapNew(today: string | undefined): boolean {
  const seen = useSyncExternalStore(
    (l) => {
      window.addEventListener("passbook-recap-seen-change", l);
      return () => window.removeEventListener("passbook-recap-seen-change", l);
    },
    () => {
      try {
        return localStorage.getItem("passbook-recap-seen");
      } catch {
        return null;
      }
    },
    () => "unknown",
  );
  return !!today && seen !== "unknown" && seen !== weekId(today);
}

export default function YouPage() {
  const { data: game } = useApi<GamePayload>(GAME_URL);
  const { data: me } = useApi<Me>("/api/me");
  const { data: accounts } = useApi<AccountsPayload>("/api/accounts");
  const recapNew = useRecapNew(me?.today);
  const banks = accounts?.institutions.length ?? 0;
  const won = game?.badges.filter((b) => b.earned) ?? [];

  return (
    <>
      <PageHeader title={me && !me.demo ? me.user.name.split(" ")[0] : "You"} />
      <div className="grid max-w-2xl grid-cols-1 gap-4">
        {game ? (
          <Sheet>
            <div className="flex items-center gap-4">
              <LevelBlock level={game.level} size={76} />
              <div className="min-w-0 flex-1">
                <h2 className="display text-title">Level {game.level}</h2>
                <p className="mt-1 text-ink-2">
                  <span className="tabular font-bold text-ink">{game.needed - game.into} XP</span> to level {game.level + 1}
                </p>
              </div>
              <span className={game.streak > 0 ? "flex flex-col items-center gap-1" : "flex flex-col items-center gap-1 opacity-50"} aria-label={`${game.streak}-day streak`}>
                <Sprite id="flame" size={30} locked={game.streak === 0} />
                <span className="pixel text-[10px]">{game.streak}</span>
              </span>
            </div>
            <XpBar into={game.into} needed={game.needed} blocks={16} className="mt-5" />
            <p className="mt-2 flex justify-between text-small text-ink-3">
              <span className="tabular">
                {game.into} of {game.needed} XP
              </span>
              <span className="tabular">
                {game.todayXp > 0 ? `+${game.todayXp} today` : "Nothing yet today"}, best streak {game.bestStreak} {game.bestStreak === 1 ? "day" : "days"}
              </span>
            </p>
            <Link href="/progress" className="-mx-1 mt-4 flex min-h-[60px] items-center gap-3 rounded-2xl border-t border-line-soft px-1 pt-2 active:bg-sunk">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden" aria-hidden>
                {won.slice(0, 7).map((b) => (
                  <Sprite key={b.id} id={b.id as SpriteId} size={30} />
                ))}
                {won.length === 0 && <Sprite id="first-win" size={30} locked />}
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-bold">Badges</span>
                <span className="block text-small text-ink-3">
                  {won.length} of {game.badges.length}, and how to earn XP
                </span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-ink-3" />
            </Link>
          </Sheet>
        ) : (
          <Skeleton className="h-64 rounded-sheet" />
        )}

        <Sheet>
          <ul>
            <Row href="/recap" icon={CalendarCheck} title="Weekly review" detail="Last week in money, the week ahead, and a quick check-in" badge={recapNew ? <Tag tone="sky">New</Tag> : undefined} />
            <Row href="/accounts" icon={Landmark} title="Accounts" detail={banks > 0 ? `${banks} ${banks === 1 ? "bank" : "banks"} linked` : "Link a bank, card or lender"} />
            <Row href="/transactions/names" icon={PencilLine} title="Names" detail="Charges you’ve renamed, and bank code to tidy" />
            <Row href="/settings/activity" icon={History} title="Activity" detail="What Nickel and Claude changed for you, with Undo" />
            <Row href="/settings" icon={Settings} title="Settings" detail="Light or dark, Nickel, sounds, Face ID, Claude, your account" />
          </ul>
        </Sheet>
      </div>
    </>
  );
}
