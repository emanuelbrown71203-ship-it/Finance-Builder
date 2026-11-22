import type { CategoryKey } from "../categories";
import { addDays, diffDays, type ISODate } from "../dates";

/*
 * Apple Card taps. The iPhone's Shortcuts app can run an automation every time
 * Apple Card is tapped at a register, and hands it the merchant and amount.
 * The automation sends those to Passbook's private tap link, and the purchase
 * shows up at once, as pending. When a statement is brought in later, each
 * tap is matched to its line (same amount, within a few days) and becomes
 * that line, so nothing counts twice; taps the statement never shows
 * (declined, or a tip changed the amount) are dropped once the statement
 * reaches well past them.
 */

/** Taps over this are a misread, not a purchase ($100,000). */
const MAX_CENTS = 10_000_000;
/** How far apart, in days, a tap and its statement line can be. */
const WINDOW = 3;

/** The amount Shortcuts sent, in cents: a number (12.34) or text ("$12.34", "USD 1,204.10"). Null for $0, refunds and nonsense. */
export function tapAmount(raw: unknown): number | null {
  let value: number;
  if (typeof raw === "number") value = raw;
  else if (typeof raw === "string") {
    const clean = raw.replace(/[^\d.,-]/g, "").replace(/,/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
    value = Number(clean);
  } else return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  return cents > 0 && cents <= MAX_CENTS ? cents : null;
}

/** The merchant's name as the shop gave it, tidied: one line, at most 80 characters. */
export function cleanMerchant(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return name || "Apple Card purchase";
}

/** A first guess at the category from the name alone, until the statement (or the person) says. */
const GUESSES: [RegExp, CategoryKey][] = [
  [/coffee|caf[eé]|starbucks|dunkin|peet|espresso|bakery|restaurant|grill|pizza|burger|taco|sushi|kitchen|diner|chipotle|mcdonald|wendy|subway|chick-fil|panera|deli|\bbar\b|pub\b/i, "dining"],
  [/grocer|market|whole foods|trader joe|safeway|kroger|aldi|costco|publix|h-e-b|\bheb\b|wegmans|sprouts|food lion|giant/i, "groceries"],
  [/shell|chevron|exxon|mobil|\bbp\b|arco|valero|sunoco|\bgas\b|fuel|parking|uber|lyft|transit|metro|toll/i, "transport"],
  [/cvs|walgreens|rite aid|pharmacy|clinic|dental|medical/i, "health"],
  [/target|walmart|best buy|home depot|lowe'?s|ikea|apple store|nordstrom|macy|tj ?maxx|marshalls|ross\b/i, "shopping"],
  [/cinema|theat(er|re)|amc\b|regal|bowling|arcade/i, "entertainment"],
  [/salon|barber|spa\b|nail/i, "personal"],
];

export function guessCategory(merchant: string): CategoryKey {
  return GUESSES.find(([pattern]) => pattern.test(merchant))?.[1] ?? "other";
}

export type PendingTap = { id: string; date: ISODate; amount: number };

/**
 * Which statement lines are taps already in Passbook (`adopt`: line index → tap id), and which taps the
 * statement shows no sign of though it reaches at least three days past them (`stale`). Only new lines
 * (`fresh`) and only purchases match; each tap is used once, the closest in date first. A tap that
 * matches a purchase the file lists as not cleared yet (`waiting`) is kept: it's on its way.
 */
export function matchTaps(rows: { date: ISODate; amount: number }[], fresh: boolean[], taps: PendingTap[], span: { from: ISODate; to: ISODate }, waiting: { date: ISODate; amount: number }[] = []): { adopt: Map<number, string>; stale: string[] } {
  const used = new Set<string>();
  /** The closest unused tap for a purchase, within the window. */
  const closest = (row: { date: ISODate; amount: number }) => {
    let best: PendingTap | null = null;
    let bestGap = Infinity;
    for (const tap of taps) {
      if (used.has(tap.id) || tap.amount !== row.amount) continue;
      const gap = Math.abs(diffDays(tap.date, row.date));
      if (!Number.isFinite(gap) || gap > WINDOW || gap >= bestGap) continue;
      best = tap;
      bestGap = gap;
    }
    return best;
  };
  const adopt = new Map<number, string>();
  rows.forEach((row, i) => {
    if (!fresh[i] || row.amount >= 0) return;
    const tap = closest(row);
    if (tap) {
      used.add(tap.id);
      adopt.set(i, tap.id);
    }
  });
  for (const row of waiting) {
    if (row.amount >= 0) continue;
    const tap = closest(row);
    if (tap) used.add(tap.id);
  }
  const stale = taps.filter((t) => !used.has(t.id) && t.date >= span.from && addDays(t.date, WINDOW) <= span.to).map((t) => t.id);
  return { adopt, stale };
}
