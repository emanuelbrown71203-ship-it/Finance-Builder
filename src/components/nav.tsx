"use client";

import { CalendarClock, House, PieChart, Scale, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

/*
 * How the app is laid out: five places, each one tap away in the bar along
 * the bottom (or down the side on a wide screen). Places with more than one
 * screen switch between them with tabs under the title, so there's never a
 * "More" menu to dig through.
 */

export type SectionKey = "home" | "spending" | "bills" | "wealth" | "you";

export type Section = {
  key: SectionKey;
  label: string;
  /** Where tapping it goes. */
  href: string;
  hint: string;
  icon: LucideIcon | null;
  /** The colour class for this place (see globals.css). */
  color: string;
  /** Its screens, when there's more than one. */
  pages: { href: string; label: string }[];
  /** Other screens that belong here (reached from inside it). */
  also: string[];
};

export const SECTIONS: Section[] = [
  { key: "home", label: "Home", href: "/", hint: "What’s left, what needs a look, what’s next", icon: House, color: "sec-home", pages: [], also: [] },
  {
    key: "spending",
    label: "Spending",
    href: "/budget",
    hint: "Your budget, and every charge as it happens",
    icon: PieChart,
    color: "sec-budget",
    pages: [
      { href: "/budget", label: "Budget" },
      { href: "/transactions", label: "Transactions" },
    ],
    also: [],
  },
  { key: "bills", label: "Bills", href: "/bills", hint: "Bills and subscriptions, and when they’re due", icon: CalendarClock, color: "sec-bills", pages: [], also: [] },
  {
    key: "wealth",
    label: "Wealth",
    href: "/net-worth",
    hint: "Net worth, savings goals, investing and debt",
    icon: Scale,
    color: "sec-worth",
    pages: [
      { href: "/net-worth", label: "Net worth" },
      { href: "/savings", label: "Savings" },
      { href: "/investing", label: "Investing" },
      { href: "/debt", label: "Debt" },
    ],
    also: [],
  },
  // Its tab shows your level instead of an icon.
  { key: "you", label: "You", href: "/you", hint: "Your level and badges, accounts and settings", icon: null, color: "sec-investing", pages: [], also: ["/progress", "/settings", "/accounts", "/recap"] },
];

const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export function sectionFor(path: string): Section {
  if (path === "/") return SECTIONS[0];
  return SECTIONS.find((s) => s.key !== "home" && (under(path, s.href) || s.pages.some((p) => under(path, p.href)) || s.also.some((a) => under(path, a)))) ?? SECTIONS[0];
}

/** The tabs under a place's title that switch between its screens. */
export function SectionTabs({ className }: { className?: string }) {
  const path = usePathname();
  const section = sectionFor(path);
  if (section.pages.length < 2) return null;
  // The deepest matching screen is the one you're on (Names lives under Transactions).
  const current = [...section.pages].sort((a, b) => b.href.length - a.href.length).find((p) => under(path, p.href));
  return (
    <nav aria-label={section.label} className={cx("mb-4 flex w-full rounded-control bg-sunk p-1 sm:inline-flex sm:w-auto", className)}>
      {section.pages.map((p) => {
        const on = current?.href === p.href;
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={on ? "page" : undefined}
            className={cx("flex min-h-10 flex-1 items-center justify-center whitespace-nowrap rounded-[10px] px-3 text-small font-bold transition-colors sm:flex-none sm:px-4", on ? "bg-sheet text-ink shadow-card" : "text-ink-3 hover:text-ink")}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
