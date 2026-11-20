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

export type Tick = { billId: string; billName: string; dueDate: ISODate; transactionId: string; amount: number };

/** How long before and after its due date a payment still counts as paying that bill. */
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
  today: ISODate;
}): Tick[] {
  const used = new Set(args.usedTransactions);
  const out: Tick[] = [];
  for (const bill of args.bills) {
    const merchant = args.links.get(bill.id);
    if (!merchant || bill.archived) continue;
    for (const due of unpaidDueDates(bill)) {
      if (args.ticked.has(`${bill.id}|${due}`)) continue;
      const from = addDays(due, -EARLY_DAYS);
      const to = addDays(due, LATE_DAYS);
      const candidates = args.payments
        .filter((p) => p.amount < 0 && !used.has(p.id) && p.date <= args.today && p.date >= from && p.date <= to && merchantKey(p.name) === merchant)
        // The payment closest to the due date is the one for it.
        .sort((a, b) => Math.abs(diffDays(a.date, due)) - Math.abs(diffDays(b.date, due)) || (a.date < b.date ? -1 : 1));
      const hit = candidates[0];
      if (!hit) continue;
      used.add(hit.id);
      out.push({ billId: bill.id, billName: bill.name, dueDate: due, transactionId: hit.id, amount: -hit.amount });
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
 * Supabase ending in /pa-mcp/<key>. Anything else is refused, so this can
 * never be pointed at some other server.
 */
export function isTasksLink(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" && /^[a-z0-9]{15,40}\.supabase\.co$/.test(u.hostname) && u.port === "" && u.username === "" && /^\/functions\/v1\/pa-mcp\/[A-Za-z0-9]{30,80}$/.test(u.pathname) && u.search === "" && u.hash === "";
  } catch {
    return false;
  }
}
