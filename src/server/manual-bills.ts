import { and, asc, eq, sql } from "drizzle-orm";
import { manualBills } from "@/db/schema";
import { isCategoryKey } from "@/lib/categories";
import { addDays, diffDays, type ISODate } from "@/lib/dates";
import { validName } from "@/lib/finance/names";
import { firstOnOrAfter, merchantKey, monthlyEquivalent, nthDate, type Frequency, type RecurringSeries } from "@/lib/finance/recurring";
import { cancelHelp } from "@/lib/finance/subscriptions";
import type { RecurringView } from "@/lib/types";
import type { Ctx } from "./auth";
import { takeBack, win } from "./game";
import { HttpError } from "./http";

/*
 * Bills added by hand (by the owner, or by Nickel or Claude when asked). They
 * sit alongside the bills found in the transaction history: in Bills, in
 * what's coming up, and in the month plan's "left to spend".
 */

export const BILL_FREQUENCIES = ["once", "weekly", "biweekly", "monthly", "quarterly", "semiannual", "yearly"] as const;
export type BillFrequencyChoice = (typeof BILL_FREQUENCIES)[number];
export type Actor = "you" | "nickel" | "claude";

export type ManualBillInput = { name: string; amount: number; frequency: BillFrequencyChoice; startDate: ISODate; kind?: "bill" | "subscription"; category?: string };
export type ManualBill = typeof manualBills.$inferSelect;

const MAX_MANUAL_BILLS = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Checks and tidies what someone wants to save. `amount` is what the bill costs, in cents (positive). */
export function checkBill(input: Partial<ManualBillInput>, today: ISODate): Partial<ManualBillInput> {
  const out: Partial<ManualBillInput> = {};
  if (input.name !== undefined) {
    const name = validName(input.name);
    if (!name) throw new HttpError(400, "Give the bill a name of up to 60 letters.");
    out.name = name;
  }
  if (input.amount !== undefined) {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > 10_000_000_00) throw new HttpError(400, "Enter what the bill costs, like 15.99.");
    out.amount = input.amount;
  }
  if (input.frequency !== undefined) {
    if (!BILL_FREQUENCIES.includes(input.frequency)) throw new HttpError(400, "Choose how often it comes.");
    out.frequency = input.frequency;
  }
  if (input.startDate !== undefined) {
    if (!DATE.test(input.startDate) || Number.isNaN(Date.parse(`${input.startDate}T00:00:00Z`))) throw new HttpError(400, "Pick the date it’s due.");
    // A few years either side is plenty; anything else is a typo.
    if (Math.abs(diffDays(input.startDate, today)) > 3660) throw new HttpError(400, "Pick a date within the next few years.");
    out.startDate = input.startDate;
  }
  if (input.kind !== undefined) {
    if (input.kind !== "bill" && input.kind !== "subscription") throw new HttpError(400, "Choose bill or subscription.");
    out.kind = input.kind;
  }
  if (input.category !== undefined) {
    if (!isCategoryKey(input.category) || input.category === "income" || input.category === "transfer") throw new HttpError(400, "Unknown category.");
    out.category = input.category;
  }
  return out;
}

export async function createManualBill(ctx: Ctx, input: ManualBillInput, addedBy: Actor): Promise<ManualBill> {
  const checked = checkBill(input, ctx.today) as ManualBillInput;
  const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(manualBills).where(eq(manualBills.userId, ctx.userId));
  if (count >= MAX_MANUAL_BILLS) throw new HttpError(400, "That’s the most added bills Passbook keeps. Remove some you no longer pay first.");
  const [row] = await ctx.db
    .insert(manualBills)
    .values({
      id: crypto.randomUUID(),
      userId: ctx.userId,
      name: checked.name,
      amount: -checked.amount,
      frequency: checked.frequency,
      startDate: checked.startDate,
      kind: checked.kind ?? "bill",
      category: checked.category ?? "other",
      addedBy,
    })
    .returning();
  await win(ctx, "bill", row.id, row.name);
  return row;
}

export async function getManualBill(ctx: Ctx, id: string): Promise<ManualBill> {
  const [row] = await ctx.db.select().from(manualBills).where(and(eq(manualBills.id, id), eq(manualBills.userId, ctx.userId))).limit(1);
  if (!row) throw new HttpError(404, "That bill isn’t there any more.");
  return row;
}

