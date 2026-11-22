"use client";

import { RefreshCw, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { APP_NAME } from "@/lib/config";
import { diffDays } from "@/lib/dates";
import type { Me, Overview } from "@/lib/types";
import { Celebrations } from "./celebrate";
import { GAME_URL, GameWatcher } from "./game/game";
import { LevelChip } from "./game/level";
import type { GamePayload } from "@/lib/game/progress";
import { SECTIONS, sectionFor } from "./nav";
import { Nickel } from "./nickel/nickel";
import { ReauthHost } from "./reauth";
import { PullToRefresh } from "./pull-to-refresh";
import { ConfirmHost, IconButton, Tag, Toaster, cx } from "./ui";
import { send, useApi, useNow } from "./use-api";

/** The mark: a passbook page with its perforated stub. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <rect x="2" y="3" width="24" height="22" rx="7" fill="var(--accent)" />
      <path d="M11 3v22" stroke="var(--sheet)" strokeWidth="1.6" strokeDasharray="1.6 2.6" strokeLinecap="round" opacity="0.7" />
      <path d="M15.5 10.5h6M15.5 14h6M15.5 17.5h3.5" stroke="var(--on-accent)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="6.6" cy="14" r="1.7" fill="#ffd84d" />
    </svg>
  );
}

function ago(iso: string | null, now: number): string {
  if (!iso) return "Not synced yet";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 10) return "Updated just now";
  if (s < 60) return `Updated ${s}s ago`;
  if (s < 3600) return `Updated ${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `Updated ${Math.round(s / 3600)}h ago`;
  return `Updated ${Math.round(s / 86_400)}d ago`;
}

/** Shows that data is flowing, and when it last changed. */
export function LiveStatus({ compact }: { compact?: boolean }) {
  const { data } = useApi<Overview>("/api/overview");
  const now = useNow(1000);
  const [refreshing, setRefreshing] = useState(false);
  const sync = data?.sync;
  if (!sync || sync.linkedInstitutions === 0) return null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await send("POST", "/api/sync");
    } finally {
      setRefreshing(false);
    }
  };

  if (sync.needsAttention > 0) {
    return (
      <Link href="/accounts" className="rounded-full">
        <Tag tone="canary">{sync.needsAttention === 1 ? "A bank needs a sign-in" : `${sync.needsAttention} banks need a sign-in`}</Tag>
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-2 rounded-full bg-sheet px-3 py-1.5 text-small shadow-card">
        <span aria-hidden className="live-dot size-2 rounded-full bg-good" />
        <span className="font-bold">Live</span>
        {!compact && (
          <span className="tabular text-ink-3" suppressHydrationWarning>
            {now > 0 && ago(sync.lastSyncedAt, now)}
          </span>
        )}
      </span>
      {!compact && (
        <IconButton label="Refresh from your banks" onClick={refresh} disabled={refreshing} className="size-10 bg-sheet shadow-card">
          <RefreshCw size={16} className={refreshing ? "animate-spin" : undefined} />
        </IconButton>
      )}
    </div>
  );
}

function IconTile({ icon: Icon, active }: { icon: LucideIcon; active?: boolean }) {
  return (
    <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors" style={active ? { background: "var(--sec)", color: "var(--sheet)" } : { background: "color-mix(in srgb, var(--sec) 14%, transparent)", color: "var(--sec)" }}>
      <Icon size={18} strokeWidth={2.1} />
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: me } = useApi<Me>("/api/me");
  const { data: overview } = useApi<Overview>("/api/overview");
  const { data: game } = useApi<GamePayload>(GAME_URL);
  const current = sectionFor(pathname);
  // Bills due in the next three days show as a count on the Bills tab.
  const dueSoon = Array.isArray(overview?.upcoming) ? overview.upcoming.filter((b) => diffDays(b.date, overview.today) <= 3).length : 0;
  const level = game?.level ?? null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1320px]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-sheet focus:px-4 focus:py-2">
        Skip to content
      </a>

      {/* Wide screens: the same five places down the side, each with its screens under it. */}
      <aside className="sticky top-0 hidden h-dvh w-[252px] shrink-0 flex-col gap-5 px-4 py-6 lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-2">
          <Logo size={34} />
          <span className="display text-title">{APP_NAME}</span>
        </Link>
        <nav aria-label="Main" className="no-scrollbar flex flex-1 flex-col gap-1 overflow-y-auto">
          {SECTIONS.map((section) => {
            const active = current.key === section.key;
            return (
              <div key={section.key} className={cx(section.key === "you" && "mt-auto")}>
                <Link href={section.href} aria-current={active ? "page" : undefined} className={cx(section.color, "flex min-h-12 items-center gap-3 rounded-2xl px-2.5 font-bold transition-colors", active ? "bg-sheet text-ink shadow-card" : "text-ink-2 hover:bg-sheet/60 hover:text-ink")}>
                  {section.icon ? <IconTile icon={section.icon} active={active} /> : <LevelChip level={level} size={36} />}
                  {section.label}
                  {section.key === "bills" && dueSoon > 0 && <span className="tabular ml-auto rounded-full bg-[var(--c-bills)] px-2 text-micro font-extrabold leading-5 text-sheet">{dueSoon}</span>}
                </Link>
              </div>
            );
          })}
        </nav>
        {me && <p className="truncate px-2.5 text-small text-ink-3">Signed in as {me.user.name}</p>}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="hidden h-16 items-center justify-between gap-3 px-8 lg:flex">
          <div>{me?.demo && <Tag tone="canary">Sample data. Link a bank to see your own.</Tag>}</div>
          <LiveStatus />
        </div>

        <main id="main" className={cx(current.color, "flex-1 px-4 pb-[calc(96px+var(--nickel-space,0px)+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pb-[calc(48px+var(--nickel-space,0px))]")}>
          {children}
        </main>
      </div>

      {/* Phones and upright tablets: all five places along the bottom. Nothing hides under "More". */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-1 border-t border-line-soft bg-sheet/90 px-2 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl lg:hidden">
        {SECTIONS.map((section) => {
          const active = current.key === section.key;
          const Icon = section.icon;
          return (
            <Link
              key={section.key}
              href={section.href}
              aria-current={active ? "page" : undefined}
              aria-label={section.key === "you" && level ? `You, level ${level}` : undefined}
              className={cx(section.color, "relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-bold transition-transform active:scale-95", !active && "text-ink-3")}
              style={active ? { color: "var(--sec)", background: "color-mix(in srgb, var(--sec) 13%, transparent)" } : undefined}
            >
              {Icon ? <Icon size={23} strokeWidth={active ? 2.4 : 1.9} /> : <LevelChip level={level} size={24} />}
              {section.label}
              {section.key === "bills" && dueSoon > 0 && (
                <span className="tabular absolute right-[18%] top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--c-bills)] px-1 text-[11px] font-extrabold text-sheet" aria-label={`${dueSoon} due soon`}>
                  {dueSoon}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <PullToRefresh />
      <Celebrations />
      <GameWatcher />
      <Toaster />
      <ConfirmHost />
      <ReauthHost />
      <Nickel />
    </div>
  );
}
