"use client";

import { CalendarCheck, CalendarClock, ChevronRight, Flag, Ellipsis, House, Landmark, ListOrdered, PieChart, PiggyBank, RefreshCw, Scale, Settings, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { APP_NAME } from "@/lib/config";
import { diffDays } from "@/lib/dates";
import type { Me, Overview } from "@/lib/types";
import { Celebrations } from "./celebrate";
import { PullToRefresh } from "./pull-to-refresh";
import { ConfirmHost, Dialog, IconButton, Tag, Toaster, cx } from "./ui";
import { send, useApi, useNow } from "./use-api";

/**
 * Every screen, in menu order. The first four sit in the phone's bottom bar;
 * the rest open from More. `hint` is one line saying what the screen is for.
 */
type NavItem = { href: string; label: string; hint: string; icon: LucideIcon; section: string };

export const NAV: NavItem[] = [
  { href: "/", label: "Home", hint: "What’s left to spend and what needs a look", icon: House, section: "sec-home" },
  { href: "/transactions", label: "Transactions", hint: "Every charge and deposit, as it happens", icon: ListOrdered, section: "sec-activity" },
  { href: "/bills", label: "Bills", hint: "Bills and subscriptions, and when they’re due", icon: CalendarClock, section: "sec-bills" },
  { href: "/budget", label: "Budget", hint: "Spending by category against your limits", icon: PieChart, section: "sec-budget" },
  { href: "/net-worth", label: "Net worth", hint: "Everything you own minus everything you owe", icon: Scale, section: "sec-worth" },
  { href: "/savings", label: "Savings", hint: "What you’ve put away and your goals", icon: PiggyBank, section: "sec-savings" },
  { href: "/investing", label: "Investing", hint: "Brokerage and retirement accounts together", icon: TrendingUp, section: "sec-investing" },
  { href: "/debt", label: "Debt payoff", hint: "When you’ll be debt-free, and how to get there sooner", icon: Flag, section: "sec-bills" },
  { href: "/recap", label: "Weekly recap", hint: "Last week in money: spent, saved and paid", icon: CalendarCheck, section: "sec-home" },
  { href: "/accounts", label: "Accounts", hint: "Link or remove banks, cards and lenders", icon: Landmark, section: "sec-accounts" },
  { href: "/settings", label: "Settings", hint: "Light or dark, your account, app version", icon: Settings, section: "sec-accounts" },
];
const DOCK = 4;

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
  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const current = NAV.find((n) => isActive(n.href)) ?? NAV[0];
  const dock = NAV.slice(0, DOCK);
  const extras = NAV.slice(DOCK);
  const moreActive = extras.some((n) => isActive(n.href));
  // Bills due in the next three days show as a count on the Bills tab.
  const dueSoon = overview ? overview.upcoming.filter((b) => diffDays(b.date, overview.today) <= 3).length : 0;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1320px]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-sheet focus:px-4 focus:py-2">
        Skip to content
      </a>

      {/* Wide screens: a menu down the side. */}
      <aside className="sticky top-0 hidden h-dvh w-[252px] shrink-0 flex-col gap-5 px-4 py-6 lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-2">
          <Logo size={34} />
          <span className="display text-title">{APP_NAME}</span>
        </Link>
        <nav aria-label="Main" className="no-scrollbar flex flex-1 flex-col gap-1 overflow-y-auto">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cx(item.section, "flex min-h-12 items-center gap-3 rounded-2xl px-2.5 font-bold transition-colors", active ? "bg-sheet text-ink shadow-card" : "text-ink-2 hover:bg-sheet/60 hover:text-ink", item.href === "/settings" && "mt-auto")}>
                <IconTile icon={item.icon} active={active} />
                {item.label}
              </Link>
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

        <main id="main" className={cx(current.section, "flex-1 px-4 pb-[calc(96px+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pb-12")}>
          {children}
        </main>
      </div>

      {/* Phones and upright tablets: a bar along the bottom. */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-1 border-t border-line-soft bg-sheet/90 px-2 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl lg:hidden">
        {dock.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(item.section, "relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-bold transition-transform active:scale-95", !active && "text-ink-3")}
              style={active ? { color: "var(--sec)", background: "color-mix(in srgb, var(--sec) 13%, transparent)" } : undefined}
            >
              <Icon size={23} strokeWidth={active ? 2.4 : 1.9} />
              {item.label}
              {item.href === "/bills" && dueSoon > 0 && (
                <span className="tabular absolute right-[18%] top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--c-bills)] px-1 text-[11px] font-extrabold text-sheet" aria-label={`${dueSoon} due soon`}>
                  {dueSoon}
                </span>
              )}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-bold transition-transform active:scale-95", moreActive ? "bg-accent-soft text-accent-text" : "text-ink-3")}>
          <Ellipsis size={23} strokeWidth={moreActive ? 2.6 : 2.1} />
          More
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <ul className="flex flex-col gap-2">
          {extras.map((item) => (
            <li key={item.href}>
              <Link href={item.href} onClick={() => setMoreOpen(false)} className={cx(item.section, "flex min-h-[64px] items-center gap-3 rounded-2xl border border-line-soft px-3 py-2 active:bg-sunk")}>
                <IconTile icon={item.icon} active={isActive(item.href)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{item.label}</span>
                  <span className="block text-small leading-snug text-ink-3">{item.hint}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      </Dialog>

      <PullToRefresh />
      <Celebrations />
      <Toaster />
      <ConfirmHost />
    </div>
  );
}