export async function updateManualBill(ctx: Ctx, id: string, patch: Partial<ManualBillInput> & { cancelled?: boolean }): Promise<{ before: ManualBill; after: ManualBill }> {
  const before = await getManualBill(ctx, id);
  const checked = checkBill(patch, ctx.today);
  const set: Partial<typeof manualBills.$inferInsert> = { ...checked, ...(checked.amount !== undefined ? { amount: -checked.amount } : {}) };
  if (patch.cancelled !== undefined) set.cancelled = Boolean(patch.cancelled);
  if (Object.keys(set).length === 0) return { before, after: before };
  const [after] = await ctx.db.update(manualBills).set(set).where(and(eq(manualBills.id, id), eq(manualBills.userId, ctx.userId))).returning();
  if (!after) throw new HttpError(404, "That bill isn’t there any more.");
  if (after.cancelled && !before.cancelled) await win(ctx, "cancel", `manual:${id}`, after.name);
  if (!after.cancelled && before.cancelled) await takeBack(ctx, "cancel", `manual:${id}`);
  return { before, after };
}

export async function deleteManualBill(ctx: Ctx, id: string): Promise<ManualBill> {
  const [row] = await ctx.db.delete(manualBills).where(and(eq(manualBills.id, id), eq(manualBills.userId, ctx.userId))).returning();
  if (!row) throw new HttpError(404, "That bill isn’t there any more.");
  await takeBack(ctx, "bill", row.id);
  await takeBack(ctx, "cancel", `manual:${row.id}`);
  return row;
}

/** Puts a removed bill back exactly as it was (Undo). */
export async function restoreManualBill(ctx: Ctx, bill: Pick<ManualBill, "id" | "name" | "amount" | "frequency" | "startDate" | "kind" | "category" | "cancelled" | "addedBy">) {
  const checked = checkBill({ name: bill.name, amount: Math.abs(bill.amount), frequency: bill.frequency as BillFrequencyChoice, startDate: bill.startDate, kind: bill.kind as "bill" | "subscription", category: bill.category }, ctx.today) as ManualBillInput;
  const addedBy = (["you", "nickel", "claude"] as const).find((a) => a === bill.addedBy) ?? "you";
  if (typeof bill.id !== "string" || !/^[0-9a-f-]{36}$/.test(bill.id)) throw new HttpError(400, "That bill can’t be put back.");
  const [{ count }] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(manualBills).where(eq(manualBills.userId, ctx.userId));
  if (count >= MAX_MANUAL_BILLS) throw new HttpError(400, "That’s the most added bills Passbook keeps. Remove some you no longer pay first.");
  await ctx.db
    .insert(manualBills)
    .values({ id: bill.id, userId: ctx.userId, name: checked.name, amount: -checked.amount, frequency: checked.frequency, startDate: checked.startDate, kind: checked.kind ?? "bill", category: checked.category ?? "other", cancelled: Boolean(bill.cancelled), addedBy })
    .onConflictDoNothing();
  // Removing it today took its XP back; putting it back returns it (it can never count twice).
  await win(ctx, "bill", bill.id, checked.name);
  if (bill.cancelled) await win(ctx, "cancel", `manual:${bill.id}`, checked.name);
}

export async function listManualBills(ctx: Ctx): Promise<ManualBill[]> {
  return ctx.db.select().from(manualBills).where(eq(manualBills.userId, ctx.userId)).orderBy(asc(manualBills.startDate), asc(manualBills.name));
}

/** The next time a hand-added bill is due, today or later. A one-off keeps its date even once it has passed. */
export function nextDue(bill: Pick<ManualBill, "frequency" | "startDate">, today: ISODate): ISODate {
  return firstOnOrAfter(bill.startDate, bill.frequency as Frequency, today).date;
}

export type BankMatch = { paid: { id: string; date: ISODate; amount: number } | null; seenAs: string | null };

/**
 * What the bank shows about a hand-added bill, so it's never counted twice:
 *  - `seenAs`: the bank's own repeating charge for it, once Passbook finds one
 *    (from then on that one counts and this copy stands aside);
 *  - `paid`: a payment like it (same name, within 10% of the amount) in the 12
 *    days before it's due, so it counts as paid rather than still to come.
 */
