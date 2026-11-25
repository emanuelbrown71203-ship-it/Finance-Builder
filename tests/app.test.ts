import { beforeAll, describe, expect, it } from "vitest";
import { getDb, type DB } from "@/db";
import { seedDemo } from "@/db/seed";
import { DEMO_USER_ID } from "@/lib/config";
import type { Ctx } from "@/server/auth";
import { budgetState, createGoal, deleteDeposit, deleteManualAccount, setBudget, setBudgets, setDebtPlan, setDebtSettings, setPaycheck, setRecurringOverride, setRollover, updateGoal, updateTransaction } from "@/server/mutations";
import { loadRules } from "@/server/rules";
import { countUnclear, createNameRule, deleteNameRule, getNames, previewNameRule, renameRule, restoreNameRule } from "@/server/names";
import { goals as goalsTable, accounts as accountsTable, budgets as budgetsTable, categoryRules as categoryRulesTable, playerWins as playerWinsTable, tapKeys as tapKeysTable, transactions as transactionsTable } from "@/db/schema";
import { importAppleCard, previewAppleCard, undoAppleCardImport } from "@/server/card-import";
import { contextForTapKey, createTapKey, recordTap, revokeTapKey, tapStatus } from "@/server/card-taps";
import { signOutEverywhere } from "@/server/auth";
import { checkIn, win } from "@/server/game";
import { createCategory, loadUserCategories, removeCategory, restoreCategory, updateCategory } from "@/server/categories";
import { withCategories } from "@/server/category-scope";
import { category } from "@/lib/categories";
import { POST as tapRoute } from "@/app/api/tap/[key]/route";
import { and, eq as eqOp, inArray as inArrayOp } from "drizzle-orm";
import { addBill, addGoal, addToGoal, changeGoal, changeLoan, findCharge, findDebt, findGoal, listActivity, renameCharges, undoActivity } from "@/server/actions";
import { bankMatch, createManualBill, deleteManualBill, manualSeries, nextDue, restoreManualBill, updateManualBill } from "@/server/manual-bills";
import { upcomingBetween } from "@/lib/finance/recurring";
import { askNickel } from "@/server/nickel";
import { getAccounts, getBudget, getDebt, getGoal, getGoals, getInvestments, getNetWorth, getOverview, getRecap, getRecurring, getTransactions, weekKey } from "@/server/queries";

/** End-to-end over the real SQL: seed the sample household into PGlite, then read it back. */
const today = "2026-11-19";
let db: DB;
let ctx: Ctx;

beforeAll(async () => {
  db = await getDb();
  await seedDemo(db, today, new Date("2026-11-19T20:00:00Z"));
  ctx = { db, userId: DEMO_USER_ID, user: { id: DEMO_USER_ID, name: "Sam", email: "demo@passbook.local" }, today, demo: true };
});

