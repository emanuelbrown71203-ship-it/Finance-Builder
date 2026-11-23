"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PixelName } from "./pixel-icons";
import { cx } from "./ui";

/*
 * How the app is laid out: five places, each one tap away in the bar along
 * the bottom of a phone. Spending switches between its two screens with tabs
 * under the title. Wealth's four screens (net worth, savings, investing, debt)
 * each stand on their own, as the owner prefers: on a phone, Wealth opens a
 * sheet to pick one; down the side of a wide screen they're listed separately.
 */

export type SectionKey = "home" | "spending" | "bills" | "wealth" | "you";

export type Section = {
  key: SectionKey;
  label: string;
  /** Where tapping it goes. */
  href: string;
  hint: string;
  /** Its pixel icon (none for You, whose tab shows your level). */
  icon: PixelName | null;
  /** The colour class for this place (see globals.css). */
  color: string;
  /** Its screens, when there's more than one. */
  pages: { href: string; label: string; icon?: PixelName; color?: string; hint?: string }[];
  /** Whether its screens switch with tabs under the title (Spending), or each stands on its own (Wealth). */
  tabs: boolean;
  /** Other screens that belong here (reached from inside it). */
  also: string[];
};

export const SECTIONS: Section[] = [
  { key: "home", label: "Home", href: "/", hint: "What’s left, what needs a look, what’s next", icon: "home", color: "sec-home", pages: [], tabs: false, also: [] },
  {
    key: "spending",
    label: "Spending",
    href: "/budget",
    hint: "Your budget, and every charge as it happens",
    icon: "spending",
    color: "sec-budget",
    pages: [
      { href: "/budget", label: "Budget" },
      { href: "/transactions", label: "Transactions" },
    ],
    tabs: true,
    also: [],
  },
  { key: "bills", label: "Bills", href: "/bills", hint: "Bills you must pay, extras you could cut, and when they’re due", icon: "bills", color: "sec-bills", pages: [], tabs: false, also: [] },
  {
    key: "wealth",
    label: "Wealth",
    href: "/net-worth",
    hint: "Net worth, savings goals, investing and debt",
    icon: "wealth",
    color: "sec-worth",
    pages: [
      { href: "/net-worth", label: "Net worth", icon: "wealth", color: "sec-worth", hint: "Everything you own minus everything you owe" },
      { href: "/savings", label: "Savings", icon: "savings", color: "sec-savings", hint: "What you’ve put away, and your goals" },
      { href: "/investing", label: "Investing", icon: "investing", color: "sec-investing", hint: "Brokerage and retirement accounts together" },
      { href: "/debt", label: "Debt payoff", icon: "debt", color: "sec-bills", hint: "When you’ll be debt-free, and how to get there sooner" },
    ],
    tabs: false,
    also: [],
  },
  // Its tab shows your level instead of an icon.
  { key: "you", label: "You", href: "/you", hint: "Your level and badges, accounts and settings", icon: null, color: "sec-investing", pages: [], tabs: false, also: ["/progress", "/settings", "/accounts", "/recap"] },
];

export const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export function sectionFor(path: string): Section {
  if (path === "/") return SECTIONS[0];
  return SECTIONS.find((s) => s.key !== "home" && (under(path, s.href) || s.pages.some((p) => under(path, p.href)) || s.also.some((a) => under(path, a)))) ?? SECTIONS[0];
}

/** The tabs under a place's title that switch between its screens. */
export function SectionTabs({ className }: { className?: string }) {
  const path = usePathname();
  const section = sectionFor(path);
  if (!section.tabs || section.pages.length < 2) return null;
  // The deepest matching screen is the one you're on (Names lives under Transactions).
  const current = [...section.pages].sort((a, b) => b.href.length - a.href.length).find((p) => under(path, p.href));
  return (
    <nav aria-label={section.label} className={cx("edge mb-4 flex w-full rounded-control bg-sunk p-1 sm:inline-flex sm:w-auto", className)}>
      {section.pages.map((p) => {
        const on = current?.href === p.href;
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={on ? "page" : undefined}
            className={cx("flex min-h-10 flex-1 items-center justify-center whitespace-nowrap rounded-[7px] px-3 text-small font-bold transition-colors sm:flex-none sm:px-4", on ? "bg-accent text-on-accent glow-accent" : "text-ink-3 hover:text-ink")}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
