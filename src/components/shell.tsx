"use client";

import { CalendarClock, Ellipsis, House, Landmark, ListOrdered, LogOut, Moon, PieChart, PiggyBank, RefreshCw, Scale, Sun, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { APP_NAME } from "@/lib/config";
import type { Me, SyncStatus } from "@/lib/types";
import { Dialog, IconButton, Tag, cx } from "./ui";
import { send, useApi, useNow, useTheme } from "./use-api";

const NAV: { href: string; label: string; icon: LucideIcon; primary?: boolean }[] = [
  { href: "/", label: "Home", icon: House, primary: true },
  { href: "/transactions", label: "Transactions", icon: ListOrdered, primary: true },
  { href: "/bills", label: "Bills", icon: CalendarClock, primary: true },
  { href: "/budget", label: "Budget", icon: PieChart, primary: true },
  { href: "/net-worth", label: "Net worth", icon: Scale },
  { href: "/savings", label: "Savings", icon: PiggyBank },
  { href: "/investing", label: "Investing", icon: TrendingUp },
  { href: "/accounts", label: "Accounts", icon: Landmark },
];

/** The mark: a passbook page with its perforated stub. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <rect x="2" y="3" width="24" height="22" rx="6" fill="var(--accent)" />
      <path d="M11 3v22" stroke="var(--paper)" strokeWidth="1.6" strokeDasharray="1.6 2.6" strokeLinecap="round" />
      <path d="M15.5 10.5h6M15.5 14h6M15.5 17.5h3.5" stroke="var(--on-accent)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="6.6" cy="14" r="1.7" fill="var(--canary)" />
    </svg>
  );
}

function secondsAgo(iso: string | null, now: number): string {
  if (!iso) return "Not synced yet";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 10) return "Updated just now";
  if (s < 60) return `Updated ${s}s ago`;
  if (s < 3600) return `Updated ${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `Updated ${Math.round(s / 3600)}h ago`;
  return `Updated ${Math.round(s / 86_400)}d ago`;
}

/** Shows that data is flowing, and when it last changed. */
function LiveStatus() {
  const { data } = useApi<{ sync: SyncStatus }>("/api/overview");
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

  return (
    <div className="flex items-center gap-1">
      {sync.needsAttention > 0 ? (
        <Link href="/accounts" className="rounded-full">
          <Tag tone="canary">
            {sync.needsAttention} {sync.needsAttention === 1 ? "bank needs" : "banks need"} a sign-in
          </Tag>
        </Link>
      ) : (
        <span className="flex items-center gap-2 text-small text-ink-2">
          <span aria-hidden className="live-dot size-2 rounded-full bg-good" />
          <span className="font-medium text-ink">Live</span>
          <span className="tabular hidden text-ink-3 sm:inline" suppressHydrationWarning>
            {now > 0 && secondsAgo(sync.lastSyncedAt, now)}
          </span>
        </span>
      )}
      <IconButton label="Refresh from your banks" onClick={refresh} disabled={refreshing}>
        <RefreshCw size={16} className={refreshing ? "animate-spin" : undefined} />
      </IconButton>
    </div>
  );
}

function NavLink({ item, active, compact }: { item: (typeof NAV)[number]; active: boolean; compact?: boolean }) {
  const Icon = item.icon;
  if (compact) {
    return (
      <Link href={item.href} aria-current={active ? "page" : undefined} className={cx("flex flex-1 flex-col items-center gap-1 rounded-control py-1.5 text-[11px] font-medium", active ? "text-accent-text" : "text-ink-3")}>
        <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
        {item.label}
      </Link>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cx("flex items-center gap-3 rounded-control px-3 py-2 font-medium transition-colors", active ? "bg-sheet text-ink shadow-[0_0_0_1px_var(--line-soft)]" : "text-ink-2 hover:bg-sheet/60 hover:text-ink")}
    >
      <Icon size={18} strokeWidth={active ? 2.2 : 1.8} className={active ? "text-accent-text" : undefined} />
      {item.label}
    </Link>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: me } = useApi<Me>("/api/me");
  const [dark, toggleTheme] = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // A full page load on purpose: it clears everything the signed-in session had cached.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1320px]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-sheet focus:px-4 focus:py-2">
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-6 px-4 py-6 lg:flex">
        <Link href="/" className="flex items-center gap-2.5 px-3">
          <Logo />
          <span className="display text-title">{APP_NAME}</span>
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 px-3 text-small">
          <span className="truncate text-ink-2">{me?.user.name ?? ""}</span>
          {me && !me.demo && (
            <IconButton label="Sign out" onClick={signOut}>
              <LogOut size={16} />
            </IconButton>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 bg-paper/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <Logo size={24} />
            <span className="display text-lead">{APP_NAME}</span>
          </Link>
          <div className="hidden lg:block">{me?.demo && <Tag tone="canary">Sample data. Link a bank to see your own.</Tag>}</div>
          <div className="flex items-center gap-1">
            <LiveStatus />
            <IconButton label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </IconButton>
          </div>
        </div>
        {me?.demo && (
          <div className="px-4 pb-2 sm:px-6 lg:hidden">
            <Tag tone="canary">Sample data. Link a bank to see your own.</Tag>
          </div>
        )}

        <main id="main" className="flex-1 px-4 pb-28 pt-2 sm:px-6 lg:px-8 lg:pb-12">
          {children}
        </main>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line-soft bg-sheet/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden">
        {NAV.filter((n) => n.primary).map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} compact />
        ))}
        <button type="button" onClick={() => setMoreOpen(true)} className={cx("flex flex-1 flex-col items-center gap-1 rounded-control py-1.5 text-[11px] font-medium", NAV.some((n) => !n.primary && isActive(n.href)) ? "text-accent-text" : "text-ink-3")}>
          <Ellipsis size={20} />
          More
        </button>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="flex flex-col gap-1">
          {NAV.filter((n) => !n.primary).map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)} className="flex items-center gap-3 rounded-control px-3 py-3 font-medium hover:bg-sunk">
              <item.icon size={18} className="text-ink-2" />
              {item.label}
            </Link>
          ))}
          {me && !me.demo && (
            <button type="button" onClick={signOut} className="flex items-center gap-3 rounded-control px-3 py-3 text-left font-medium hover:bg-sunk">
              <LogOut size={18} className="text-ink-2" />
              Sign out
            </button>
          )}
        </div>
      </Dialog>
    </div>
  );
}
