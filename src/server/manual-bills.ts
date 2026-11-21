import { and, asc, eq, sql } from "drizzle-orm";
import { manualBills } from "@/db/schema";
import { isCategoryKey } from "@/lib/categories";
import { addDays, dayOfMonth, diffDays, type ISODate } from "@/lib/dates";
import { validName } from "@/lib/finance/names";
import { monthlyEquivalent, stepFrom, type Frequency, type RecurringSeries } from "@/lib/finance/recurring";
import { cancelHelp } from "@/lib/finance/subscriptions";
import type { RecurringView } from "@/lib/types";
import type { Ctx } from "./auth";
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
  return { before, after };
}

export async function deleteManualBill(ctx: Ctx, id: string): Promise<ManualBill> {
  const [row] = await ctx.db.delete(manualBills).where(and(eq(manualBills.id, id), eq(manualBills.userId, ctx.userId))).returning();
  if (!row) throw new HttpError(404, "That bill isn’t there any more.");
  return row;
}

/** Puts a removed bill back exactly as it was (Undo). */
export async function restoreManualBill(ctx: Ctx, bill: Pick<ManualBill, "id" | "name" | "amount" | "frequency" | "startDate" | "kind" | "category" | "cancelled" | "addedBy">) {
  const checked = checkBill({ name: bill.name, amount: Math.abs(bill.amount), frequency: bill.frequency as BillFrequencyChoice, startDate: bill.startDate, kind: bill.kind as "bill" | "subscription", category: bill.category }, ctx.today) as ManualBillInput;
  const addedBy = (["you", "nickel", "claude"] as const).find((a) => a === bill.addedBy) ?? "you";
  if (typeof bill.id !== "string" || !/^[0-9a-f-]{36}$/.test(bill.id)) throw new HttpError(400, "That bill can’t be put back.");
  await ctx.db
    .insert(manualBills)
    .values({ id: bill.id, userId: ctx.userId, name: checked.name, amount: -checked.amount, frequency: checked.frequency, startDate: checked.startDate, kind: checked.kind ?? "bill", category: checked.category ?? "other", cancelled: Boolean(bill.cancelled), addedBy })
    .onConflictDoNothing();
}

export async function listManualBills(ctx: Ctx): Promise<ManualBill[]> {
  return ctx.db.select().from(manualBills).where(eq(manualBills.userId, ctx.userId)).orderBy(asc(manualBills.startDate), asc(manualBills.name));
}

/** The next time a hand-added bill is due, today or later. A one-off keeps its date even once it has passed. */
export function nextDue(bill: Pick<ManualBill, "frequency" | "startDate">, today: ISODate): ISODate {
  const frequency = bill.frequency as Frequency;
  if (frequency === "once" || bill.startDate >= today) return bill.startDate;
  const day = dayOfMonth(bill.startDate);
  let d = bill.startDate;
  // Jump close first so a weekly bill started years ago doesn't take thousands of steps.
  if (frequency === "weekly" || frequency === "biweekly") {
    const step = frequency === "weekly" ? 7 : 14;
    d = addDays(d, Math.floor(diffDays(today, d) / step) * step);
  }
  for (let i = 0; i < 1000 && d < today; i++) d = stepFrom(d, frequency, frequency === "monthly" ? day : undefined);
  return d;
}

/** A hand-added bill dressed as a recurring series, so every screen and the month plan treat it the same. */
export function manualSeries(bill: ManualBill, today: ISODate): RecurringView {
  const frequency = bill.frequency as Frequency;
  const next = nextDue(bill, today);
  const once = frequency === "once";
  const active = !bill.cancelled && (!once || next >= today);
  const base: RecurringSeries = {
    key: `manual:${bill.id}`,
    name: bill.name,
    kind: bill.kind === "subscription" ? "subscription" : "bill",
    category: bill.category,
    frequency,
    amount: bill.amount,
    fixedAmount: true,
    lastDate: bill.startDate,
    nextDate: next,
    accountId: "",
    active,
    priceChange: null,
    history: [],
    firstDate: bill.startDate,
    count: 0,
  };
  const untilNext = diffDays(next, today);
  return {
    ...base,
    accountName: "",
    monthly: Math.abs(monthlyEquivalent(base)),
    cancelled: bill.cancelled,
    help: cancelHelp(bill.name),
    renewsSoon: active && (frequency === "yearly" || frequency === "semiannual" || frequency === "quarterly") && untilNext >= 0 && untilNext <= 30,
    startedRecently: false,
    bankName: bill.name,
    ruleId: null,
    ruleExact: false,
    sampleId: "",
    manual: { id: bill.id, addedBy: (bill.addedBy as Actor) ?? "you", startDate: bill.startDate },
  };
}
