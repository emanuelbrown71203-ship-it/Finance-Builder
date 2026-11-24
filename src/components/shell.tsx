"use client";

import { RefreshCw } from "lucide-react";
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
import { SECTIONS, sectionFor, under } from "./nav";
import { NickelMark } from "./nickel/mark";
import { Nickel } from "./nickel/nickel";
import { PixelIcon, type PixelName } from "./pixel-icons";
import { PushKeeper } from "./push";
import { ReauthHost } from "./reauth";
import { PullToRefresh } from "./pull-to-refresh";
import { ConfirmHost, Dialog, IconButton, Tag, Toaster, cx } from "./ui";
import { send, useApi, useNow } from "./use-api";
import { setCustomCategories } from "@/lib/categories";

/** The mark: Nickel on his arcade tile. */
export function Logo({ size = 28 }: { size?: number }) {
  return <NickelMark size={size} />;
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
      <span className="edge flex items-center gap-2 rounded-[8px] bg-sheet px-3 py-1.5 text-small">
        <span aria-hidden className="live-dot size-2 rounded-full bg-good" />
        <span className="font-bold">Live</span>
        {!compact && (
          <span className="tabular text-ink-3" suppressHydrationWarning>
            {now > 0 && ago(sync.lastSyncedAt, now)}
          </span>
        )}
      </span>
      {!compact && (
        <IconButton label="Refresh from your banks" onClick={refresh} disabled={refreshing} className="edge size-10 rounded-[8px] bg-sheet">
          <RefreshCw size={16} className={refreshing ? "animate-spin" : undefined} />
        </IconButton>
      )}
    </div>
  );
}

function IconTile({ icon, active }: { icon: PixelName; active?: boolean }) {
  return (
    <span aria-hidden className={cx("inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] border-2 transition-colors", active ? "tab-on" : "border-transparent")} style={active ? undefined : { background: "color-mix(in srgb, var(--sec) 14%, transparent)", color: "var(--sec)" }}>
      <PixelIcon name={icon} size={18} />
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: me } = useApi<Me>("/api/me");
  // The person's own categories, known to every screen below before it draws.
  if (me) setCustomCategories(me.categories ?? []);
  const { data: overview } = useApi<Overview>("/api/overview");
  const { data: game } = useApi<GamePayload>(GAME_URL);
  const current = sectionFor(pathname);
  // Bills due in the next three days show as a count on the Bills tab.
  const dueSoon = Array.isArray(overview?.upcoming) ? overview.upcoming.filter((b) => diffDays(b.date, overview.today) <= 3).length : 0;
  const level = game?.level ?? null;
  const [wealthOpen, setWealthOpen] = useState(false);
  const wealth = SECTIONS.find((s) => s.key === "wealth")!;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1320px]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-sheet focus:px-4 focus:py-2">
        Skip to content
      </a>

      {/* Wide screens: the places down the side, with Wealth's four screens listed on their own. */}
      <aside className="sticky top-0 hidden h-dvh w-[252px] shrink-0 flex-col gap-5 px-4 py-6 lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-2">
          <Logo size={34} />
          <span className="display text-title glow-figure-soft">{APP_NAME}</span>
        </Link>
        <nav aria-label="Main" className="no-scrollbar flex flex-1 flex-col gap-1 overflow-y-auto">
          {SECTIONS.map((section) => {
            const active = current.key === section.key;
            if (section.key === "wealth") {
              return section.pages.map((page) => {
                const on = under(pathname, page.href);
                return (
                  <Link key={page.href} href={page.href} aria-current={on ? "page" : undefined} className={cx(page.color, "flex min-h-12 items-center gap-3 rounded-[12px] border-2 px-2.5 font-bold transition-colors", on ? "edge bg-sheet text-ink shadow-card" : "border-transparent text-ink-2 hover:bg-sheet/60 hover:text-ink")}>
                    <IconTile icon={page.icon!} active={on} />
                    {page.label}
                  </Link>
                );
              });
            }
            return (
              <div key={section.key} className={cx(section.key === "you" && "mt-auto")}>
                <Link href={section.href} aria-current={active ? "page" : undefined} className={cx(section.color, "flex min-h-12 items-center gap-3 rounded-[12px] border-2 px-2.5 font-bold transition-colors", active ? "edge bg-sheet text-ink shadow-card" : "border-transparent text-ink-2 hover:bg-sheet/60 hover:text-ink")}>
                  {section.icon ? <IconTile icon={section.icon} active={active} /> : <LevelChip level={level} size={36} />}
                  {section.label}
                  {section.key === "bills" && dueSoon > 0 && <span className="tabular ml-auto rounded-[5px] bg-[var(--c-bills)] px-2 text-micro font-extrabold leading-5 text-paper">{dueSoon}</span>}
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

      {/* Phones and upright tablets: all five places along the bottom. Wealth opens a sheet of its four screens. */}
      <nav aria-label="Main" className="tab-bar fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-1 bg-sheet/95 px-2 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl lg:hidden">
        {SECTIONS.map((section) => {
          const active = current.key === section.key;
          const Icon = section.icon;
          if (section.key === "wealth") {
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => setWealthOpen(true)}
                aria-haspopup="dialog"
                aria-current={active ? "page" : undefined}
                className={cx(section.color, "relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-[10px] border-2 text-[11px] font-bold transition-transform active:scale-95", active ? "tab-on" : "border-transparent text-ink-3")}
              >
                {Icon && <PixelIcon name={Icon} size={22} />}
                {section.label}
              </button>
            );
          }
          return (
            <Link
              key={section.key}
              href={section.href}
              aria-current={active ? "page" : undefined}
              aria-label={section.key === "you" && level ? `You, level ${level}` : undefined}
              className={cx(section.color, "relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-[10px] border-2 text-[11px] font-bold transition-transform active:scale-95", active ? "tab-on" : "border-transparent text-ink-3")}
            >
              {Icon ? <PixelIcon name={Icon} size={22} /> : <LevelChip level={level} size={24} />}
              {section.label}
              {section.key === "bills" && dueSoon > 0 && (
                <span className="tabular absolute right-[14%] top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-[var(--c-bills)] px-1 text-[11px] font-extrabold text-paper" aria-label={`${dueSoon} due soon`}>
                  {dueSoon}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <Dialog open={wealthOpen} onClose={() => setWealthOpen(false)} title="Wealth">
        <ul className="flex flex-col gap-2 pb-2">
          {wealth.pages.map((page) => {
            const on = under(pathname, page.href);
            return (
              <li key={page.href}>
                <Link href={page.href} onClick={() => setWealthOpen(false)} aria-current={on ? "page" : undefined} className={cx(page.color, "edge flex min-h-[68px] items-center gap-3 rounded-[14px] bg-sheet px-3 py-2.5 shadow-card active:translate-x-[2px] active:translate-y-[2px] active:shadow-none")}>
                  <IconTile icon={page.icon!} active={on} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{page.label}</span>
                    <span className="block text-small text-ink-3">{page.hint}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Dialog>

      <PullToRefresh />
      <Celebrations />
      <GameWatcher />
      <Toaster />
      <ConfirmHost />
      <ReauthHost />
      <PushKeeper />
      <Nickel />
    </div>
  );
}