describe("sample household", () => {
  it("has linked institutions, accounts and a hand-tracked asset", async () => {
    const a = await getAccounts(ctx);
    expect(a.institutions.map((i) => i.institutionName)).toEqual(["Cedar Lending", "Fernway Invest", "Larch Retirement", "Meridian Card", "Northwind Bank"]);
    expect(a.manual).toHaveLength(1);
    const checking = a.institutions.flatMap((i) => i.accounts).find((x) => x.subtype === "checking")!;
    expect(checking.balance).toBeGreaterThan(0);
  });

  it("detects the recurring charges that were seeded", async () => {
    const r = await getRecurring(ctx);
    const names = r.series.map((s) => s.name);
    for (const expected of ["Parkview Apartments", "Netflix", "Spotify", "Geico", "Halden Studio Payroll", "City Light & Power", "Anytime Fitness", "Amazon Prime"]) {
      expect(names).toContain(expected);
    }
    expect(names).not.toContain("Blue Bottle Coffee");
    expect(names).not.toContain("Trader Joe’s");
    expect(r.series.find((s) => s.name === "Netflix")?.priceChange).toEqual({ from: -1549, to: -1799 });
    expect(r.series.find((s) => s.name === "Hulu")?.active).toBe(false);
    expect(r.upcoming[0].date >= today).toBe(true);
    expect(r.upcoming.some((u) => u.kind === "card")).toBe(true);
    expect(r.monthlyBills).toBeGreaterThan(280000);
  });

  it("counts only a card's minimum as due, never the whole balance: big balances get paid down over time", async () => {
    const card = (await getRecurring(ctx)).upcoming.find((u) => u.kind === "card")!;
    const visa = (await getAccounts(ctx)).institutions.flatMap((i) => i.accounts).find((a) => a.name === "Cashback Visa")!;
    expect(card).toMatchObject({ name: "Cashback Visa minimum payment", amount: -Math.min(visa.minimumPayment!, -visa.balance), owed: -visa.balance, estimated: false });
    // Home's "due in the next 30 days" adds the minimum, not what's owed.
    const overview = await getOverview(ctx);
    expect(overview.upcoming.find((u) => u.kind === "card")?.amount).toBe(card.amount);
    // (Nickel's "can I afford it?" takes card payments from this same list, so he sets aside only the minimum too.)
  });

  it("builds a month plan whose parts add up", async () => {
    const { plan } = await getOverview(ctx);
    expect(plan.days).toHaveLength(30);
    expect(plan.leftToSpend).toBe(plan.incomeExpected - plan.billsExpected - plan.savingsPlanned - plan.everydaySpent);
    expect(plan.incomeExpected).toBeGreaterThan(plan.incomeReceived);
    expect(plan.billsExpected).toBeGreaterThan(plan.billsPaid);
    expect(plan.daysLeft).toBe(12);
    const sum = (k: "income" | "bills" | "everyday") => plan.days.reduce((s, d) => s + d[k], 0);
    expect(sum("income")).toBe(plan.incomeExpected);
    expect(sum("bills")).toBe(plan.billsExpected);
    expect(sum("everyday")).toBe(plan.everydaySpent);
  });

  it("lists what needs a look on Home, each with somewhere to go", async () => {
    // A limit that is certainly passed, so the test doesn't depend on how the sample month happens to go.
    await setBudget(ctx, "groceries", 100);
    const { attention } = await getOverview(ctx);
    await setBudget(ctx, "groceries", 65000);
    expect(attention.map((a) => a.kind)).toEqual(expect.arrayContaining(["due", "price", "budget"]));
    // Each one opens the thing it's about, not just the screen it's on.
    const netflix = (await getRecurring(ctx)).series.find((s) => s.name === "Netflix")!;
    expect(attention.find((a) => a.kind === "price")).toMatchObject({ title: "Netflix raised its price", href: `/bills?open=${encodeURIComponent(netflix.key)}` });
    expect(attention.find((a) => a.kind === "due")?.title).toMatch(/is due (today|tomorrow|in 2 days)$/);
    expect(attention.filter((a) => a.kind === "due").every((a) => a.href.startsWith("/bills?open=") || a.href === "/debt")).toBe(true);
    expect(attention.find((a) => a.kind === "new")?.href).toMatch(/^\/bills\?possible=/);
    expect(attention.find((a) => a.kind === "budget")).toMatchObject({ title: "Groceries is over budget", href: "/budget?category=groceries" });
    expect(attention.every((a) => a.href.startsWith("/") && a.detail.length > 0)).toBe(true);
    // Most urgent first: what's due comes before budget warnings.
    expect(attention.findIndex((a) => a.kind === "due")).toBeLessThan(attention.findIndex((a) => a.kind === "budget"));
  });

  it("net worth equals assets minus debts and matches the accounts", async () => {
    const w = await getNetWorth(ctx, "1y");
    expect(w.net).toBe(w.assets - w.debts);
    expect(w.net).toBe(w.accounts.reduce((s, a) => s + a.balance, 0));
    expect(w.series.length).toBeGreaterThan(360);
    expect(w.series.at(-1)?.date).toBe(today);
  });

  it("investments total matches holdings", async () => {
    const inv = await getInvestments(ctx, "6m");
    expect(inv.holdings.reduce((s, h) => s + h.value, 0)).toBe(inv.total);
    expect(inv.allocation.reduce((s, a) => s + a.value, 0)).toBe(inv.total);
  });

  it("filters and searches transactions", async () => {
    const all = await getTransactions(ctx, { limit: 50, offset: 0 });
    expect(all.total).toBeGreaterThan(900);
    expect(all.transactions).toHaveLength(50);
    expect(all.hasMore).toBe(true);
    const search = await getTransactions(ctx, { q: "netflix", limit: 50, offset: 0 });
    expect(search.total).toBeGreaterThan(10);
    expect(search.transactions.every((t) => t.name === "Netflix")).toBe(true);
    const groceries = await getTransactions(ctx, { category: "groceries", month: "2026-10", limit: 200, offset: 0 });
    expect(groceries.transactions.every((t) => t.category === "groceries" && t.date.startsWith("2026-10"))).toBe(true);
  });

  it("recategorizing a transaction moves it between budget rows", async () => {
    const { transactions } = await getTransactions(ctx, { category: "dining", month: "2026-11", limit: 1, offset: 0 });
    const before = await getBudget(ctx, "2026-11");
    await updateTransaction(ctx, transactions[0].id, { category: "groceries", note: "Team lunch" });
    const after = await getBudget(ctx, "2026-11");
    const spent = (b: typeof before, c: string) => b.rows.find((r) => r.category === c)!.spent;
    expect(spent(after, "dining")).toBe(spent(before, "dining") + transactions[0].amount);
    expect(spent(after, "groceries")).toBe(spent(before, "groceries") - transactions[0].amount);
    expect(after.totalSpent).toBe(before.totalSpent);
  });

  it("remembers a category for a merchant, applies it everywhere, and Undo puts it all back", async () => {
    const all = await getTransactions(ctx, { q: "chipotle", limit: 200, offset: 0 });
    expect(all.total).toBeGreaterThan(5);
    expect(all.transactions.every((t) => t.category === "dining")).toBe(true);
    const one = all.transactions[0];

    // Without "remember", only the one transaction moves.
    let result = await updateTransaction(ctx, one.id, { category: "groceries" });
    expect(result).toEqual({ moved: 0, undo: null });
    await updateTransaction(ctx, one.id, { category: "dining" });

    // With it, every Chipotle charge moves and a rule is saved for the future.
    result = await updateTransaction(ctx, one.id, { category: "entertainment", remember: true });
    expect(result.moved).toBe(all.total - 1);
    expect(result.undo?.rule).toBeNull();
    const after = await getTransactions(ctx, { q: "chipotle", limit: 200, offset: 0 });
    expect(after.transactions.every((t) => t.category === "entertainment")).toBe(true);
    expect((await loadRules(db, DEMO_USER_ID)).get("chipotle")).toBe("entertainment");
    // Other merchants are untouched.
    const others = await getTransactions(ctx, { q: "sweetgreen", limit: 5, offset: 0 });
    expect(others.transactions.every((t) => t.category === "dining")).toBe(true);

    // Undo: the rule goes away and every charge is back where it was.
    await updateTransaction(ctx, one.id, { category: "dining", restore: result.undo! });
    const restored = await getTransactions(ctx, { q: "chipotle", limit: 200, offset: 0 });
    expect(restored.transactions.every((t) => t.category === "dining")).toBe(true);
    expect((await loadRules(db, DEMO_USER_ID)).has("chipotle")).toBe(false);
  });

  it("warns about a yearly renewal and spots a brand-new subscription", async () => {
    const r = await getRecurring(ctx);
    const dropbox = r.series.find((s) => s.name === "Dropbox")!;
    expect(dropbox).toMatchObject({ frequency: "yearly", renewsSoon: true, nextDate: "2026-12-07" });
    expect(dropbox.help.label).toBe("Open Dropbox");
    // Amazon Prime is yearly too, but months away: no warning.
    expect(r.series.find((s) => s.name === "Amazon Prime")?.renewsSoon).toBe(false);
    expect(r.possible.map((p) => p.name)).toEqual(["Disney+"]);
    const { attention } = await getOverview(ctx);
    expect(attention.find((a) => a.kind === "renewal")?.title).toBe("Dropbox renews in 18 days");
    expect(attention.find((a) => a.kind === "new")?.title).toBe("Disney+ looks like a new subscription");
  });

  it("builds a debt payoff plan from the loans, leaving out a card that is paid as it goes", async () => {
    const d = await getDebt(ctx);
    const byName = Object.fromEntries(d.debts.map((x) => [x.name, x]));
    expect(byName["Cashback Visa"]).toMatchObject({ paidInFull: true, order: null });
    // The loan payments were found in the transaction history.
    expect(byName["Auto Loan"]).toMatchObject({ payment: 31840, paymentSource: "history", aprPercent: 5.9, order: 1 });
    expect(byName["Student Loan"]).toMatchObject({ payment: 24000, aprPercent: 4.5, order: 2 });
    expect(d.plan.debtFreeMonth).toBe(d.base.debtFreeMonth);
    expect(d.plan.months).toBeGreaterThan(48);

    await setDebtSettings(ctx, { extra: 20000 });
    const faster = await getDebt(ctx);
    expect(faster.extra).toBe(20000);
    expect(faster.plan.months!).toBeLessThan(faster.base.months!);
    expect(faster.plan.totalInterest).toBeLessThan(faster.base.totalInterest);

    // The owner can correct a payment; it then counts as theirs.
    await setDebtPlan(ctx, byName["Student Loan"].id, { monthlyPayment: 40000 });
    expect((await getDebt(ctx)).debts.find((x) => x.name === "Student Loan")).toMatchObject({ payment: 40000, paymentSource: "yours" });
    await setDebtSettings(ctx, { extra: 0 });
  });

  it("doesn't count rent put on a card and paid back as paying it down, and a card charging interest isn't paid as you go", async () => {
    const card = "rent-card";
    await db.insert(accountsTable).values({ id: card, userId: DEMO_USER_ID, itemId: null, plaidAccountId: "test:rent-card", name: "Rent Card", institutionName: "Meridian Card", type: "credit", subtype: "credit card", balance: -250_000, aprPercent: 27.9, minimumPayment: 0 });
    // Rent goes on the card each month and is paid back in pieces; interest is charged on what's left.
    const rows = ["2026-08", "2026-09", "2026-10"].flatMap((m, i) => [
      { id: `rent-${i}`, date: `${m}-01`, name: "PARKVIEW APTS RENT", amount: -200_000, category: "housing" },
      { id: `back-a-${i}`, date: `${m}-09`, name: "PAYMENT THANK YOU", amount: 120_000, category: "transfer" },
      { id: `back-b-${i}`, date: `${m}-24`, name: "PAYMENT THANK YOU", amount: 80_000, category: "transfer" },
      { id: `int-${i}`, date: `${m}-28`, name: "INTEREST CHARGE ON PURCHASES", amount: -5_800, category: "fees" },
    ]);
    await db.insert(transactionsTable).values(rows.map((r) => ({ ...r, userId: DEMO_USER_ID, accountId: card, rawName: r.name })));
    try {
      const flat = (await getDebt(ctx)).debts.find((d) => d.id === card)!;
      // $6,000 paid in three months, but all of it was rent: the balance isn't going down.
      expect(flat).toMatchObject({ paidInFull: false, notShrinking: true, order: null });

      // Paying $600 beyond the rent in October is $200 a month toward it.
      await db.insert(transactionsTable).values({ id: "extra-pay", userId: DEMO_USER_ID, accountId: card, date: "2026-10-30", name: "PAYMENT THANK YOU", rawName: "PAYMENT THANK YOU", amount: 60_000, category: "transfer" });
      const going = (await getDebt(ctx)).debts.find((d) => d.id === card)!;
      expect(going).toMatchObject({ paidInFull: false, notShrinking: false, payment: 20_000, paymentSource: "history" });
      expect(going.order).not.toBeNull();

      // This month's rent on the card is shown as part of its balance until it's paid back.
      expect(going.billsThisMonth).toBeNull();
      await db.insert(transactionsTable).values({ id: "rent-now", userId: DEMO_USER_ID, accountId: card, date: "2026-11-01", name: "PARKVIEW APTS RENT", rawName: "PARKVIEW APTS RENT", amount: -205_000, category: "housing" });
      const now = (await getDebt(ctx)).debts.find((d) => d.id === card)!;
      expect(now.billsThisMonth).toMatchObject({ total: 205_000 });
      expect(now.billsThisMonth!.names).toHaveLength(1);
      // This month isn't over, so it doesn't change how fast the card is going down.
      expect(now.payment).toBe(20_000);
    } finally {
      await db.delete(transactionsTable).where(inArrayOp(transactionsTable.id, [...rows.map((r) => r.id), "extra-pay", "rent-now"]));
      await db.delete(accountsTable).where(eqOp(accountsTable.id, card));
    }
  });

  it("lists what bills and Extras charged this month and last, never card payments", async () => {
    const { paid, series } = await getRecurring(ctx);
    expect(paid.length).toBeGreaterThan(0);
    expect(paid.every((p) => p.date >= "2026-10-01" && p.date <= today && p.amount < 0)).toBe(true);
    expect(paid.map((p) => p.date)).toEqual([...paid.map((p) => p.date)].sort().reverse());
    expect(new Set(paid.map((p) => p.id)).size).toBe(paid.length);
    // Each one is a charge from a bill or an Extra on the Bills screen, labelled the same way.
    const kindOf = new Map(series.map((s) => [s.key, s.kind]));
    expect(paid.every((p) => kindOf.get(p.seriesKey) === p.kind && p.kind !== ("income" as string))).toBe(true);
    expect(paid.some((p) => p.name === "Parkview Apartments" && p.kind === "bill")).toBe(true);
    expect(paid.some((p) => p.kind === "subscription")).toBe(true);
    // Paying a card is moving your own money, not a bill.
    const transfers = new Set((await db.select({ id: transactionsTable.id }).from(transactionsTable).where(eqOp(transactionsTable.category, "transfer"))).map((t) => t.id));
    expect(paid.some((p) => transfers.has(p.id))).toBe(false);
  });

  it("counts only your part of a shared bill: rent split with a partner", async () => {
    const before = await getOverview(ctx);
    const rent = (await getRecurring(ctx)).series.find((s) => s.name === "Parkview Apartments")!;
    expect(rent.share).toBeNull();
    await setRecurringOverride(ctx, rent.key, { share: 0.5 });
    try {
      const r = await getRecurring(ctx);
      const half = r.series.find((s) => s.key === rent.key)!;
      expect(half).toMatchObject({ share: 0.5, amount: Math.round(rent.amount / 2), monthly: Math.round(rent.monthly / 2) });
      expect(half.history.every((h, i) => h.amount === Math.round(rent.history[i].amount / 2))).toBe(true);
      expect(r.upcoming.find((u) => u.key === rent.key)).toMatchObject({ share: 0.5, amount: Math.round(rent.amount / 2) });
      // Home's plan counts half of what's been paid this month and half of what's still to come.
      const after = await getOverview(ctx);
      const off = before.plan.billsExpected - after.plan.billsExpected;
      const paid = rent.history.filter((h) => h.date.startsWith("2026-11")).reduce((t, h) => t - h.amount, 0);
      const coming = (await getRecurring(ctx)).upcoming.filter((u) => u.key === rent.key && u.date.startsWith("2026-11")).length * -rent.amount;
      expect(Math.abs(off - (paid + coming) / 2)).toBeLessThanOrEqual(2);
      expect(off).toBeGreaterThan(0);
      expect(after.plan.leftToSpend - before.plan.leftToSpend).toBe(off);
      // The budget agrees with Home, and the bank's own record of the charge is untouched.
      expect((await getBudget(ctx, "2026-11")).plan.leftToSpend).toBe(after.plan.leftToSpend);
      const { transactions: charges } = await getTransactions(ctx, { q: "Parkview", limit: 5, offset: 0 });
      expect(charges[0].amount).toBe(rent.history[rent.history.length - 1].amount);
      // All of it again.
      await setRecurringOverride(ctx, rent.key, { share: 1 });
      expect((await getRecurring(ctx)).series.find((s) => s.key === rent.key)).toMatchObject({ share: null, amount: rent.amount });
    } finally {
      await setRecurringOverride(ctx, rent.key, { share: null });
    }
  });

  it("puts savings in the budget from the goals, and lets a flagged charge be waved off", async () => {
    const b = await getBudget(ctx, "2026-11");
    expect(b.savings.goals.length).toBeGreaterThan(0);
    expect(b.plan.saving).toBe(b.savings.goals.filter((g) => g.saved < g.target).reduce((t, g) => t + g.monthlyContribution, 0));
    expect(typeof b.savings.putAside).toBe("number");

    // "It's not a subscription" stops the flag; Undo brings it back.
    const disney = (await getRecurring(ctx)).possible.find((p) => p.name === "Disney+")!;
    await setRecurringOverride(ctx, disney.key, { kind: "ignore" });
    expect((await getRecurring(ctx)).possible.some((p) => p.key === disney.key)).toBe(false);
    await setRecurringOverride(ctx, disney.key, { kind: null });
    expect((await getRecurring(ctx)).possible.some((p) => p.key === disney.key)).toBe(true);
  });

  it("runs the no-spend week at the end of the month, then offers what was left over to savings", async () => {
    // A few days off: not yet.
    expect((await getOverview(ctx)).noSpend).toBeNull();
    // During it (the sample's charges stop on the 19th, so the 24th and 25th were clean).
    const during = (await getOverview({ ...ctx, today: "2026-11-26" })).noSpend!;
    expect(during).toMatchObject({ phase: "on", month: "2026-11", start: "2026-11-24", end: "2026-11-30", clear: 2 });
    expect(during.days.map((d) => d.state)).toEqual(["clear", "clear", "today", "ahead", "ahead", "ahead", "ahead"]);
    expect(during.leftover).toBe((await getOverview({ ...ctx, today: "2026-11-26" })).plan.leftToSpend);
    // After: last month's week and what it left over, with the goals it could go to.
    const after = (await getOverview({ ...ctx, today: "2026-12-03" })).noSpend!;
    expect(after).toMatchObject({ phase: "done", month: "2026-11", clear: 7 });
    expect(after.goals.length).toBeGreaterThan(0);
    // A whole clean week is a win, once.
    const december = { ...ctx, today: "2026-12-03" };
    await checkIn(december);
    await checkIn(december);
    const wins = await db.select().from(playerWinsTable).where(and(eqOp(playerWinsTable.userId, DEMO_USER_ID), eqOp(playerWinsTable.kind, "nospendweek")));
    expect(wins).toHaveLength(1);
    expect(wins[0]).toMatchObject({ ref: "2026-11", xp: 75 });
    await db.delete(playerWinsTable).where(and(eqOp(playerWinsTable.userId, DEMO_USER_ID), inArrayOp(playerWinsTable.day, ["2026-12-03"])));
  });

  it("adds up interest and fees: this month, 90 days, this year, by account", async () => {
    const before = (await getDebt(ctx)).costs;
    const rows = [
      { id: "fee-int", date: "2026-11-12", name: "INTEREST CHARGE:PURCHASES", amount: -5_377 },
      { id: "fee-late", date: "2026-10-11", name: "PAST DUE FEE", amount: -4_000 },
      { id: "fee-back", date: "2026-10-20", name: "LATE FEE REFUND", amount: 4_000 },
      { id: "fee-old", date: "2025-12-15", name: "INTEREST CHARGE:PURCHASES", amount: -9_999 }, // last year
    ];
    await db.insert(transactionsTable).values(rows.map((r) => ({ ...r, userId: DEMO_USER_ID, accountId: "demo-card", rawName: r.name, category: "fees" })));
    try {
      const c = (await getDebt(ctx)).costs;
      expect(c.thisMonth - before.thisMonth).toBe(5_377);
      expect(c.thisYear - before.thisYear).toBe(5_377); // the late fee was refunded; last year's isn't this year
      expect(c.interestYear - before.interestYear).toBe(5_377);
      expect(c.feesYear - before.feesYear).toBe(0);
      expect(c.byAccount.some((a) => a.name === "Cashback Visa")).toBe(true);
      expect(c.latest[0]).toMatchObject({ kind: "interest", amount: 5_377 });
    } finally {
      await db.delete(transactionsTable).where(inArrayOp(transactionsTable.id, rows.map((r) => r.id)));
    }
  });

  it("plans a lighter paycheck (missed days) and re-plans the month around it, with Undo", async () => {
    const before = await getBudget(ctx, "2026-11");
    const next = before.paychecks.find((p) => !p.received)!;
    expect(next).toMatchObject({ adjusted: false, amount: next.usual });
    expect(before.paychecks.some((p) => p.received)).toBe(true);
    const lighter = Math.round((next.usual * (next.workdays - 2)) / next.workdays);
    expect((await setPaycheck(ctx, next.key, next.date, lighter)).previous).toBeNull();
    try {
      const after = await getBudget(ctx, "2026-11");
      expect(after.paychecks.find((p) => p.key === next.key && p.date === next.date)).toMatchObject({ amount: lighter, adjusted: true });
      expect(after.plan.income).toBe(before.plan.income - (next.usual - lighter));
      expect(after.plan.leftToSpend).toBe(before.plan.leftToSpend - (next.usual - lighter));
      expect((await getOverview(ctx)).plan.leftToSpend).toBe(after.plan.leftToSpend);
      // Only a paycheck, and only one that hasn't come in.
      await expect(setPaycheck(ctx, "out:netflix", next.date, 100)).rejects.toThrow();
      await expect(setPaycheck(ctx, next.key, "2026-10-01", 100)).rejects.toThrow();
    } finally {
      expect((await setPaycheck(ctx, next.key, next.date, null)).previous).toBe(lighter);
    }
    expect((await getBudget(ctx, "2026-11")).plan.income).toBe(before.plan.income);
  });

  it("shows round-ups as round-ups, kept off Home's latest", async () => {
    const rows = [
      { id: "ru-in", accountId: "demo-savings", name: "Ingles Markets", rawName: "Roundup *INGLES MARKETS #480", amount: 80 },
      { id: "ru-out", accountId: "demo-checking", name: "Ingles Markets", rawName: "Roundup *INGLES MARKETS #480", amount: -80 },
      { id: "ru-in2", accountId: "demo-savings", name: "Roundup *RICE AND SPICE CARROLL", rawName: "Roundup *RICE AND SPICE CARROLL", amount: 65 },
    ];
    await db.insert(transactionsTable).values(rows.map((r) => ({ ...r, userId: DEMO_USER_ID, date: today, category: "transfer" })));
    try {
      const { transactions } = await getTransactions(ctx, { month: "2026-11", limit: 200, offset: 0 });
      const byId = Object.fromEntries(transactions.map((t) => [t.id, t]));
      expect(byId["ru-in"]).toMatchObject({ roundUp: true, name: "Round-up from Ingles Markets" });
      expect(byId["ru-out"]).toMatchObject({ roundUp: true, name: "Round-up for Ingles Markets" });
      expect(byId["ru-in2"].name).toMatch(/^Round-up from Rice/);
      // A card's own small credit isn't one.
      expect(transactions.filter((t) => t.accountId === "demo-card").every((t) => !t.roundUp)).toBe(true);
      expect((await getOverview(ctx)).recent.some((t) => t.roundUp)).toBe(false);
    } finally {
      await db.delete(transactionsTable).where(inArrayOp(transactionsTable.id, rows.map((r) => r.id)));
    }
  });

  it("lets a goal follow a real savings account, so it updates on its own", async () => {
    const savings = (await getAccounts(ctx)).institutions.flatMap((i) => i.accounts).find((a) => a.id === "demo-savings")!;
    const id = await createGoal(ctx, { name: "Vault goal", target: 5_000_000, saved: 99_999, monthlyContribution: 10_000, targetDate: null, accountId: "demo-savings" });
    try {
      const goal = (await getGoals(ctx)).goals.find((g) => g.id === id)!;
      expect(goal).toMatchObject({ saved: Math.max(0, savings.balance), account: { id: "demo-savings", name: savings.name } });
      // It updates on its own, so money can't be put in by hand.
      await expect(updateGoal(ctx, id, { add: 1_000 })).rejects.toThrow(/follows an account/);
      // Only a savings-type account of your own.
      await expect(createGoal(ctx, { name: "Nope", target: 1_000, saved: 0, monthlyContribution: 0, targetDate: null, accountId: "demo-checking" })).rejects.toThrow();
      // Stops following: keeps the balance as what's saved.
      await updateGoal(ctx, id, { accountId: null });
      expect((await getGoals(ctx)).goals.find((g) => g.id === id)).toMatchObject({ account: null, saved: Math.max(0, savings.balance) });
    } finally {
      await db.delete(goalsTable).where(eqOp(goalsTable.id, id));
    }
  });

  it("adds the week ahead and a check-in to the weekly review, and finishing it is a win once a week", async () => {
    const r = await getRecap(ctx, 0);
    const a = r.ahead!;
    expect(a).toMatchObject({ from: today, to: "2026-11-25", reviewed: false });
    expect(a.leftToSpend).toBe((await getOverview(ctx)).plan.leftToSpend);
    expect(a.bills.every((b) => b.date >= today && b.date <= "2026-11-25")).toBe(true);
    expect(a.paychecks.every((p) => p.date >= today && p.date <= "2026-11-25")).toBe(true);
    expect(typeof a.unsorted).toBe("number");
    // Only the most recent week looks ahead.
    expect((await getRecap(ctx, 1)).ahead).toBeNull();
    const key = weekKey(today);
    expect(key).toBe("2026-11-16");
    expect(await win(ctx, "review", key, "Week of Nov 16")).toBe(true);
    expect(await win(ctx, "review", key, "Week of Nov 16")).toBe(false);
    expect((await getRecap(ctx, 0)).ahead!.reviewed).toBe(true);
    await db.delete(playerWinsTable).where(and(eqOp(playerWinsTable.userId, DEMO_USER_ID), eqOp(playerWinsTable.kind, "review")));
  });

  it("lets the owner make categories of their own: sort into them, budget them, rename and remove with Undo", async () => {
    const car = await createCategory(ctx, { label: "Car", icon: "transport" });
    expect(car.key).toMatch(/^c_[a-z0-9]{10}$/);
    await expect(createCategory(ctx, { label: "car" })).rejects.toThrow(/already/);
    await expect(createCategory(ctx, { label: "Groceries" })).rejects.toThrow(/already/);
    await expect(createCategory(ctx, { label: "Tools", icon: "not-an-icon" })).rejects.toThrow(/icons/);
    const list = await loadUserCategories(ctx);
    // A charge goes into it, it can have a budget, and it's known by name wherever the request goes.
    const [charge] = (await getTransactions(ctx, { category: "shopping", month: "2026-11", limit: 1, offset: 0 })).transactions;
    await updateTransaction(ctx, charge.id, { category: car.key });
    await setBudget(ctx, car.key, 15_000);
    await withCategories(list, async () => {
      expect(category(car.key)).toMatchObject({ label: "Car", group: "spending", icon: "transport" });
      const row = (await getBudget(ctx, "2026-11")).rows.find((r) => r.category === car.key)!;
      expect(row).toMatchObject({ limit: 15_000 });
      expect(row.spent).toBeGreaterThan(0);
    });
    // Outside a request, or someone else's key, it isn't usable.
    await expect(updateTransaction(ctx, charge.id, { category: "c_nottheirs1" })).rejects.toThrow(/Unknown category/);
    // Rename.
    expect((await updateCategory(ctx, car.key, { label: "Car stuff" })).previous.label).toBe("Car");
    // Remove: its charges go back to Everything else; Undo puts it all back.
    const undo = await removeCategory(ctx, car.key);
    expect(undo.transactionIds).toContain(charge.id);
    expect(undo.budget).toMatchObject({ monthlyLimit: 15_000 });
    expect((await getTransactions(ctx, { q: charge.bankName, limit: 50, offset: 0 })).transactions.find((t) => t.id === charge.id)?.category).toBe("other");
    await restoreCategory(ctx, undo);
    expect((await loadUserCategories(ctx)).some((c) => c.key === car.key && c.label === "Car stuff")).toBe(true);
    expect((await getTransactions(ctx, { q: charge.bankName, limit: 50, offset: 0 })).transactions.find((t) => t.id === charge.id)?.category).toBe(car.key);
    // Tidy up.
    await removeCategory(ctx, car.key);
    await updateTransaction(ctx, charge.id, { category: "shopping" });
  });

  it("recaps last week, Monday to Sunday", async () => {
    const r = await getRecap(ctx, 0);
    // Today is Thursday Nov 19, so last week ran Nov 9 to Nov 15.
    expect(r).toMatchObject({ from: "2026-11-09", to: "2026-11-15" });
    expect(r.spent).toBeGreaterThan(0);
    expect(r.income).toBe(284632);
    expect(r.topCategories.length).toBeLessThanOrEqual(3);
    expect(r.topCategories.reduce((s, c) => s + c.spent, 0)).toBeLessThanOrEqual(r.spent);
    expect(r.noSpendDays).toBeGreaterThanOrEqual(0);
    expect(r.noSpendDays).toBeLessThanOrEqual(7);
    expect(r.biggest!.amount).toBeLessThan(0);
    expect(r.netWorthChange).not.toBeNull();
    expect((await getRecap(ctx, 1)).to).toBe("2026-11-08");
  });

  it("counts only necessities as bills paid in the recap; Extras are spending", async () => {
    const r = await getRecap(ctx, 0);
    const { series } = await getRecurring(ctx);
    const paid = (kind: string) => series.filter((s) => s.kind === kind).flatMap((s) => s.history).filter((h) => h.date >= r.from && h.date <= r.to && h.amount < 0);
    const bills = paid("bill");
    expect(paid("subscription").length).toBeGreaterThan(0);
    expect(r.billsPaid.count).toBe(bills.length);
    expect(Math.abs(r.billsPaid.total)).toBe(Math.abs(bills.reduce((s, h) => s + h.amount, 0)));
  });

  it("gives each goal a plan: open-ended, behind, on track", async () => {
    const { goals } = await getGoals(ctx);
    expect(goals.map((g) => [g.name, g.status])).toEqual([
      ["Emergency fund", "no_date"],
      ["Down payment", "behind"],
      ["Two weeks in Japan", "on_track"],
    ]);
    const japan = goals[2];
    // $2,350 to go by the end of August: about 9.4 months, so $251 a month.
    expect(japan.perMonth).toBe(25_100);
    // Paychecks every two weeks: the plan also says how much from each one.
    expect(japan.perPayday).not.toBeNull();
    expect(japan.nextPayday! > today).toBe(true);
    const home = goals[1];
    expect(home.gap).toBeLessThan(-500_000);
  });

  it("draws a goal's track: history, checkpoints, milestones and ideas", async () => {
    const japan = (await getGoals(ctx)).goals.find((g) => g.name === "Two weeks in Japan")!;
    const detail = await getGoal(ctx, japan.id);
    expect(detail.startSaved).toBe(65_000);
    expect(detail.history[0]).toEqual({ date: detail.startDate, amount: 65_000 });
    expect(detail.history.at(-1)!.amount).toBe(215_000);
    expect(detail.deposits.length).toBe(6);
    expect(detail.checkpoints.at(-1)).toMatchObject({ date: japan.targetDate, amount: 450_000 });
    expect(detail.milestones.map((m) => m.percent)).toEqual([25, 50, 75, 100]);
    expect(detail.milestones[0].reachedOn).not.toBeNull();
    expect(detail.payFrequency).toBe("Every 2 weeks");
    await expect(getGoal({ ...ctx, userId: "someone-else" }, japan.id)).rejects.toThrow("wasn’t found");
  });

  it("writes each deposit down, and Undo takes exactly that deposit back off", async () => {
    const goal = (await getGoals(ctx)).goals[0];
    const { depositId } = await updateGoal(ctx, goal.id, { add: 12_345 });
    expect(depositId).toBeTruthy();
    expect((await getGoal(ctx, goal.id)).deposits[0]).toMatchObject({ id: depositId, amount: 12_345, date: today });
    // Someone else can't remove it.
    await expect(deleteDeposit({ ...ctx, userId: "someone-else" }, goal.id, depositId!)).rejects.toThrow("wasn’t found");
    await deleteDeposit(ctx, goal.id, depositId!);
    expect((await getGoals(ctx)).goals[0].saved).toBe(goal.saved);
    // Taking out more than is there takes out what is there, and records that.
    const out = await updateGoal(ctx, goal.id, { add: -999_999_999 });
    expect((await getGoals(ctx)).goals[0].saved).toBe(0);
    expect((await getGoal(ctx, goal.id)).deposits[0].amount).toBe(-goal.saved);
    await deleteDeposit(ctx, goal.id, out.depositId!);
    expect((await getGoals(ctx)).goals[0].saved).toBe(goal.saved);
  });

  it("never lets Undo or two changes at once make money appear or vanish on paper", async () => {
    const goal = (await getGoals(ctx)).goals[0];
    const add = await updateGoal(ctx, goal.id, { add: 50_000 });
    const out = await updateGoal(ctx, goal.id, { add: -99_999_999 });
    // Undoing the add now would take $500 off a goal with nothing in it: refused, nothing changes.
    await expect(deleteDeposit(ctx, goal.id, add.depositId!)).rejects.toThrow("already been taken out");
    expect((await getGoals(ctx)).goals[0].saved).toBe(0);
    // Undo the take-out, then the add: back exactly where it started.
    await deleteDeposit(ctx, goal.id, out.depositId!);
    await deleteDeposit(ctx, goal.id, add.depositId!);
    const back = (await getGoal(ctx, goal.id));
    expect(back.goal.saved).toBe(goal.saved);
    expect(back.startSaved).toBe((await getGoal(ctx, goal.id)).startSaved);

    // Two take-outs at once: what's saved and the deposit list still agree.
    const results = await Promise.all([updateGoal(ctx, goal.id, { add: -goal.saved }), updateGoal(ctx, goal.id, { add: -goal.saved })]);
    const after = await getGoal(ctx, goal.id);
    expect(after.goal.saved).toBe(0);
    const taken = after.deposits.filter((d) => results.some((r) => r.depositId === d.id)).reduce((s, d) => s + d.amount, 0);
    expect(taken).toBe(-goal.saved);
    for (const r of results) if (r.depositId) await deleteDeposit(ctx, goal.id, r.depositId);
    expect((await getGoals(ctx)).goals[0].saved).toBe(goal.saved);
  });

  it("starts the plan today for a goal made before deposits were recorded", async () => {
    const { goals: goalTable } = await import("@/db/schema");
    await db.insert(goalTable).values({ id: "legacy-goal", userId: DEMO_USER_ID, name: "Old goal", target: 1_000_000, saved: 500_000, monthlyContribution: 0, targetDate: "2027-05-19", createdAt: new Date("2026-05-19T15:00:00Z") });
    const legacy = await getGoal(ctx, "legacy-goal");
    expect(legacy.startDate).toBe(today);
    expect(legacy.goal.status).toBe("on_track");
    const { eq } = await import("drizzle-orm");
    await db.delete(goalTable).where(eq(goalTable.id, "legacy-goal"));
  });

  it("saves budget limits, goal deposits and cancelled subscriptions", async () => {
    await setBudget(ctx, "travel", 30000);
    expect((await getBudget(ctx, "2026-11")).rows.find((r) => r.category === "travel")?.limit).toBe(30000);
    await setBudget(ctx, "travel", null);
    expect((await getBudget(ctx, "2026-11")).rows.find((r) => r.category === "travel")?.limit ?? null).toBeNull();

    const goals = await getGoals(ctx);
    await updateGoal(ctx, goals.goals[0].id, { add: 5000 });
    expect((await getGoals(ctx)).goals[0].saved).toBe(goals.goals[0].saved + 5000);

    const before = await getRecurring(ctx);
    const spotify = before.series.find((s) => s.name === "Spotify")!;
    await setRecurringOverride(ctx, spotify.key, { cancelled: true });
    const after = await getRecurring(ctx);
    expect(after.series.find((s) => s.name === "Spotify")).toMatchObject({ cancelled: true, active: false });
    expect(after.monthlySubscriptions).toBe(before.monthlySubscriptions - 1199);
    expect(after.upcoming.some((u) => u.name === "Spotify")).toBe(false);
    await setRecurringOverride(ctx, spotify.key, { cancelled: false });
  });

  it("lays out the month's money in one plan that agrees with Home", async () => {
    const [budget, overview] = await Promise.all([getBudget(ctx, "2026-11"), getOverview(ctx)]);
    const p = budget.plan;
    expect(p.leftToSpend).toBe(overview.plan.leftToSpend);
    expect(p.income).toBe(overview.plan.incomeExpected);
    expect(p.unplanned).toBe(p.income - p.bills - p.saving - p.budgeted);
    expect(budget.isCurrent).toBe(true);
    expect(budget.daysLeft).toBe(12);
    expect(budget.monthPlan?.days).toHaveLength(30);
    // Netflix is an Extra (a subscription you could live without): it counts in Entertainment's budget.
    const ent = budget.rows.find((r) => r.category === "entertainment")!;
    expect(ent.bills).toBe(0);
    const { transactions: netflix } = await getTransactions(ctx, { q: "Netflix", month: "2026-11", limit: 5, offset: 0 });
    expect(netflix.length).toBeGreaterThan(0);
    expect(ent.spent).toBeGreaterThanOrEqual(-netflix.reduce((s, t) => s + t.amount, 0));
    // Rent is a bill: set aside each month, shown beside housing, never counted against a budget.
    expect(budget.rows.find((r) => r.category === "housing")?.bills).toBeGreaterThan(0);
    // Groceries rolls over in the sample household, so last month's leftover (or overspend) is carried in.
    const groceries = budget.rows.find((r) => r.category === "groceries")!;
    expect(groceries.rollover).toBe(true);
    expect(groceries.carried).not.toBe(0);
    expect(groceries.left).toBe(groceries.limit! + groceries.carried - groceries.spent);
    // Every row with a limit says whether it's on track.
    expect(budget.rows.filter((r) => r.limit !== null).every((r) => ["good", "watch", "over"].includes(r.status))).toBe(true);
    // A past month is final.
    const oct = await getBudget(ctx, "2026-10");
    expect(oct.isCurrent).toBe(false);
    expect(oct.monthPlan).toBeNull();
    expect(oct.suggestion).toBeNull();
    expect(oct.rows.filter((r) => r.limit !== null).every((r) => r.perDay === null && r.forecast === r.spent)).toBe(true);
  });

  it("suggests a starting budget for spending with no limit, and applies several at once with Undo", async () => {
    // The sample household budgets everything it spends on; take one away to see it suggested.
    const shopping = (await getBudget(ctx, "2026-11")).rows.find((r) => r.category === "shopping")!;
    expect((await getBudget(ctx, "2026-11")).suggestion?.limits.some((l) => l.category === "shopping") ?? false).toBe(true);
    await setBudget(ctx, "shopping", null);
    const budget = await getBudget(ctx, "2026-11");
    expect(budget.suggestion).not.toBeNull();
    const pick = budget.suggestion!.limits.find((l) => l.category === "shopping")!;
    // What's usually spent, rounded up to the next $10, or trimmed to fit what the month has room for.
    if (budget.suggestion!.trimmed) expect(pick.limit).toBeLessThan(Math.ceil(shopping.average / 1000) * 1000);
    else expect(pick.limit).toBe(Math.ceil(shopping.average / 1000) * 1000);
    expect(budget.suggestion!.room).toBe(budget.plan.income - budget.plan.bills - budget.plan.saving);
    const { previous } = await setBudgets(ctx, [{ category: "shopping", monthlyLimit: pick.limit }]);
    expect((await getBudget(ctx, "2026-11")).rows.find((r) => r.category === "shopping")?.limit).toBe(pick.limit);
    expect(previous).toEqual([{ category: "shopping", monthlyLimit: null, rolloverSince: null, rolloverCarry: 0 }]);
    await setBudgets(ctx, previous);
    expect((await getBudget(ctx, "2026-11")).rows.find((r) => r.category === "shopping")?.limit).toBeNull();
    await setBudget(ctx, "shopping", shopping.limit);
    // The same category twice, or one that isn't spending, is refused.
    await expect(setBudgets(ctx, [{ category: "dining", monthlyLimit: 1 }, { category: "dining", monthlyLimit: 2 }])).rejects.toThrow();
    await expect(setBudgets(ctx, [{ category: "income", monthlyLimit: 1 }])).rejects.toThrow();
  });

  it("switches rollover on and off, and Undo puts it back exactly", async () => {
    const row = async (c: string) => (await getBudget(ctx, "2026-11")).rows.find((r) => r.category === c)!;
    const { previous } = await setRollover(ctx, "dining", true);
    expect(previous.rolloverSince).toBeNull();
    expect((await row("dining")).rollover).toBe(true);
    // Switching on starts from this month: nothing is carried until it ends.
    expect((await row("dining")).carried).toBe(0);
    await setRollover(ctx, "dining", false);
    expect((await row("dining")).rollover).toBe(false);
    // Turning groceries off forgets what it carried; putting the answer back restores it exactly.
    const before = await row("groceries");
    const g = await setRollover(ctx, "groceries", false);
    expect(g.previous.rolloverSince).toMatch(/^\d{4}-\d{2}$/);
    expect((await row("groceries")).carried).toBe(0);
    await setBudget(ctx, "groceries", g.previous.monthlyLimit, { rolloverSince: g.previous.rolloverSince, rolloverCarry: g.previous.rolloverCarry });
    expect((await row("groceries")).carried).toBe(before.carried);
    // Rollover needs a limit, and a month in the future can't be set.
    await expect(setRollover(ctx, "travel", true)).rejects.toThrow(/limit/);
    await expect(setBudget(ctx, "dining", 28000, { rolloverSince: "2030-01" })).rejects.toThrow();
  });

  it("counts anything spent on a necessity as a bill, never as everyday spending or a budget", async () => {
    const before = await getBudget(ctx, "2026-11");
    const home = (b: typeof before) => b.rows.find((r) => r.category === "housing");
    // A one-off hardware-store run the bank files under Home & rent.
    await db.insert(transactionsTable).values({ id: "home-depot", userId: DEMO_USER_ID, accountId: "demo-card", date: today, name: "THE HOME DEPOT #4410", rawName: "THE HOME DEPOT #4410", amount: -2_029, category: "housing" });
    try {
      const after = await getBudget(ctx, "2026-11");
      expect(home(after)!.spent).toBe(home(before)?.spent ?? 0);
      expect(home(after)!.bills).toBe((home(before)?.bills ?? 0) + 2_029);
      expect(after.plan.bills).toBe(before.plan.bills + 2_029);
      expect(after.plan.everydaySpent).toBe(before.plan.everydaySpent);
      // Home and the budget still agree.
      expect(after.plan.leftToSpend).toBe((await getOverview(ctx)).plan.leftToSpend);
      // Necessities are never offered a budget.
      expect(after.suggestion?.limits.some((l) => ["housing", "utilities", "insurance", "loans"].includes(l.category))).toBe(false);
      // Moved to Shopping, it's everyday spending again.
      await db.update(transactionsTable).set({ category: "shopping" }).where(eqOp(transactionsTable.id, "home-depot"));
      const moved = await getBudget(ctx, "2026-11");
      expect(moved.plan.bills).toBe(before.plan.bills);
      expect(moved.plan.everydaySpent).toBe(before.plan.everydaySpent + 2_029);
    } finally {
      await db.delete(transactionsTable).where(eqOp(transactionsTable.id, "home-depot"));
    }
  });

  it("moving a subscription to Bills sets it aside each month; moving it back makes it an Extra again", async () => {
    const before = await getBudget(ctx, "2026-11");
    const netflix = (await getRecurring(ctx)).series.find((s) => s.name === "Netflix")!;
    expect(netflix.kind).toBe("subscription");
    await setRecurringOverride(ctx, netflix.key, { kind: "bill" });
    const asBill = await getBudget(ctx, "2026-11");
    const ent = (b: typeof before) => b.rows.find((r) => r.category === "entertainment")!;
    expect(ent(asBill).bills).toBeGreaterThan(0);
    expect(ent(asBill).spent).toBe(ent(before).spent - ent(asBill).bills);
    expect(asBill.plan.bills).toBeGreaterThan(before.plan.bills);
    // Home's number moves with it: the plan always adds up to "left to spend".
    expect(asBill.plan.leftToSpend).toBe((await getOverview(ctx)).plan.leftToSpend);
    await setRecurringOverride(ctx, netflix.key, { kind: "subscription" });
    expect((await getBudget(ctx, "2026-11")).plan.bills).toBe(before.plan.bills);
  });

  it("keeps what rollover carried at the old limit when the limit changes", async () => {
    const row = async () => (await getBudget(ctx, "2026-11")).rows.find((r) => r.category === "groceries")!;
    const before = await row();
    const state = await budgetState(ctx, "groceries");
    // Doubling the limit doesn't rewrite the months before: what they carried stays as it was.
    await setBudget(ctx, "groceries", 130000);
    const after = await row();
    expect(after.carried).toBe(before.carried);
    expect(after.left).toBe(130000 + before.carried - before.spent);
    // Undo puts the limit and the rollover back exactly.
    await setBudget(ctx, "groceries", state.monthlyLimit, { rolloverSince: state.rolloverSince, rolloverCarry: state.rolloverCarry });
    expect(await budgetState(ctx, "groceries")).toEqual(state);
    expect((await row()).carried).toBe(before.carried);
  });

  it("removing a budget can be undone exactly, start date and rollover included", async () => {
    const [kept] = await db.select().from(budgetsTable).where(and(eqOp(budgetsTable.userId, DEMO_USER_ID), eqOp(budgetsTable.category, "groceries")));
    const state = await budgetState(ctx, "groceries");
    await setBudget(ctx, "groceries", null);
    expect(await budgetState(ctx, "groceries")).toEqual({ monthlyLimit: null, rolloverSince: null, rolloverCarry: 0 });
    expect((await getBudget(ctx, "2026-11")).rows.find((r) => r.category === "groceries")?.limit).toBeNull();
    await setBudget(ctx, "groceries", state.monthlyLimit, { rolloverSince: state.rolloverSince, rolloverCarry: state.rolloverCarry });
    const [back] = await db.select().from(budgetsTable).where(and(eqOp(budgetsTable.userId, DEMO_USER_ID), eqOp(budgetsTable.category, "groceries")));
    expect(back.createdAt.getTime()).toBe(kept.createdAt.getTime());
    expect(await budgetState(ctx, "groceries")).toEqual(state);
  });

  it("never leaves out what's spent on bills: categories paid only by bills still have a row", async () => {
    const budget = await getBudget(ctx, "2026-11");
    const housing = budget.rows.find((r) => r.category === "housing");
    expect(housing?.bills).toBeGreaterThan(0);
    expect(housing?.limit).toBeNull();
    // This month's plan counts only this month's limits; what rollover carried is shown on its own.
    expect(budget.plan.budgeted).toBe(budget.rows.reduce((s, r) => s + (r.limit ?? 0), 0));
    expect(budget.plan.carried).toBe(budget.rows.reduce((s, r) => s + (r.limit === null ? 0 : r.carried), 0));
  });
});

