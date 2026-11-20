import { addDays, diffDays, type ISODate } from "../dates";
import { merchantKey } from "./recurring";

/**
 * Matches payments seen at the bank to bills kept in Tasks for Two, so a bill
 * there can be ticked off when the money has actually gone out. Pure: it only
 * decides; another part does the ticking.
 *
 * A bill is only ever matched to the merchant its owner linked it to. Nothing
 * is guessed into being paid.
 */

/** A bill as Tasks for Two's `list_bills` returns it (the parts used here). */
export type TasksBill = { id: string; name: string; amount: number; next_due?: string; this_month?: string[]; archived?: boolean };

export type BankPayment = { id: string; date: ISODate; name: string; amount: number };

export type Tick = { billId: string; billName: string; dueDate: ISODate; transactionId: string; amount: number; paidOn: ISODate };

/** How long before and after its due date a payment still counts as paying that bill, at most. */
const EARLY_DAYS = 7;
const LATE_DAYS = 10;

/** The due dates of a bill that haven't been paid yet, earliest first. */
export function unpaidDueDates(bill: TasksBill): ISODate[] {
  const dates = new Set<string>();
  for (const line of bill.this_month ?? []) {
    const match = /^(\d{4}-\d{2}-\d{2}) to pay/.exec(line);
    if (match) dates.add(match[1]);
  }
  if (bill.next_due && /^\d{4}-\d{2}-\d{2}$/.test(bill.next_due)) dates.add(bill.next_due);
  return [...dates].sort();
}

/** The due dates Tasks for Two already shows as paid (by us or ticked by hand). */
export function paidDueDates(bill: TasksBill): ISODate[] {
  const dates = new Set<string>();
  for (const line of bill.this_month ?? []) {
    const match = /^(\d{4}-\d{2}-\d{2}) paid/.exec(line);
    if (match) dates.add(match[1]);
  }
  return [...dates].sort();
}

/**
 * How far either side of a due date a payment may fall. Never as much as
 * half the gap between two due dates, so on a weekly bill one payment can't
 * sit inside two weeks' windows at once.
 */
export function matchWindow(dueDates: ISODate[]): { early: number; late: number } {
  const sorted = [...new Set(dueDates)].sort();
  let gap = Infinity;
  for (let i = 1; i < sorted.length; i++) gap = Math.min(gap, diffDays(sorted[i], sorted[i - 1]));
  const half = Number.isFinite(gap) ? Math.max(0, Math.floor((gap - 1) / 2)) : Infinity;
  return { early: Math.min(EARLY_DAYS, half), late: Math.min(LATE_DAYS, half) };
}

export function matchPayments(args: {
  bills: TasksBill[];
  /** Tasks bill id → the merchant its owner says pays it. */
  links: Map<string, string>;
  /** Money that went out, from the bank. */
  payments: BankPayment[];
  /** Bank transactions already used to tick something. */
  usedTransactions: Set<string>;
  /** `${billId}|${dueDate}` already ticked by us. */
  ticked: Set<string>;
  /** Every tick we have made before: which bill, which due date, and the payment it was matched to. */
  history?: { billId: string; dueDate: ISODate; paidOn: ISODate | null; amount: number }[];
  today: ISODate;
}): Tick[] {
  const used = new Set(args.usedTransactions);
  const out: Tick[] = [];
  for (const bill of args.bills) {
    const merchant = args.links.get(bill.id);
    if (!merchant || bill.archived) continue;
    const past = (args.history ?? []).filter((h) => h.billId === bill.id);
    const unpaid = unpaidDueDates(bill);
    // Due dates that are already dealt with: paid in Tasks for Two, or ticked by us before.
    const settled = [...new Set([...paidDueDates(bill), ...past.map((h) => h.dueDate)])].filter((d) => !unpaid.includes(d));
    const { early, late } = matchWindow([...unpaid, ...settled]);
    // A payment we have matched before, seen again under a new id (the bank was linked again).
    const seenBefore = (p: BankPayment) => past.some((h) => h.paidOn === p.date && h.amount === -p.amount);
    for (const due of unpaid) {
      if (args.ticked.has(`${bill.id}|${due}`)) continue;
      const from = addDays(due, -early);
      const to = addDays(due, late);
      const distance = (p: BankPayment) => Math.abs(diffDays(p.date, due));
      const candidates = args.payments
        .filter((p) => p.amount < 0 && !used.has(p.id) && p.date <= args.today && p.date >= from && p.date <= to && merchantKey(p.name) === merchant)
        .filter((p) => !seenBefore(p))
        // A payment as close, or closer, to a due date that is already settled belongs to that one.
        // (Ticked by hand before the bank caught up, say.) It must not spill onto the next.
        .filter((p) => !settled.some((other) => Math.abs(diffDays(p.date, other)) <= distance(p)))
        // The payment closest to the due date is the one for it.
        .sort((a, b) => distance(a) - distance(b) || (a.date < b.date ? -1 : 1));
      const hit = candidates[0];
      if (!hit) continue;
      used.add(hit.id);
      out.push({ billId: bill.id, billName: bill.name, dueDate: due, transactionId: hit.id, amount: -hit.amount, paidOn: hit.date });
    }
  }
  return out;
}

const words = (name: string) => new Set(merchantKey(name).split(" ").filter((w) => w.length > 2));

/**
 * A first guess at which merchant pays each unlinked bill, for the owner to
 * confirm. Looks for shared words in the names, then for the same amount.
 */
export function suggestLinks(bills: TasksBill[], merchants: { key: string; name: string; amount: number }[], links: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const bill of bills) {
    if (links.has(bill.id) || bill.archived) continue;
    const billWords = words(bill.name);
    let best: { key: string; score: number } | null = null;
    for (const m of merchants) {
      const shared = [...words(m.name)].filter((w) => billWords.has(w)).length;
      const sameAmount = bill.amount > 0 && Math.abs(Math.abs(m.amount) / 100 - bill.amount) <= bill.amount * 0.02;
      const score = shared * 2 + (sameAmount ? 1 : 0);
      if (score >= 2 && (!best || score > best.score)) best = { key: m.key, score };
    }
    if (best) out.set(bill.id, best.key);
  }
  return out;
}

/**
 * Only a Tasks for Two connector link is accepted: an https address on
 * Supabase ending in /pa-mcp/<key>. When `host` is given (it always is on a
 * site with real data) the address must be on exactly that server, so the
 * link can never be pointed at anyone else's.
 */
export function isTasksLink(url: string, host?: string | null): boolean {
  try {
    const u = new URL(url.trim());
    if (host && u.hostname !== host.toLowerCase()) return false;
    return u.protocol === "https:" && /^[a-z0-9]{15,40}\.supabase\.co$/.test(u.hostname) && u.port === "" && u.username === "" && u.password === "" && /^\/functions\/v1\/pa-mcp\/[A-Za-z0-9]{30,80}$/.test(u.pathname) && u.search === "" && u.hash === "";
  } catch {
    return false;
  }
}