export function bankMatch(
  bill: Pick<ManualBill, "name" | "amount" | "frequency" | "startDate">,
  today: ISODate,
  charges: { id: string; date: ISODate; amount: number; names: string[] }[],
  found: { name: string; bankName: string; active: boolean; kind: string; amount: number; frequency: string }[],
): BankMatch {
  const key = merchantKey(bill.name);
  if (key.replace(/ /g, "").length < 3) return { paid: null, seenAs: null };
  const frequency = bill.frequency as Frequency;
  /** The same place: the same name, or the bank's name with something after it ("Netflix" and "Netflix com"). */
  const same = (name: string) => {
    const k = merchantKey(name);
    return k === key || (key.length >= 4 && k.startsWith(`${key} `));
  };
  const near = (a: number, within: number) => Math.abs(Math.abs(a) - Math.abs(bill.amount)) <= Math.abs(bill.amount) * within;
  // The bank's own repeating charge for it: same place, same schedule, about the same amount.
  // "Rent" $2,150 is not "Rent the Runway"; "Apple Card" $500 is not Apple's $2.99 iCloud.
  const seen = frequency === "once" ? undefined : found.find((s) => s.active && s.kind !== "income" && s.frequency === frequency && near(s.amount, 0.2) && (same(s.name) || same(s.bankName)));
  if (seen) return { paid: null, seenAs: seen.name };
  // Paid early: only after the one before was due, so last week's payment never pays this week's.
  const due = firstOnOrAfter(bill.startDate, frequency, today);
  const gap = { once: 24, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, semiannual: 182, yearly: 365 }[frequency];
  let from = addDays(due.date, -Math.min(12, Math.floor(gap / 2)));
  if (due.k > 0) {
    const before = addDays(nthDate(bill.startDate, frequency, due.k - 1), 1);
    if (before > from) from = before;
  }
  const paid = charges
    .filter((c) => c.amount < 0 && c.date >= from && c.date <= today && c.date <= due.date && near(c.amount, 0.1) && c.names.some(same))
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return { paid: paid ? { id: paid.id, date: paid.date, amount: paid.amount } : null, seenAs: null };
}

/** A hand-added bill dressed as a recurring series, so every screen and the month plan treat it the same. */
export function manualSeries(bill: ManualBill, today: ISODate, bank: BankMatch = { paid: null, seenAs: null }): RecurringView {
  const frequency = bill.frequency as Frequency;
  const once = frequency === "once";
  const due = firstOnOrAfter(bill.startDate, frequency, today);
  // Paid early at the bank: that one's done, and a repeating bill moves on to the next date.
  const next = bank.paid && !once ? nthDate(bill.startDate, frequency, due.k + 1) : due.date;
  const active = !bill.cancelled && !bank.seenAs && (!once || (next >= today && !bank.paid));
  const base: RecurringSeries = {
    key: `manual:${bill.id}`,
    name: bill.name,
    // A one-off coming up is always a bill: set aside until its date. Only a repeating charge can be an Extra.
    kind: !once && bill.kind === "subscription" ? "subscription" : "bill",
    category: bill.category,
    frequency,
    amount: bill.amount,
    fixedAmount: true,
    lastDate: bank.paid?.date ?? bill.startDate,
    nextDate: next,
    accountId: "",
    active,
    priceChange: null,
    history: bank.paid ? [bank.paid] : [],
    firstDate: bill.startDate,
    count: bank.paid ? 1 : 0,
    anchor: bill.startDate,
  };
  const untilNext = diffDays(next, today);
  return {
    ...base,
    accountName: "",
    // A bill added by hand is already the amount the person pays.
    share: null,
    notifyPaid: false,
    monthly: Math.abs(monthlyEquivalent(base)),
    cancelled: bill.cancelled,
    help: cancelHelp(bill.name),
    renewsSoon: active && (frequency === "yearly" || frequency === "semiannual" || frequency === "quarterly") && untilNext >= 0 && untilNext <= 30,
    startedRecently: false,
    bankName: bill.name,
    ruleId: null,
    ruleExact: false,
    sampleId: "",
    manual: { id: bill.id, addedBy: (bill.addedBy as Actor) ?? "you", startDate: bill.startDate, seenAtBank: bank.seenAs, paidOn: bank.paid?.date ?? null },
  };
}
