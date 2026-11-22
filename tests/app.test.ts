import { beforeAll, describe, expect, it } from "vitest";
import { getDb, type DB } from "@/db";
import { seedDemo } from "@/db/seed";
import { DEMO_USER_ID } from "@/lib/config";
import type { Ctx } from "@/server/auth";
import { deleteDeposit, setBudget, setDebtPlan, setDebtSettings, setRecurringOverride, updateGoal, updateTransaction } from "@/server/mutations";
import { loadRules } from "@/server/rules";
import { countUnclear, createNameRule, deleteNameRule, getNames, previewNameRule, renameRule, restoreNameRule } from "@/server/names";
import { transactions as transactionsTable } from "@/db/schema";
import { eq as eqOp } from "drizzle-orm";
import { addBill, addGoal, addToGoal, changeGoal, changeLoan, findCharge, findDebt, findGoal, listActivity, renameCharges, undoActivity } from "@/server/actions";
import { bankMatch, createManualBill, deleteManualBill, manualSeries, nextDue, restoreManualBill, updateManualBill } from "@/server/manual-bills";
import { upcomingBetween } from "@/lib/finance/recurring";
import { askNickel } from "@/server/nickel";
import { getAccounts, getBudget, getDebt, getGoal, getGoals, getInvestments, getNetWorth, getOverview, getRecap, getRecurring, getTransactions } from "@/server/queries";

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
    expect(attention.find((a) => a.kind === "price")).toMatchObject({ title: "Netflix raised its price", href: "/bills" });
    expect(attention.find((a) => a.kind === "due")?.title).toMatch(/is due (today|tomorrow|in 2 days)$/);
    expect(attention.find((a) => a.kind === "budget")).toMatchObject({ title: "Groceries is over its limit", href: "/budget" });
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
    expect((await getBudget(ctx, "2026-11")).rows.find((r) => r.category === "travel")).toBeUndefined();

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
    expect(left?.text).toMatch(/left this month|past what’s left/);
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