describe("names", () => {
  const all = { limit: 200, offset: 0 };

  it("tidies bank code on its own and keeps what the bank sent", async () => {
    const { transactions: tartine } = await getTransactions(ctx, { ...all, q: "Tartine" });
    expect(tartine.length).toBeGreaterThan(2);
    expect(tartine[0]).toMatchObject({ name: "Tartine Bakery", bankName: "SQ *TARTINE BAKERY 0423 SAN FRANCISCO CA", nameSource: "clean", ruleId: null });
    const patreon = (await getRecurring(ctx)).series.find((s) => s.bankName.startsWith("PATREON"));
    expect(patreon).toMatchObject({ name: "Patreon", key: "out:patreon membership ca" });
    // Plain names are left exactly as they are.
    expect((await getTransactions(ctx, { ...all, q: "Netflix" })).transactions[0]).toMatchObject({ name: "Netflix", nameSource: "bank" });
    expect((await countUnclear(ctx)).count).toBeGreaterThanOrEqual(3);
  });

  it("names every charge like one, past and future, finds them by the new name, and Undo puts it all back", async () => {
    const { transactions: before } = await getTransactions(ctx, { ...all, q: "Tartine" });
    const result = await createNameRule(ctx, { transactionId: before[0].id, name: "  Morning   buns " });
    expect(result.count).toBe(before.length);
    expect(result.undo).toMatchObject({ previousName: null, customName: null });

    const { transactions: after } = await getTransactions(ctx, { ...all, q: "morning buns" });
    expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
    expect(after.every((t) => t.name === "Morning buns" && t.nameSource === "rule" && t.ruleId === result.ruleId)).toBe(true);

    // A new charge from another branch arrives already named.
    await db.insert(transactionsTable).values({ id: "names-new", userId: DEMO_USER_ID, accountId: "demo-card", date: today, name: "SQ *TARTINE BAKERY 1102 OAKLAND CA", rawName: "SQ *TARTINE BAKERY 1102 OAKLAND CA", amount: -950, category: "dining" });
    expect((await getTransactions(ctx, { ...all, q: "morning buns" })).transactions.some((t) => t.id === "names-new")).toBe(true);

    // Renaming again keeps the same rule and remembers the old name for Undo.
    const again = await createNameRule(ctx, { transactionId: "names-new", name: "Tartine" });
    expect(again.ruleId).toBe(result.ruleId);
    expect(again.undo.previousName).toBe("Morning buns");

    await deleteNameRule(ctx, result.ruleId);
    expect((await getTransactions(ctx, { ...all, q: "Tartine" })).transactions.every((t) => t.name === "Tartine Bakery")).toBe(true);
    await db.delete(transactionsTable).where(eqOp(transactionsTable.id, "names-new"));
  });

  it("can name only charges of one exact amount", async () => {
    const r = await getRecurring(ctx);
    const patreon = r.series.find((s) => s.bankName.startsWith("PATREON"))!;
    const { ruleId } = await createNameRule(ctx, { transactionId: patreon.sampleId, name: "Podcast club", onlyThisAmount: true });
    await db.insert(transactionsTable).values({ id: "names-odd", userId: DEMO_USER_ID, accountId: "demo-card", date: today, name: "PATREON* MEMBERSHIP 4155550123 CA", rawName: null, amount: -1_500, category: "entertainment" });
    const { transactions } = await getTransactions(ctx, { ...all, q: "PATREON" });
    expect(transactions.find((t) => t.id === "names-odd")).toMatchObject({ name: "Patreon", nameSource: "clean" });
    expect(transactions.filter((t) => t.amount === -800).every((t) => t.name === "Podcast club" && t.ruleExact)).toBe(true);
    await deleteNameRule(ctx, ruleId);
    await db.delete(transactionsTable).where(eqOp(transactionsTable.id, "names-odd"));
  });

  it("lets one transaction have its own name, which beats a rule and can be removed", async () => {
    const { transactions } = await getTransactions(ctx, { ...all, q: "Tartine" });
    const [one, other] = transactions;
    const { ruleId } = await createNameRule(ctx, { transactionId: other.id, name: "Tartine" });
    await updateTransaction(ctx, one.id, { name: "Birthday cake" });
    let list = (await getTransactions(ctx, { ...all, q: "Tartine" })).transactions;
    expect(list.find((t) => t.id === one.id)).toMatchObject({ name: "Birthday cake", nameSource: "custom", customName: "Birthday cake" });
    expect(list.find((t) => t.id === other.id)).toMatchObject({ name: "Tartine", nameSource: "rule" });
    expect((await getTransactions(ctx, { ...all, q: "birthday" })).transactions.map((t) => t.id)).toEqual([one.id]);

    // Naming every charge like it again makes the one-off name give way, and Undo brings it back.
    // From a bill or the Names screen, a charge's own name is left alone…
    expect((await createNameRule(ctx, { transactionId: one.id, name: "Tartine" })).undo.customName).toBeNull();
    expect((await getTransactions(ctx, { ...all, q: "Tartine" })).transactions.find((t) => t.id === one.id)?.name).toBe("Birthday cake");
    // …but renaming every charge like it from its own sheet makes it give way, and Undo can bring it back.
    const result = await createNameRule(ctx, { transactionId: one.id, name: "Tartine", fromItsSheet: true });
    expect(result.undo.customName).toBe("Birthday cake");
    expect((await getTransactions(ctx, { ...all, q: "Tartine" })).transactions.find((t) => t.id === one.id)?.name).toBe("Tartine");

    await updateTransaction(ctx, one.id, { name: "Birthday cake" });
    await updateTransaction(ctx, one.id, { name: null });
    list = (await getTransactions(ctx, { ...all, q: "Tartine" })).transactions;
    expect(list.find((t) => t.id === one.id)).toMatchObject({ name: "Tartine", customName: null });
    await expect(updateTransaction(ctx, one.id, { name: "x".repeat(61) })).rejects.toMatchObject({ status: 400 });
    await deleteNameRule(ctx, ruleId);
  });

  it("lets 'every charge' take over from a name kept for one amount, and Undo knows to put it back", async () => {
    const patreon = (await getRecurring(ctx)).series.find((s) => s.bankName.startsWith("PATREON"))!;
    const exact = await createNameRule(ctx, { transactionId: patreon.sampleId, name: "Podcast club", onlyThisAmount: true });
    expect((await getRecurring(ctx)).series.find((s) => s.key === patreon.key)).toMatchObject({ name: "Podcast club", ruleExact: true });
    const preview = await previewNameRule(ctx, patreon.sampleId, false);
    const every = await createNameRule(ctx, { transactionId: patreon.sampleId, name: "Podcasts" });
    expect(every.undo.replaced).toEqual({ amount: -800, name: "Podcast club" });
    expect(every.count).toBe(preview.count);
    expect(every.count).toBe(patreon.count);
    expect((await getRecurring(ctx)).series.find((s) => s.key === patreon.key)).toMatchObject({ name: "Podcasts", ruleExact: false });
    // Undo: remove the new rule and put the one-amount name back.
    await deleteNameRule(ctx, every.ruleId);
    await restoreNameRule(ctx, { key: every.undo.key, amount: -800, name: "Podcast club" });
    expect((await getRecurring(ctx)).series.find((s) => s.key === patreon.key)?.name).toBe("Podcast club");
    expect(exact.ruleId).toBeTruthy();
    for (const r of (await getNames(ctx)).rules) await deleteNameRule(ctx, r.id);
  });

  it("renames a bill without losing what you told Passbook about it", async () => {
    const patreon = (await getRecurring(ctx)).series.find((s) => s.bankName.startsWith("PATREON"))!;
    await setRecurringOverride(ctx, patreon.key, { kind: "bill" });
    const { ruleId } = await createNameRule(ctx, { transactionId: patreon.sampleId, name: "Podcast" });
    const renamed = (await getRecurring(ctx)).series.find((s) => s.key === patreon.key)!;
    expect(renamed).toMatchObject({ name: "Podcast", kind: "bill", ruleId, bankName: patreon.bankName });
    expect((await getRecurring(ctx)).upcoming.find((u) => u.key === patreon.key)?.name).toBe("Podcast");
    await deleteNameRule(ctx, ruleId);
    await setRecurringOverride(ctx, patreon.key, { kind: "subscription" });
  });

  it("lists bank code that could be clearer, with a guess, and moves it to your names once kept", async () => {
    let names = await getNames(ctx);
    const clipper = names.unclear.find((u) => u.bankName.startsWith("CLIPPER"))!;
    expect(clipper).toMatchObject({ suggestion: "Clipper Service" });
    expect(names.unclear.find((u) => u.bankName.startsWith("STEAMGAMES"))?.suggestion).toBe("Steam");
    expect(names.unclear.some((u) => u.bankName === "Netflix")).toBe(false);

    const { ruleId, undo } = await createNameRule(ctx, { transactionId: clipper.sampleId, name: clipper.suggestion });
    names = await getNames(ctx);
    expect(names.unclear.some((u) => u.key === clipper.key)).toBe(false);
    expect(names.rules.find((r) => r.id === ruleId)).toMatchObject({ name: "Clipper Service", amount: 0, count: clipper.count });

    // Removing and putting back (Undo) restores the same name.
    const { rule } = await deleteNameRule(ctx, ruleId);
    const { ruleId: back } = await restoreNameRule(ctx, rule);
    expect((await getNames(ctx)).rules.find((r) => r.id === back)?.name).toBe("Clipper Service");
    await renameRule(ctx, back, "Muni");
    expect((await getNames(ctx)).rules.find((r) => r.id === back)?.name).toBe("Muni");
    expect(undo.previousName).toBeNull();
    await deleteNameRule(ctx, back);
  });

  it("refuses names that are empty or too long, and never reaches another person's charges or names", async () => {
    const { transactions } = await getTransactions(ctx, { ...all, q: "Tartine" });
    await expect(createNameRule(ctx, { transactionId: transactions[0].id, name: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(createNameRule(ctx, { transactionId: transactions[0].id, name: "y".repeat(61) })).rejects.toMatchObject({ status: 400 });
    await expect(restoreNameRule(ctx, { key: "DROP TABLE", amount: 0, name: "x" })).rejects.toMatchObject({ status: 400 });
    // A one-amount rule can't point the other way from its key.
    await expect(restoreNameRule(ctx, { key: "out:tartine bakery", amount: 500, name: "x" })).rejects.toMatchObject({ status: 400 });

    const { ruleId } = await createNameRule(ctx, { transactionId: transactions[0].id, name: "Tartine" });
    const stranger: Ctx = { ...ctx, userId: "someone-else", user: { id: "someone-else", name: "Pat", email: "pat@example.com" }, demo: false };
    await expect(createNameRule(stranger, { transactionId: transactions[0].id, name: "Mine now" })).rejects.toMatchObject({ status: 404 });
    await expect(previewNameRule(stranger, transactions[0].id, false)).rejects.toMatchObject({ status: 404 });
    await expect(renameRule(stranger, ruleId, "Mine now")).rejects.toMatchObject({ status: 404 });
    await expect(deleteNameRule(stranger, ruleId)).rejects.toMatchObject({ status: 404 });
    expect((await getNames(stranger)).rules).toEqual([]);
    expect((await previewNameRule(ctx, transactions[0].id, false)).count).toBe(transactions.length);
    await deleteNameRule(ctx, ruleId);
  });
});

describe("changes Nickel and Claude make when asked", () => {
  it("adds a repeating bill that shows in Bills, what's coming up and the month plan, and Undo takes it away", async () => {
    const before = await getOverview(ctx);
    const done = await addBill(ctx, "nickel", { name: "Gym", amount: 4_500, frequency: "monthly", date: "2026-11-28" });
    expect(done.summary).toBe("Added a bill: Gym, $45.00 every month, next on Nov 28.");
    const r = await getRecurring(ctx);
    const gym = r.series.find((s) => s.name === "Gym")!;
    expect(gym).toMatchObject({ kind: "bill", amount: -4_500, frequency: "monthly", nextDate: "2026-11-28", active: true, manual: { addedBy: "nickel" } });
    expect(r.upcoming.find((u) => u.name === "Gym")?.date).toBe("2026-11-28");
    const after = await getOverview(ctx);
    expect(after.plan.billsExpected).toBe(before.plan.billsExpected + 4_500);
    expect(after.plan.leftToSpend).toBe(before.plan.leftToSpend - 4_500);

    const [item] = await listActivity(ctx);
    expect(item).toMatchObject({ id: done.activityId, actor: "nickel", canUndo: true, undone: false });
    await undoActivity(ctx, done.activityId);
    expect((await getRecurring(ctx)).series.some((s) => s.name === "Gym")).toBe(false);
    expect((await listActivity(ctx))[0]).toMatchObject({ undone: true, canUndo: false });
    await expect(undoActivity(ctx, done.activityId)).rejects.toMatchObject({ status: 409 });
  });

  it("adds a one-off bill that is due once and then drops off", async () => {
    const done = await addBill(ctx, "claude", { name: "Car registration", amount: 18_000, frequency: "once", date: "2026-12-12" });
    expect(done.summary).toBe("Added an upcoming bill: Car registration, $180.00 due Dec 12.");
    const r = await getRecurring(ctx);
    expect(r.upcoming.filter((u) => u.name === "Car registration").map((u) => u.date)).toEqual(["2026-12-12"]);
    // After its date it no longer counts as coming up.
    const later = await getRecurring({ ...ctx, today: "2026-12-20" });
    expect(later.series.find((s) => s.name === "Car registration")?.active).toBe(false);
    expect(later.upcoming.some((u) => u.name === "Car registration")).toBe(false);
    await undoActivity(ctx, done.activityId);
  });

  it("a one-off marked as an Extra is still a bill: it's set aside from what's left to spend until its date", async () => {
    const before = await getOverview(ctx);
    const done = await addBill(ctx, "claude", { name: "Concert tickets", amount: 20_000, frequency: "once", date: "2026-11-27", kind: "subscription" });
    expect((await getRecurring(ctx)).series.find((s) => s.name === "Concert tickets")?.kind).toBe("bill");
    expect((await getOverview(ctx)).plan.leftToSpend).toBe(before.plan.leftToSpend - 20_000);
    await undoActivity(ctx, done.activityId);
  });

  it("an Extra added by hand is a reminder: nothing is set aside for it until the charge comes through", async () => {
    const before = await getOverview(ctx);
    const done = await addBill(ctx, "nickel", { name: "Music app", amount: 1_099, frequency: "monthly", date: "2026-11-28", kind: "subscription" });
    expect(done.summary).toBe("Added an Extra: Music app, $10.99 every month, next on Nov 28.");
    const r = await getRecurring(ctx);
    expect(r.series.find((s) => s.name === "Music app")).toMatchObject({ kind: "subscription", active: true });
    const after = await getOverview(ctx);
    expect(after.plan.billsExpected).toBe(before.plan.billsExpected);
    expect(after.plan.leftToSpend).toBe(before.plan.leftToSpend);
    await undoActivity(ctx, done.activityId);
  });

  it("works out a repeating bill's next date from when it started", () => {
    expect(nextDue({ frequency: "monthly", startDate: "2026-01-31" }, "2026-11-21")).toBe("2026-11-30");
    expect(nextDue({ frequency: "weekly", startDate: "2024-01-05" }, "2026-11-21")).toBe("2026-11-27");
    expect(nextDue({ frequency: "yearly", startDate: "2025-03-03" }, "2026-11-21")).toBe("2027-03-03");
    expect(nextDue({ frequency: "once", startDate: "2026-10-01" }, "2026-11-21")).toBe("2026-10-01");
  });

  it("adds and changes goals, puts money toward them, and each Undo puts things back", async () => {
    const goal = await addGoal(ctx, "claude", { name: "New roof", target: 1_200_000, targetDate: "2028-06-30" });
    const id = new URLSearchParams(goal.href.split("?")[1]).get("id")!;
    expect((await getGoals(ctx)).goals.find((g) => g.id === id)).toMatchObject({ name: "New roof", target: 1_200_000, targetDate: "2028-06-30" });

    const changed = await changeGoal(ctx, "claude", id, { target: 1_500_000, monthlyContribution: 30_000 });
    expect(changed.summary).toBe("Changed the goal New roof: target $15,000.00, $300.00 a month.");
    await undoActivity(ctx, changed.activityId);
    expect((await getGoals(ctx)).goals.find((g) => g.id === id)).toMatchObject({ target: 1_200_000, monthlyContribution: 0 });

    const deposit = await addToGoal(ctx, "nickel", id, 25_000);
    expect((await getGoals(ctx)).goals.find((g) => g.id === id)?.saved).toBe(25_000);
    // With money in it, undoing the goal itself is refused rather than losing track of that money.
    await expect(undoActivity(ctx, goal.activityId)).rejects.toMatchObject({ status: 409 });
    await undoActivity(ctx, deposit.activityId);
    expect((await getGoals(ctx)).goals.find((g) => g.id === id)?.saved).toBe(0);
    await undoActivity(ctx, goal.activityId);
    expect((await getGoals(ctx)).goals.some((g) => g.id === id)).toBe(false);
  });

  it("finds goals and loans by name, and asks when it's not clear", async () => {
    expect((await findGoal(ctx, "emergency")).name).toBe("Emergency fund");
    expect((await findGoal(ctx, "japan")).name).toBe("Two weeks in Japan");
    await expect(findGoal(ctx, "boat")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("No goal called “boat”") });
    expect((await findDebt(ctx, "student loan")).name).toBe("Student Loan");
    await expect(findDebt(ctx, "loan")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("More than one") });
  });

  it("changes a loan's rate and payment, and Undo puts the old ones back", async () => {
    const loan = await findDebt(ctx, "student loan");
    const before = (await getDebt(ctx)).debts.find((d) => d.id === loan.id)!;
    const done = await changeLoan(ctx, "nickel", loan.id, { aprPercent: 3.9, monthlyPayment: 30_000 });
    expect(done.summary).toBe("Changed Student Loan: interest 3.9%, payment $300.00 a month.");
    expect((await getDebt(ctx)).debts.find((d) => d.id === loan.id)).toMatchObject({ aprPercent: 3.9, payment: 30_000 });
    await undoActivity(ctx, done.activityId);
    expect((await getDebt(ctx)).debts.find((d) => d.id === loan.id)).toMatchObject({ aprPercent: before.aprPercent, payment: before.payment });
    await expect(changeLoan(ctx, "nickel", loan.id, { aprPercent: 120 })).rejects.toMatchObject({ status: 400 });
  });

  it("renames charges by what they're called, and Undo puts the names back", async () => {
    const charge = await findCharge(ctx, "clipper service");
    const done = await renameCharges(ctx, "claude", charge.id, "Muni");
    expect(done.summary).toMatch(/^Renamed \d+ charges to Muni\. New ones will be too\.$/);
    expect((await getTransactions(ctx, { limit: 5, offset: 0, q: "Muni" })).transactions[0]?.name).toBe("Muni");
    await undoActivity(ctx, done.activityId);
    expect((await getTransactions(ctx, { limit: 5, offset: 0, q: "Clipper" })).transactions[0]?.name).toBe("Clipper Service");
  });

  it("keeps a bill on the 31st on the 31st, and counts every few months from the first date", () => {
    expect(nextDue({ frequency: "monthly", startDate: "2026-12-31" }, "2027-03-01")).toBe("2027-03-31");
    expect(nextDue({ frequency: "quarterly", startDate: "2025-11-30" }, "2026-11-21")).toBe("2026-11-30");
    const series = manualSeries({ id: "m", userId: "u", name: "Phone", amount: -8000, frequency: "monthly", startDate: "2026-12-31", kind: "bill", category: "utilities", cancelled: false, addedBy: "you", createdAt: new Date() }, "2027-01-15");
    expect(upcomingBetween(series, "2027-01-15", "2027-04-30")).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });

  it("counts an added bill as paid when the bank shows it paid early, and stands aside once the bank finds it", async () => {
    const before = await getOverview(ctx);
    const gym = await addBill(ctx, "nickel", { name: "Pilates Studio", amount: 6_000, frequency: "monthly", date: "2026-11-25" });
    expect((await getOverview(ctx)).plan.billsExpected).toBe(before.plan.billsExpected + 6_000);
    // Paid four days early: it counts as a bill paid (not everyday spending), once, and moves on to December.
    await db.insert(transactionsTable).values({ id: "pilates-paid", userId: DEMO_USER_ID, accountId: "demo-card", date: "2026-11-19", name: "PILATES STUDIO", rawName: "PILATES STUDIO", amount: -6_000, category: "health" });
    const after = await getOverview(ctx);
    expect(after.plan.billsExpected).toBe(before.plan.billsExpected + 6_000);
    expect(after.plan.everydaySpent).toBe(before.plan.everydaySpent);
    const series = (await getRecurring(ctx)).series.find((s) => s.name === "Pilates Studio")!;
    expect(series).toMatchObject({ nextDate: "2026-12-25", manual: { paidOn: "2026-11-19", seenAtBank: null } });
    await db.delete(transactionsTable).where(eqOp(transactionsTable.id, "pilates-paid"));
    await undoActivity(ctx, gym.activityId);

    // Netflix is already found in the history, so a hand-added copy doesn't count twice.
    const copy = await addBill(ctx, "claude", { name: "Netflix", amount: 1_799, frequency: "monthly", date: "2026-12-09" });
    const dupe = (await getRecurring(ctx)).series.find((s) => s.manual && s.name === "Netflix")!;
    expect(dupe).toMatchObject({ active: false, manual: { seenAtBank: "Netflix" } });
    expect((await getOverview(ctx)).plan.billsExpected).toBe(before.plan.billsExpected);
    await undoActivity(ctx, copy.activityId);
  });

  it("doesn't match an added bill to a different place or to last week's payment", () => {
    const rent = { name: "Rent", amount: -215_000, frequency: "monthly", startDate: "2026-12-01" };
    const runway = { name: "Rent the Runway", bankName: "RENT THE RUNWAY", active: true, kind: "subscription", amount: -9_400, frequency: "monthly" };
    expect(bankMatch(rent, "2026-11-22", [], [runway]).seenAs).toBeNull();
    expect(bankMatch({ ...rent, name: "Apple Card", amount: -50_000 }, "2026-11-22", [], [{ ...runway, name: "Apple", bankName: "APPLE.COM/BILL", amount: -299 }]).seenAs).toBeNull();
    expect(bankMatch({ ...rent, name: "Netflix", amount: -1_799 }, "2026-11-22", [], [{ ...runway, name: "Netflix", bankName: "Netflix", amount: -1_799 }]).seenAs).toBe("Netflix");
    // A weekly bill on Fridays paid last Friday: this Friday's is still to come.
    const weekly = { name: "Cleaner", amount: -8_000, frequency: "weekly", startDate: "2026-10-02" };
    const charges = [{ id: "c1", date: "2026-11-20", amount: -8_000, names: ["CLEANER"] }];
    expect(bankMatch(weekly, "2026-11-22", charges, []).paid).toBeNull();
    expect(bankMatch(weekly, "2026-11-25", [{ ...charges[0], date: "2026-11-25" }], []).paid?.id).toBe("c1");
  });

  it("when asked to rename by the bank's text, leaves the owner's one-amount names alone", async () => {
    const patreon = (await getRecurring(ctx)).series.find((s) => s.bankName.startsWith("PATREON"))!;
    const exact = await createNameRule(ctx, { transactionId: patreon.sampleId, name: "Podcast club", onlyThisAmount: true });
    await db.insert(transactionsTable).values({ id: "patreon-other2", userId: DEMO_USER_ID, accountId: "demo-card", date: today, name: "PATREON* MEMBERSHIP 4155550123 CA", rawName: null, amount: -2_500, category: "entertainment" });
    const charge = await findCharge(ctx, "patreon membership");
    expect(charge.exact).toBe(false);
    const done = await renameCharges(ctx, "claude", charge.id, "Patreon tips", charge.exact);
    const list = (await getTransactions(ctx, { limit: 50, offset: 0, q: "PATREON" })).transactions;
    expect(list.find((t) => t.id === "patreon-other2")?.name).toBe("Patreon tips");
    expect(list.filter((t) => t.amount === -800).every((t) => t.name === "Podcast club")).toBe(true);
    await undoActivity(ctx, done.activityId);
    await deleteNameRule(ctx, exact.ruleId);
    await db.delete(transactionsTable).where(eqOp(transactionsTable.id, "patreon-other2"));
  });

  it("undoes only what Nickel or Claude changed, leaving later edits alone", async () => {
    const goal = await findGoal(ctx, "japan");
    const changed = await changeGoal(ctx, "claude", goal.id, { target: 500_000 });
    await updateGoal(ctx, goal.id, { targetDate: "2028-01-31" }); // the owner, afterwards
    await undoActivity(ctx, changed.activityId);
    expect((await getGoals(ctx)).goals.find((g) => g.id === goal.id)).toMatchObject({ target: goal.target, targetDate: "2028-01-31" });
    await updateGoal(ctx, goal.id, { targetDate: goal.targetDate });
    // Changed again since: nothing to put back, and it says so.
    const again = await changeGoal(ctx, "claude", goal.id, { target: 600_000 });
    await updateGoal(ctx, goal.id, { target: 700_000 });
    await expect(undoActivity(ctx, again.activityId)).rejects.toMatchObject({ status: 409 });
    await updateGoal(ctx, goal.id, { target: goal.target });

    const loan = await findDebt(ctx, "auto loan");
    const rate = await changeLoan(ctx, "nickel", loan.id, { aprPercent: 2.5 });
    await setDebtPlan(ctx, loan.id, { monthlyPayment: 40_000 }); // the owner, afterwards
    await undoActivity(ctx, rate.activityId);
    const plan = (await getDebt(ctx)).debts.find((d) => d.id === loan.id)!;
    expect(plan.payment).toBe(40_000);
    expect(plan.aprPercent).not.toBe(2.5);
    await setDebtPlan(ctx, loan.id, { monthlyPayment: null });
  });

  it("renames a charge named for one amount at that amount only, never every charge from the place", async () => {
    const patreon = (await getRecurring(ctx)).series.find((s) => s.bankName.startsWith("PATREON"))!;
    const exact = await createNameRule(ctx, { transactionId: patreon.sampleId, name: "Podcast club", onlyThisAmount: true });
    await db.insert(transactionsTable).values({ id: "patreon-other", userId: DEMO_USER_ID, accountId: "demo-card", date: today, name: "PATREON* MEMBERSHIP 4155550123 CA", rawName: null, amount: -2_500, category: "entertainment" });
    const charge = await findCharge(ctx, "Podcast club");
    expect(charge.exact).toBe(true);
    const done = await renameCharges(ctx, "claude", charge.id, "Podcasts", charge.exact);
    const names = await getNames(ctx);
    expect(names.rules.filter((r) => r.key.includes("patreon")).map((r) => [r.name, r.amount])).toEqual([["Podcasts", -800]]);
    expect((await getTransactions(ctx, { limit: 50, offset: 0, q: "PATREON" })).transactions.find((t) => t.id === "patreon-other")?.name).toBe("Patreon");
    await undoActivity(ctx, done.activityId);
    expect((await getNames(ctx)).rules.find((r) => r.id === exact.ruleId)?.name).toBe("Podcast club");
    await deleteNameRule(ctx, exact.ruleId);
    await db.delete(transactionsTable).where(eqOp(transactionsTable.id, "patreon-other"));
  });

  it("never trims a change that can still be undone out of the list", async () => {
    const { activityLog } = await import("@/db/schema");
    const rows = Array.from({ length: 1005 }, (_, i) => ({ id: `bulk-${i}`, userId: DEMO_USER_ID, actor: "claude", summary: "x", undo: { type: "bill.remove", billId: "none" }, createdAt: new Date(Date.now() - i * 1000) }));
    for (let i = 0; i < rows.length; i += 250) await db.insert(activityLog).values(rows.slice(i, i + 250));
    const done = await addBill(ctx, "claude", { name: "Trim test", amount: 100, frequency: "once", date: "2026-12-01" });
    const left = await db.select({ id: activityLog.id }).from(activityLog).where(eqOp(activityLog.userId, DEMO_USER_ID));
    expect(left.filter((r) => r.id.startsWith("bulk-"))).toHaveLength(1005);
    await undoActivity(ctx, done.activityId);
    await db.delete(activityLog).where(eqOp(activityLog.actor, "claude"));
  });

  it("checks bills before saving them", async () => {
    await expect(createManualBill(ctx, { name: "Rent", amount: 0, frequency: "monthly", startDate: "2026-12-01" }, "you")).rejects.toMatchObject({ status: 400 });
    await expect(createManualBill(ctx, { name: " ", amount: 100, frequency: "monthly", startDate: "2026-12-01" }, "you")).rejects.toMatchObject({ status: 400 });
    await expect(createManualBill(ctx, { name: "Rent", amount: 100, frequency: "daily" as never, startDate: "2026-12-01" }, "you")).rejects.toMatchObject({ status: 400 });
    await expect(createManualBill(ctx, { name: "Rent", amount: 100, frequency: "monthly", startDate: "2046-12-01" }, "you")).rejects.toMatchObject({ status: 400 });
    const bill = await createManualBill(ctx, { name: "Water", amount: 6_000, frequency: "quarterly", startDate: "2026-12-15", kind: "bill", category: "utilities" }, "you");
    const { before } = await updateManualBill(ctx, bill.id, { amount: 6_500, cancelled: true });
    expect(before.amount).toBe(-6_000);
    expect((await getRecurring(ctx)).series.find((s) => s.manual?.id === bill.id)).toMatchObject({ amount: -6_500, cancelled: true, active: false });
    const removed = await deleteManualBill(ctx, bill.id);
    await restoreManualBill(ctx, removed);
    expect((await getRecurring(ctx)).series.some((s) => s.manual?.id === bill.id)).toBe(true);
    await deleteManualBill(ctx, bill.id);
  });

  it("never reaches someone else's goals, loans, bills or activity", async () => {
    const stranger: Ctx = { ...ctx, userId: "someone-else", user: { id: "someone-else", name: "Pat", email: "pat@example.com" }, demo: false };
    const done = await addBill(ctx, "nickel", { name: "Cable", amount: 9_000, frequency: "monthly", date: "2026-12-02" });
    await expect(undoActivity(stranger, done.activityId)).rejects.toMatchObject({ status: 404 });
    expect(await listActivity(stranger)).toEqual([]);
    const goal = await findGoal(ctx, "emergency");
    await expect(addToGoal(stranger, "claude", goal.id, 100)).rejects.toMatchObject({ status: 404 });
    await expect(changeGoal(stranger, "claude", goal.id, { target: 100_00 })).rejects.toMatchObject({ status: 404 });
    const loan = await findDebt(ctx, "auto loan");
    await expect(changeLoan(stranger, "claude", loan.id, { aprPercent: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(findGoal(stranger, goal.id)).rejects.toMatchObject({ status: 400 });
    const bill = (await getRecurring(ctx)).series.find((s) => s.name === "Cable")!;
    await expect(deleteManualBill(stranger, bill.manual!.id)).rejects.toMatchObject({ status: 404 });
    await undoActivity(ctx, done.activityId);
  });
});

describe("asking Nickel", () => {
  it("answers everyday questions and purchase questions from the household's numbers", async () => {
    const left = await askNickel(ctx, "what's left to spend?");
    expect(left?.text).toMatch(/free to spend this month|^You’re over by/);
    const due = await askNickel(ctx, "what bills are coming up this month?");
    expect(due?.text).toMatch(/due the rest of this month|Nothing due/);
    const rent = await askNickel(ctx, "when is rent due?");
    expect(rent?.text).toMatch(/^Parkview Apartments \(\$2,150\) is next due/);
    const shop = await askNickel(ctx, "how much did I spend at Safeway this month?");
    expect(shop?.text).toMatch(/^(You’ve spent \$[\d,.]+ at Safeway this month, across \d+ charges?\.|Nothing at “safeway” this month\.)$/);
    const verdict = await askNickel(ctx, "can I afford a $25,000 car?");
    expect(verdict?.verdict).toMatchObject({ amount: 2_500_000, item: "car", verdict: "no" });
    const pushed = await askNickel(ctx, "but I really want it", verdict!.verdict!);
    expect(pushed?.verdict?.verdict).toBe("no");
    expect(await askNickel(ctx, "what's the weather like")).toBeNull();
  });
});

describe("Apple Card, brought in from its statements", () => {
  // Made-up purchases in the columns of Apple Card's "Export Transactions" spreadsheet.
  const statement = [
    "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By",
    "11/03/2026,11/04/2026,BLUE BOTTLE COFFEE OAKLAND CA,Blue Bottle Coffee,Restaurants,Purchase,6.50,Sam Sample",
    "11/03/2026,11/04/2026,BLUE BOTTLE COFFEE OAKLAND CA,Blue Bottle Coffee,Restaurants,Purchase,6.50,Sam Sample",
    "11/05/2026,11/06/2026,GREEN GROCER 44,Green Grocer,Grocery,Purchase,84.12,Sam Sample",
    "11/10/2026,11/10/2026,ACH DEPOSIT INTERNET TRANSFER,Ach Deposit Internet Transfer,Payment,Payment,-500.00,Sam Sample",
    "11/12/2026,11/12/2026,PIXEL TOYS 9,Pixel Toys,Shopping,Purchase,40.00,Sam Sample",
    "11/18/2026,,CORNER SHOP,Corner Shop,Shopping,Purchase,3.00,Sam Sample",
  ].join("\n");
  // The owner with real data: in the sample household a made-up statement is used instead (tested below).
  const real = (): Ctx => ({ ...ctx, demo: false });
  const wins = () => db.select({ ref: playerWinsTable.ref }).from(playerWinsTable).where(and(eqOp(playerWinsTable.userId, DEMO_USER_ID), eqOp(playerWinsTable.kind, "import")));

  it("brings a statement in as a card account: cleared purchases only, sorted, with what's owed", async () => {
    const spentBefore = (await getBudget(real(), "2026-11")).totalSpent;
    const preview = await previewAppleCard(real(), statement);
    // The purchase that hasn't cleared waits for the next statement; with no balance to start from, the person types it.
    expect(preview).toMatchObject({ from: "2026-11-03", to: "2026-11-12", total: 5, fresh: 5, already: 0, pending: 1, owedNow: null, suggestedOwed: null, sample: false });

    const done = await importAppleCard(real(), statement, 61_234);
    expect(done).toMatchObject({ added: 5, skipped: 0, from: "2026-11-03", to: "2026-11-12", previousOwed: null, owed: 61_234, earned: true });
    const accounts = await getAccounts(real());
    expect(accounts.appleCard).toMatchObject({ accountId: done.accountId, owed: 61_234, transactions: 5, lastDate: "2026-11-12" });
    // It's a card, not something tracked by hand.
    expect(accounts.manual.map((a) => a.name)).not.toContain("Apple Card");
    const { transactions: rows } = await getTransactions(real(), { accountId: done.accountId, limit: 100, offset: 0 });
    expect(rows.map((t) => [t.name, t.amount, t.category]).sort()).toEqual(
      [
        ["Ach Deposit Internet Transfer", 50_000, "transfer"],
        ["Blue Bottle Coffee", -650, "dining"],
        ["Blue Bottle Coffee", -650, "dining"],
        ["Green Grocer", -8_412, "groceries"],
        ["Pixel Toys", -4_000, "shopping"],
      ].sort(),
    );
    // Its purchases count in the month's everyday spending; paying the card off doesn't.
    expect((await getBudget(real(), "2026-11")).totalSpent).toBe(spentBefore + 650 + 650 + 8_412 + 4_000);
    // And what it owes counts as a debt in net worth.
    expect((await getNetWorth(real(), "6m")).accounts.find((a) => a.id === done.accountId)?.balance).toBe(-61_234);
    expect((await wins()).map((w) => w.ref)).toEqual([`${done.accountId}:2026-11-12`]);
  });

  it("brings the same month in twice without doubling anything; its Undo leaves the first import's XP alone", async () => {
    expect(await previewAppleCard(real(), statement)).toMatchObject({ fresh: 0, already: 5, owedNow: 61_234, suggestedOwed: 61_234 });
    const again = await importAppleCard(real(), statement, 60_000);
    expect(again).toMatchObject({ added: 0, skipped: 5, previousOwed: 61_234, earned: false });
    expect((await getAccounts(real())).appleCard).toMatchObject({ owed: 60_000, transactions: 5 });
    await undoAppleCardImport(real(), again);
    expect((await getAccounts(real())).appleCard).toMatchObject({ owed: 61_234, transactions: 5 });
    expect(await wins()).toHaveLength(1);
  });

  it("sorts a merchant the way the person always sorts it, and Undo takes out exactly one import", async () => {
    const card = (await getAccounts(real())).appleCard!;
    await db.insert(categoryRulesTable).values({ id: "rule-apple-test", userId: DEMO_USER_ID, merchantKey: "corner bakery", category: "groceries" });
    const next = statement.split("\n")[0] + "\n12/02/2026,12/03/2026,CORNER BAKERY 12,Corner Bakery,Restaurants,Purchase,9.25,Sam Sample";
    // The last balance plus the new charge.
    expect((await previewAppleCard(real(), next)).suggestedOwed).toBe(62_159);
    const done = await importAppleCard(real(), next, 62_159);
    expect(done).toMatchObject({ added: 1, earned: true });
    const bakery = (await getTransactions(real(), { accountId: card.accountId, limit: 100, offset: 0 })).transactions.find((t) => t.name === "Corner Bakery");
    expect(bakery?.category).toBe("groceries");

    await undoAppleCardImport(real(), done);
    expect((await getAccounts(real())).appleCard).toMatchObject({ owed: 61_234, transactions: 5, lastDate: "2026-11-12" });
    expect(await wins()).toHaveLength(1);
    await db.delete(categoryRulesTable).where(eqOp(categoryRulesTable.id, "rule-apple-test"));
  });

  it("a stale Undo leaves a balance that has changed since alone", async () => {
    const next = statement.split("\n")[0] + "\n12/04/2026,12/05/2026,PIXEL TOYS 9,Pixel Toys,Shopping,Purchase,5.00,Sam Sample";
    const done = await importAppleCard(real(), next, 61_734);
    // Changed by hand afterwards, on the Net worth screen.
    await importAppleCard(real(), next, 70_000);
    await undoAppleCardImport(real(), done);
    expect((await getAccounts(real())).appleCard).toMatchObject({ owed: 70_000, transactions: 5 });
  });

  it("uses a made-up statement in the sample household, so nobody's real purchases land in it", async () => {
    const preview = await previewAppleCard(ctx, statement);
    expect(preview).toMatchObject({ sample: true, total: 8, from: "2026-10-02", to: "2026-10-24" });
  });

  it("says plainly when a file isn't an Apple Card statement, and never touches anyone else's card", async () => {
    await expect(previewAppleCard(real(), "name,amount\nCoffee,3")).rejects.toMatchObject({ status: 400 });
    const stranger: Ctx = { ...ctx, userId: "someone-else", user: { id: "someone-else", name: "Pat", email: "pat@example.com" }, demo: false };
    expect(await previewAppleCard(stranger, statement)).toMatchObject({ fresh: 5, owedNow: null });
    const card = (await getAccounts(real())).appleCard!;
    const rows = await db.select({ createdAt: transactionsTable.createdAt }).from(transactionsTable).where(eqOp(transactionsTable.accountId, card.accountId)).limit(1);
    await undoAppleCardImport(stranger, { batch: rows[0].createdAt.toISOString(), to: "2026-11-12", previousOwed: null, owed: 0, earned: true });
    expect((await getAccounts(real())).appleCard).toMatchObject({ transactions: 5 });
  });

  it("Undo of the first statement takes Apple Card away again", async () => {
    const card = (await getAccounts(real())).appleCard!;
    const rows = await db.select({ createdAt: transactionsTable.createdAt }).from(transactionsTable).where(eqOp(transactionsTable.accountId, card.accountId)).limit(1);
    await undoAppleCardImport(real(), { batch: rows[0].createdAt.toISOString(), to: "2026-11-12", previousOwed: null, owed: card.owed, earned: true });
    expect((await getAccounts(real())).appleCard).toBeNull();
    expect(await wins()).toHaveLength(0);
  });
});

describe("Apple Card taps, sent by an iPhone Shortcuts automation", () => {
  const real = (today = "2026-11-19"): Ctx => ({ ...ctx, today, demo: false });
  const cardRows = async () => {
    const card = (await getAccounts(real())).appleCard;
    return card ? (await getTransactions(real(), { accountId: card.accountId, limit: 100, offset: 0 })).transactions : [];
  };

  it("records a tap at once as a pending purchase, sorted, and the card owes more", async () => {
    expect((await getAccounts(real())).appleCard).toBeNull();
    expect(await recordTap(real(), { amount: "$6.50", merchant: "Blue Bottle Coffee" })).toEqual({ recorded: true });
    expect((await getAccounts(real())).appleCard).toMatchObject({ owed: 650, pendingTaps: 1, transactions: 0 });
    const [tap] = await cardRows();
    expect(tap).toMatchObject({ name: "Blue Bottle Coffee", amount: -650, category: "dining", pending: true, date: "2026-11-19" });
    // The same tap sent twice (Shortcuts sometimes repeats) is one purchase; a tap with no amount waits for the statement.
    expect(await recordTap(real(), { amount: 6.5, merchant: "Blue Bottle Coffee" })).toMatchObject({ recorded: false });
    expect(await recordTap(real(), { amount: 0, merchant: "Blue Bottle Coffee" })).toMatchObject({ recorded: false });
    expect(await cardRows()).toHaveLength(1);
    // Two taps arriving at the same moment both count toward what's owed.
    const owedBefore = (await getAccounts(real())).appleCard!.owed;
    await Promise.all([recordTap(real(), { amount: "1.00", merchant: "Kiosk A" }), recordTap(real(), { amount: "2.00", merchant: "Kiosk B" })]);
    expect((await getAccounts(real())).appleCard!.owed).toBe(owedBefore + 300);
    const extra = (await cardRows()).filter((t) => t.name.startsWith("Kiosk"));
    await db.delete(transactionsTable).where(inArrayOp(transactionsTable.id, extra.map((t) => t.id)));
    await db.update(accountsTable).set({ balance: -owedBefore }).where(and(eqOp(accountsTable.userId, DEMO_USER_ID), eqOp(accountsTable.name, "Apple Card")));
  });

  it("a statement confirms its taps, keeps a category the person picked, and drops taps that never went through; Undo puts them all back", async () => {
    await db.insert(categoryRulesTable).values({ id: "rule-tap-test", userId: DEMO_USER_ID, merchantKey: "corner bakery", category: "groceries" });
    await recordTap(real(), { amount: "9.25", merchant: "Corner Bakery" });
    // A restaurant tap: the tip makes the statement's amount different.
    await recordTap(real("2026-11-05"), { amount: "20.00", merchant: "Sushi Spot" });
    const blue = (await cardRows()).find((t) => t.name === "Blue Bottle Coffee")!;
    await db.update(transactionsTable).set({ category: "entertainment", categoryLocked: true }).where(eqOp(transactionsTable.id, blue.id));

    const statement = [
      "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By",
      "11/19/2026,11/20/2026,BLUE BOTTLE COFFEE,Blue Bottle Coffee,Restaurants,Purchase,6.50,Sam",
      "11/19/2026,11/20/2026,CORNER BAKERY 12,Corner Bakery,Restaurants,Purchase,9.25,Sam",
      "11/05/2026,11/06/2026,SUSHI SPOT,Sushi Spot,Restaurants,Purchase,24.00,Sam",
      "11/12/2026,11/13/2026,GREEN GROCER 44,Green Grocer,Grocery,Purchase,30.00,Sam",
    ].join("\n");
    const preview = await previewAppleCard(real("2026-11-22"), statement);
    // Only taps so far, no statement: what's owed is just the taps, so it asks for Wallet's balance.
    expect(preview).toMatchObject({ fresh: 4, confirmedTaps: 2, droppedTaps: 1, owedNow: 3_575, suggestedOwed: null });

    const done = await importAppleCard(real("2026-11-22"), statement, 6_975);
    expect(done).toMatchObject({ added: 2, skipped: 0, earned: true });
    expect(done.confirmed).toHaveLength(2);
    expect(done.removed.map((t) => [t.name, t.amount])).toEqual([["Sushi Spot", -2_000]]);
    const after = await cardRows();
    expect(after.map((t) => [t.name, t.amount, t.category, t.pending]).sort()).toEqual(
      [
        ["Blue Bottle Coffee", -650, "entertainment", false],
        ["Corner Bakery", -925, "groceries", false],
        ["Green Grocer", -3_000, "groceries", false],
        ["Sushi Spot", -2_400, "dining", false],
      ].sort(),
    );
    expect((await getAccounts(real())).appleCard).toMatchObject({ owed: 6_975, pendingTaps: 0, transactions: 4 });

    await undoAppleCardImport(real("2026-11-22"), done);
    const back = await cardRows();
    expect(back.map((t) => [t.name, t.amount, t.pending]).sort()).toEqual(
      [
        ["Blue Bottle Coffee", -650, true],
        ["Corner Bakery", -925, true],
        ["Sushi Spot", -2_000, true],
      ].sort(),
    );
    expect((await getAccounts(real())).appleCard).toMatchObject({ owed: 3_575, pendingTaps: 3 });
    await db.delete(categoryRulesTable).where(eqOp(categoryRulesTable.id, "rule-tap-test"));
  });

  it("the tap link: only its hash is kept, it finds its owner, nobody else's, and switching it off stops it", async () => {
    // The sample household has no link anyone could write to.
    expect(await contextForTapKey("sample-household-key-that-is-long-enough")).toBeNull();
    process.env.DEMO_MODE = "0";
    try {
      const key = await createTapKey(real());
      expect(await tapStatus(real())).toMatchObject({ on: true });
      const [stored] = await db.select().from(tapKeysTable).where(eqOp(tapKeysTable.userId, DEMO_USER_ID));
      expect(stored.tokenHash).not.toContain(key);
      expect((await contextForTapKey(key))?.userId).toBe(DEMO_USER_ID);
      expect(await contextForTapKey(key.slice(0, -1) + (key.endsWith("a") ? "b" : "a"))).toBeNull();

      // The address the automation calls: it adds a tap and says nothing about the account.
      const call = (k: string, body: unknown) => tapRoute(new Request(`http://localhost/api/tap/${k}`, { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": "203.0.113.9" } }), { params: Promise.resolve({ key: k }) });
      const ok = await call(key, { Amount: "$4.75", Merchant: "Corner Shop" });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ recorded: true });
      expect((await cardRows()).some((t) => t.name === "Corner Shop" && t.pending)).toBe(true);
      expect((await call("not-a-real-key-not-a-real-key-123", { amount: 1, merchant: "X" })).status).toBe(404);

      await revokeTapKey(real());
      expect(await contextForTapKey(key)).toBeNull();
      expect((await call(key, { amount: 1, merchant: "X" })).status).toBe(404);

      // Signing out everywhere switches a tap link off too, like the Claude link.
      const again = await createTapKey(real());
      await signOutEverywhere(real());
      expect(await contextForTapKey(again)).toBeNull();
    } finally {
      delete process.env.DEMO_MODE;
    }
    // Tidy up: Apple Card and its taps go.
    await deleteManualAccount(real(), (await getAccounts(real())).appleCard!.accountId);
  });
});
