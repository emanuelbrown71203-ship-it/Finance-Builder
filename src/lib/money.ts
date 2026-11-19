/** Money is integer cents everywhere; these turn it into text. */

const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** "$1,284" — rounded to the dollar. For headlines and totals. */
export function dollars(cents: number): string {
  return whole.format(Math.round(cents / 100)).replace("-", "−");
}

/** "$1,284.50" — for individual transactions. */
export function dollarsExact(cents: number): string {
  return exact.format(cents / 100).replace("-", "−");
}

/** "+$3,200.00" for money in, "$5.75" for money out. */
export function signedAmount(cents: number): string {
  return cents > 0 ? `+${exact.format(cents / 100)}` : exact.format(Math.abs(cents) / 100);
}

/** "$12.9K", "$1.2M" — for chart axes. */
export function dollarsCompact(cents: number): string {
  const v = cents / 100;
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`;
  if (abs >= 1_000) return `${sign}$${trim(abs / 1000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/** "+2.1%" / "−0.4%" */
export function percent(ratio: number, digits = 1): string {
  const v = (ratio * 100).toFixed(digits);
  if (Number(v) === 0) return `0%`;
  return `${ratio > 0 ? "+" : "−"}${v.replace("-", "")}%`;
}

export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
