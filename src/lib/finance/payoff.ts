import { addMonthsToMonth } from "../dates";

/**
 * Works out when debts will be paid off. Pure: same input, same answer.
 *
 * Each month every debt grows by a month of interest, then gets its regular
 * payment. Any extra money, plus the payments freed up by debts already
 * cleared, goes to one debt at a time: the highest interest rate first
 * ("avalanche") or the smallest balance first ("snowball").
 */

export type Strategy = "avalanche" | "snowball";

export type Debt = {
  id: string;
  name: string;
  /** What is owed, in cents (a positive number). */
  balance: number;
  /** Yearly interest rate, e.g. 5.9 for 5.9%. */
  aprPercent: number;
  /** The regular payment each month, in cents. */
  payment: number;
};

export type PayoffPlan = {
  /** Months until everything is paid. Null when it never is at these payments. */
  months: number | null;
  /** 'YYYY-MM' of the last payment. */
  debtFreeMonth: string | null;
  totalInterest: number;
  perDebt: { id: string; months: number | null; paidOffMonth: string | null; interest: number }[];
  /** Total still owed at the end of each month, starting with today's total. */
  balances: number[];
  /** Debts whose payment doesn't even cover a month of interest. */
  stuck: string[];
};

const MAX_MONTHS = 600;

/** The order extra money is aimed in. */
export function payoffOrder(debts: Debt[], strategy: Strategy): Debt[] {
  return [...debts].sort((a, b) => (strategy === "avalanche" ? b.aprPercent - a.aprPercent || a.balance - b.balance : a.balance - b.balance || b.aprPercent - a.aprPercent));
}

export function payoffPlan(debts: Debt[], extra: number, strategy: Strategy, startMonth: string): PayoffPlan {
  const order = payoffOrder(
    debts.filter((d) => d.balance > 0),
    strategy,
  );
  const balance = new Map(order.map((d) => [d.id, d.balance]));
  const interestPaid = new Map(order.map((d) => [d.id, 0]));
  const doneAt = new Map<string, number>();
  const balances = [order.reduce((s, d) => s + d.balance, 0)];
  const monthlyRate = (d: Debt) => d.aprPercent / 100 / 12;
  const stuck = order.filter((d) => d.payment <= Math.round(d.balance * monthlyRate(d))).map((d) => d.id);

  let month = 0;
  while (balance.size > doneAt.size && month < MAX_MONTHS) {
    month++;
    // Interest first.
    for (const d of order) {
      if (doneAt.has(d.id)) continue;
      const interest = Math.round(balance.get(d.id)! * monthlyRate(d));
      balance.set(d.id, balance.get(d.id)! + interest);
      interestPaid.set(d.id, interestPaid.get(d.id)! + interest);
    }
    // Regular payments. What a cleared debt no longer needs is freed for the others.
    let spare = extra;
    for (const d of order) {
      if (doneAt.has(d.id)) {
        spare += d.payment;
        continue;
      }
      const pay = Math.min(d.payment, balance.get(d.id)!);
      balance.set(d.id, balance.get(d.id)! - pay);
      spare += d.payment - pay;
    }
    // Everything spare goes to the first debt in line, then the next.
    for (const d of order) {
      if (spare <= 0) break;
      if (doneAt.has(d.id)) continue;
      const pay = Math.min(spare, balance.get(d.id)!);
      balance.set(d.id, balance.get(d.id)! - pay);
      spare -= pay;
    }
    for (const d of order) if (!doneAt.has(d.id) && balance.get(d.id)! <= 0) doneAt.set(d.id, month);
    balances.push([...balance.values()].reduce((s, b) => s + Math.max(0, b), 0));
  }

  const finished = doneAt.size === balance.size;
  const monthAt = (n: number) => addMonthsToMonth(startMonth, n);
  return {
    months: finished ? month : null,
    debtFreeMonth: finished ? monthAt(month) : null,
    totalInterest: [...interestPaid.values()].reduce((s, i) => s + i, 0),
    perDebt: order.map((d) => ({ id: d.id, months: doneAt.get(d.id) ?? null, paidOffMonth: doneAt.has(d.id) ? monthAt(doneAt.get(d.id)!) : null, interest: interestPaid.get(d.id)! })),
    // Charts only need the part up to the end.
    balances: finished ? balances : balances.slice(0, 121),
    stuck,
  };
}

/**
 * What someone has actually been putting toward a card's balance lately: each of the last `months` whole
 * months before `month`, what they paid the card less what they newly charged to it (refunds taken off;
 * interest and fees aside, since the payoff plan adds interest itself), averaged. Paying back rent or the
 * month's spending isn't paying down debt, so it cancels out; only what goes beyond new spending counts.
 * A payment the bank sent back doesn't count either: banks file the return as a negative transfer or as a
 * "fee" for the same amount a few days later. Null when that comes to nothing (the balance isn't going down).
 */
export function recentMonthlyPaydown(rows: { date: string; amount: number; category: string }[], month: string, months = 3): number | null {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 - months, 1)).toISOString().slice(0, 7);
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  // Returned payments: a payment, then the same amount back out within ten days. Neither one counts.
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const returned = new Set<(typeof rows)[number]>();
  for (const r of sorted) {
    if (r.amount >= 0 || (r.category !== "transfer" && r.category !== "fees")) continue;
    const paid = sorted.find((p) => !returned.has(p) && p.category === "transfer" && p.amount === -r.amount && day(r.date) - day(p.date) >= 0 && day(r.date) - day(p.date) <= 10);
    if (paid) returned.add(paid).add(r);
  }
  let net = 0;
  for (const r of rows) {
    const mo = r.date.slice(0, 7);
    if (mo < first || mo >= month || returned.has(r) || r.category === "fees") continue;
    // Payments in; new charges out (refunds back in). Money sent to someone on the card is a charge too.
    net += r.amount;
  }
  return net > 0 ? Math.round(net / months) : null;
}
