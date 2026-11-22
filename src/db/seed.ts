import { eq } from "drizzle-orm";
import { DEMO_USER_ID } from "@/lib/config";
import { addDays, addMonths, dayOfMonth, daysInMonth, diffDays, monthEnd, monthOf, monthStart, weekday, type ISODate } from "@/lib/dates";
import type { DB } from "./index";
import { accounts, balanceSnapshots, budgets, goalDeposits, goals, holdings, items, playerWins, transactions, users } from "./schema";

/**
 * Sample household for demo mode: about 13 months of believable history
 * ending today. Deterministic for a given date, so reloads look the same.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Merchant = { name: string; category: string; min: number; max: number };

export const EVERYDAY: { perDay: number; weekendBoost?: number; merchants: Merchant[] }[] = [
  {
    perDay: 0.3,
    merchants: [
      { name: "Trader Joe’s", category: "groceries", min: 28, max: 96 },
      { name: "Safeway", category: "groceries", min: 18, max: 112 },
      { name: "Whole Foods Market", category: "groceries", min: 22, max: 88 },
      { name: "Costco", category: "groceries", min: 94, max: 236 },
    ],
  },
  {
    perDay: 0.5,
    weekendBoost: 1.5,
    merchants: [
      { name: "Blue Bottle Coffee", category: "dining", min: 4.5, max: 9.75 },
      { name: "Chipotle", category: "dining", min: 11, max: 16.5 },
      { name: "Sweetgreen", category: "dining", min: 13, max: 18 },
      { name: "SQ *TARTINE BAKERY 0423 SAN FRANCISCO CA", category: "dining", min: 7, max: 24 },
      { name: "DoorDash", category: "dining", min: 19, max: 47 },
      { name: "Nopa", category: "dining", min: 42, max: 118 },
      { name: "Starbucks", category: "dining", min: 4.25, max: 8.5 },
    ],
  },
  {
    perDay: 0.11,
    merchants: [
      { name: "Shell", category: "transport", min: 38, max: 61 },
      { name: "Chevron", category: "transport", min: 36, max: 64 },
    ],
  },
  { perDay: 0.18, merchants: [{ name: "CLIPPER SERVICE 877-878-8883 CA", category: "transport", min: 2.9, max: 7.4 }] },
  { perDay: 0.07, merchants: [{ name: "Uber", category: "transport", min: 9, max: 34 }] },
  {
    perDay: 0.12,
    merchants: [
      { name: "Amazon", category: "shopping", min: 9, max: 94 },
      { name: "Target", category: "shopping", min: 14, max: 86 },
      { name: "Uniqlo", category: "shopping", min: 24, max: 119 },
      { name: "REI", category: "shopping", min: 28, max: 164 },
    ],
  },
  {
    perDay: 0.06,
    weekendBoost: 2,
    merchants: [
      { name: "AMC Theatres", category: "entertainment", min: 14, max: 34 },
      { name: "STEAMGAMES.COM 4259522985 WA", category: "entertainment", min: 9.99, max: 59.99 },
      { name: "The Fillmore", category: "entertainment", min: 38, max: 96 },
    ],
  },
  {
    perDay: 0.035,
    merchants: [
      { name: "CVS Pharmacy", category: "health", min: 7, max: 46 },
      { name: "One Medical", category: "health", min: 30, max: 30 },
    ],
  },
  { perDay: 0.03, merchants: [{ name: "Fellow Barber", category: "personal", min: 38, max: 62 }] },
];

type NewTx = typeof transactions.$inferInsert;
type AccountSeed = { id: string; item: string | null; name: string; institution: string; mask: string | null; type: string; subtype: string; start: number };

const cents = (dollars: number) => Math.round(dollars * 100);

export async function seedDemo(db: DB, today: ISODate, now: Date = new Date()): Promise<void> {
  const rand = mulberry32(20260119);
  const between = (min: number, max: number) => min + rand() * (max - min);
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];

  await db.delete(users).where(eq(users.id, DEMO_USER_ID));
  await db.insert(users).values({ id: DEMO_USER_ID, email: "demo@passbook.local", name: "Sam" });

  const itemRows = [
    { id: "demo-item-bank", institutionName: "Northwind Bank" },
    { id: "demo-item-card", institutionName: "Meridian Card" },
    { id: "demo-item-invest", institutionName: "Fernway Invest" },
    { id: "demo-item-401k", institutionName: "Larch Retirement" },
    { id: "demo-item-loans", institutionName: "Cedar Lending" },
  ];
  await db.insert(items).values(itemRows.map((i) => ({ ...i, userId: DEMO_USER_ID, lastSyncedAt: now })));

  const A: Record<string, AccountSeed> = {
    checking: { id: "demo-checking", item: "demo-item-bank", name: "Everyday Checking", institution: "Northwind Bank", mask: "4821", type: "depository", subtype: "checking", start: cents(3180) },
    savings: { id: "demo-savings", item: "demo-item-bank", name: "High-Yield Savings", institution: "Northwind Bank", mask: "7730", type: "depository", subtype: "savings", start: cents(8500) },
    card: { id: "demo-card", item: "demo-item-card", name: "Cashback Visa", institution: "Meridian Card", mask: "1109", type: "credit", subtype: "credit card", start: cents(-640) },
    brokerage: { id: "demo-brokerage", item: "demo-item-invest", name: "Individual Brokerage", institution: "Fernway Invest", mask: "5562", type: "investment", subtype: "brokerage", start: cents(21400) },
    roth: { id: "demo-roth", item: "demo-item-invest", name: "Roth IRA", institution: "Fernway Invest", mask: "9034", type: "investment", subtype: "roth", start: cents(14800) },
    k401: { id: "demo-401k", item: "demo-item-401k", name: "Halden Studio 401(k)", institution: "Larch Retirement", mask: "2207", type: "investment", subtype: "401k", start: cents(38500) },
    auto: { id: "demo-auto-loan", item: "demo-item-loans", name: "Auto Loan", institution: "Cedar Lending", mask: "3317", type: "loan", subtype: "auto", start: cents(-17900) },
    student: { id: "demo-student-loan", item: "demo-item-loans", name: "Student Loan", institution: "Cedar Lending", mask: "6648", type: "loan", subtype: "student", start: cents(-22400) },
    car: { id: "demo-car", item: null, name: "2021 Subaru Outback", institution: "Tracked by hand", mask: null, type: "property", subtype: "vehicle", start: cents(21000) },
  };

  const balance: Record<string, number> = Object.fromEntries(Object.values(A).map((a) => [a.id, a.start]));
  const txs: NewTx[] = [];
  const snapshots: (typeof balanceSnapshots.$inferInsert)[] = [];
  let n = 0;

  const post = (account: AccountSeed, date: ISODate, name: string, amount: number, category: string, opts: { pending?: boolean; createdAt?: Date } = {}) => {
    balance[account.id] += amount;
    // Spread arrival times through the day so the feed has a stable order.
    const createdAt = opts.createdAt ?? new Date(Date.parse(`${date}T12:00:00Z`) + Math.floor(rand() * 10 * 3600_000));
    txs.push({
      id: `demo-tx-${++n}`,
      userId: DEMO_USER_ID,
      accountId: account.id,
      date,
      name,
      rawName: name.toUpperCase(),
      amount,
      category,
      pending: opts.pending ?? false,
      createdAt,
    });
  };
  const move = (from: AccountSeed, to: AccountSeed, date: ISODate, amount: number, fromName: string, toName: string) => {
    post(from, date, fromName, -amount, "transfer");
    post(to, date, toName, amount, "transfer");
  };

  const start = monthStart(monthOf(addMonths(today, -13)));
  const monthIndex = (date: ISODate) => (Number(date.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(today.slice(5, 7));
  // Paydays are every other Friday, anchored so one landed within the last two weeks.
  let payAnchor = today;
  while (weekday(payAnchor) !== 5) payAnchor = addDays(payAnchor, -1);
  if (diffDays(today, payAnchor) < 3) payAnchor = addDays(payAnchor, -14);
  const isPayday = (date: ISODate) => weekday(date) === 5 && Math.abs(diffDays(date, payAnchor)) % 14 === 0;

  const primeDay = addDays(start, 9);
  // A once-a-year charge whose next renewal is 18 days away, to show the renewal warning.
  const dropboxDay = addDays(today, 18 - 365);
  post(A.card, addDays(dropboxDay, -365), "Dropbox", cents(-119.88), "other");
  // A first charge from a streaming service nine days ago: a new sign-up, or a free trial that ended.
  const disneyDay = addDays(today, -9);
  let sideIncomeDay = 14;
  let statement = 0;

  for (let date = start; date <= today; date = addDays(date, 1)) {
    const dom = dayOfMonth(date);
    const mi = monthIndex(date);
    const [y, m] = date.split("-").map(Number);
    const isToday = date === today;
    const isLastDay = dom === daysInMonth(y, m);
    const weekend = weekday(date) === 0 || weekday(date) === 6;
    if (dom === 1) sideIncomeDay = 10 + Math.floor(rand() * 15);

    // Income
    if (isPayday(date)) {
      post(A.checking, date, "Halden Studio Payroll", mi >= -6 ? cents(2846.32) : cents(2712.5), "income");
      balance[A.k401.id] += cents(430);
    }
    if (dom === sideIncomeDay && rand() < 0.7) post(A.checking, date, "Stripe Payout", cents(between(240, 880)), "income");
    if (isLastDay) post(A.savings, date, "Interest Paid", Math.round((balance[A.savings.id] * 0.0425) / 12), "income");

    // Bills from checking
    if (dom === 1) post(A.checking, date, "Parkview Apartments", cents(-2150), "housing");
    if (dom === 5) {
      post(A.checking, date, "Cedar Lending Auto Loan", cents(-318.4), "loans");
      balance[A.auto.id] += cents(318.4) + Math.round(balance[A.auto.id] * (0.059 / 12));
    }
    if (dom === 8) post(A.checking, date, "Fiberline Internet", cents(-65), "utilities");
    if (dom === 12) {
      const seasonal = 1 + 0.3 * Math.cos(((m - 1) / 12) * 2 * Math.PI);
      post(A.checking, date, "City Light & Power", -cents(between(62, 84) * seasonal), "utilities");
    }
    if (dom === 15) post(A.checking, date, "Mint Mobile", cents(-45), "utilities");
    if (dom === 18) {
      post(A.checking, date, "Cedar Lending Student Loan", cents(-240), "loans");
      balance[A.student.id] += cents(240) + Math.round(balance[A.student.id] * (0.045 / 12));
    }
    if (dom === 23) post(A.checking, date, "Geico", cents(-132.5), "insurance");

    // Moving money between own accounts
    if (dom === 2 || dom === 16) move(A.checking, A.savings, date, cents(400), "Transfer to Savings", "Transfer from Checking");
    if (dom === 20) {
      move(A.checking, A.brokerage, date, cents(400), "Fernway Invest Deposit", "Deposit from Northwind");
      statement = -balance[A.card.id];
    }
    if (dom === 26 && statement > 0) move(A.checking, A.card, date, statement, "Meridian Card Payment", "Payment Received");

    // Subscriptions on the card
    if (dom === 3) post(A.card, date, "Anytime Fitness", cents(-38), "health");
    if (dom === 6 && mi <= -4) post(A.card, date, "Hulu", cents(-9.99), "entertainment");
    if (dom === 9) post(A.card, date, "Netflix", mi >= -1 ? cents(-17.99) : cents(-15.49), "entertainment");
    if (dom === 14) post(A.card, date, "Apple iCloud+", cents(-2.99), "other");
    // Banks don't always send a merchant's name, just their own code for it.
    if (dom === 11) post(A.card, date, "PATREON* MEMBERSHIP 4155550123 CA", cents(-8), "entertainment");
    if (dom === 21) post(A.card, date, "Adobe Creative Cloud", cents(-22.99), "other");
    if (dom === 27) post(A.card, date, "Spotify", cents(-11.99), "entertainment");
    if (diffDays(date, start) % 28 === 20) post(A.card, date, "The New York Times", cents(-17), "entertainment");
    if (date === primeDay || date === addDays(primeDay, 365)) post(A.card, date, "Amazon Prime", cents(-139), "shopping");
    if (date === dropboxDay) post(A.card, date, "Dropbox", cents(-119.88), "other");
    if (date === disneyDay) post(A.card, date, "Disney+", cents(-13.99), "entertainment");

    // One-off larger purchases that make the year look lived in
    if (mi === -9 && dom === 11) post(A.card, date, "Alaska Airlines", cents(-384.2), "travel");
    if (mi === -9 && dom === 24) post(A.card, date, "Hotel Zephyr", cents(-512.66), "travel");
    if (mi === -7 && dom === 17) post(A.card, date, "Midas Auto Service", cents(-642.18), "transport");
    if (mi === -4 && dom === 7) post(A.card, date, "Apple Store", cents(-1299), "shopping");
    if (mi === -3 && dom === 13) post(A.card, date, "Delta Air Lines", cents(-296.4), "travel");
    if (mi === -3 && dom === 28) post(A.card, date, "Airbnb", cents(-438), "travel");
    if (mi === -2 && dom === 19) post(A.card, date, "Bright Smile Dental", cents(-220), "health");
    if (mi === -5 && dom === 22) post(A.card, date, "Uniqlo", cents(64.9), "shopping"); // a refund

    // Everyday spending. Today’s purchases arrive at realistic times before now.
    for (const group of EVERYDAY) {
      const p = group.perDay * (weekend ? (group.weekendBoost ?? 1) : 1);
      if (rand() >= p) continue;
      const merchant = pick(group.merchants);
      const amount = -cents(between(merchant.min, merchant.max));
      const recent = diffDays(today, date) <= 1;
      const createdAt = isToday ? new Date(now.getTime() - Math.floor(between(20, 600)) * 60_000) : undefined;
      post(A.card, date, merchant.name, amount, merchant.category, { pending: recent, createdAt });
    }
    if (rand() < 0.012) post(A.checking, date, "ATM Fee", cents(-3.5), "fees");

    // Markets drift up with daily noise; the car loses value.
    for (const inv of [A.brokerage, A.roth, A.k401]) {
      if (weekday(date) !== 0 && weekday(date) !== 6) balance[inv.id] = Math.round(balance[inv.id] * (1 + 0.00042 + (rand() - 0.5) * 0.018));
    }
    if (dom === 1) balance[A.car.id] -= cents(155);

    for (const a of Object.values(A)) snapshots.push({ userId: DEMO_USER_ID, accountId: a.id, date, balance: balance[a.id] });
  }

  await db.insert(accounts).values(
    Object.values(A).map((a) => ({
      id: a.id,
      userId: DEMO_USER_ID,
      itemId: a.item,
      name: a.name,
      institutionName: a.institution,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      balance: balance[a.id],
      available: a.type === "depository" ? balance[a.id] : null,
      creditLimit: a.type === "credit" ? cents(12000) : null,
      nextPaymentDueDate: a.type === "credit" ? nextOn(today, 26) : null,
      minimumPayment: a.type === "credit" ? cents(35) : null,
      aprPercent: a.type === "credit" ? 22.49 : a.id === A.auto.id ? 5.9 : a.id === A.student.id ? 4.5 : null,
    })),
  );

  for (let i = 0; i < txs.length; i += 400) await db.insert(transactions).values(txs.slice(i, i + 400));
  for (let i = 0; i < snapshots.length; i += 800) await db.insert(balanceSnapshots).values(snapshots.slice(i, i + 800));

  const allocations: Record<string, { symbol: string; name: string; assetClass: string; weight: number; price: number; gain: number }[]> = {
    [A.brokerage.id]: [
      { symbol: "VTI", name: "Vanguard Total Stock Market ETF", assetClass: "us_stocks", weight: 0.46, price: 312.4, gain: 0.31 },
      { symbol: "VXUS", name: "Vanguard Total International Stock ETF", assetClass: "intl_stocks", weight: 0.2, price: 71.85, gain: 0.12 },
      { symbol: "AAPL", name: "Apple Inc.", assetClass: "us_stocks", weight: 0.12, price: 243.1, gain: 0.44 },
      { symbol: "MSFT", name: "Microsoft Corporation", assetClass: "us_stocks", weight: 0.1, price: 468.25, gain: 0.27 },
      { symbol: "BND", name: "Vanguard Total Bond Market ETF", assetClass: "bonds", weight: 0.08, price: 73.6, gain: -0.03 },
      { symbol: "CASH", name: "Cash sweep", assetClass: "cash", weight: 0.04, price: 1, gain: 0 },
    ],
    [A.roth.id]: [
      { symbol: "VTI", name: "Vanguard Total Stock Market ETF", assetClass: "us_stocks", weight: 0.6, price: 312.4, gain: 0.36 },
      { symbol: "VXUS", name: "Vanguard Total International Stock ETF", assetClass: "intl_stocks", weight: 0.25, price: 71.85, gain: 0.09 },
      { symbol: "BND", name: "Vanguard Total Bond Market ETF", assetClass: "bonds", weight: 0.15, price: 73.6, gain: -0.02 },
    ],
    [A.k401.id]: [
      { symbol: "LRTDX", name: "Larch Target Retirement 2055", assetClass: "us_stocks", weight: 0.58, price: 54.12, gain: 0.22 },
      { symbol: "LRINX", name: "Larch International Index", assetClass: "intl_stocks", weight: 0.27, price: 31.7, gain: 0.1 },
      { symbol: "LRBDX", name: "Larch Bond Index", assetClass: "bonds", weight: 0.15, price: 10.84, gain: 0.01 },
    ],
  };
  const holdingRows: (typeof holdings.$inferInsert)[] = [];
  for (const [accountId, list] of Object.entries(allocations)) {
    let remaining = balance[accountId];
    list.forEach((h, i) => {
      const value = i === list.length - 1 ? remaining : Math.round(balance[accountId] * h.weight);
      remaining -= value;
      holdingRows.push({
        id: `demo-holding-${accountId}-${h.symbol}`,
        userId: DEMO_USER_ID,
        accountId,
        symbol: h.symbol,
        name: h.name,
        assetClass: h.assetClass,
        quantity: value / cents(h.price),
        price: cents(h.price),
        value,
        costBasis: Math.round(value / (1 + h.gain)),
      });
    });
  }
  await db.insert(holdings).values(holdingRows);

  await db.insert(budgets).values(
    Object.entries({ groceries: 650, dining: 280, transport: 240, shopping: 250, entertainment: 110, health: 90, personal: 60 }).map(([category, limit]) => ({
      id: `demo-budget-${category}`,
      userId: DEMO_USER_ID,
      category,
      monthlyLimit: cents(limit),
    })),
  );

  // Three goals that show the three ways a goal can be going: open-ended, on track, and behind.
  // Each was started some months ago and has had money put in on the 7th since, so its track has a history.
  const goalSpecs = [
    { id: "demo-goal-emergency", name: "Emergency fund", target: 15000, monthly: 400, months: 12, targetDate: null },
    { id: "demo-goal-home", name: "Down payment", target: 40000, monthly: 150, months: 10, targetDate: monthEnd(monthOf(addMonths(today, 36))) },
    { id: "demo-goal-japan", name: "Two weeks in Japan", target: 4500, monthly: 250, months: 6, targetDate: monthEnd(monthOf(addMonths(today, 9))) },
  ];
  const savedNow = { "demo-goal-emergency": 9200, "demo-goal-home": 6400, "demo-goal-japan": 2150 } as Record<string, number>;
  await db.insert(goals).values(
    goalSpecs.map((g) => ({
      id: g.id,
      userId: DEMO_USER_ID,
      name: g.name,
      target: cents(g.target),
      saved: cents(savedNow[g.id]),
      monthlyContribution: cents(g.monthly),
      targetDate: g.targetDate,
      createdAt: new Date(`${addMonths(today, -g.months)}T15:00:00Z`),
    })),
  );
  const depositRows: (typeof goalDeposits.$inferInsert)[] = [];
  for (const g of goalSpecs) {
    for (let m = g.months - 1; m >= 0; m--) {
      const date = `${monthOf(addMonths(today, -m))}-07`;
      if (date > today || date <= addMonths(today, -g.months)) continue;
      depositRows.push({ id: `demo-deposit-${g.id}-${date}`, userId: DEMO_USER_ID, goalId: g.id, amount: cents(g.monthly), date });
    }
  }
  await db.insert(goalDeposits).values(depositRows);

  // A week of playing already: level 3, a six-day check-in streak (today's visit makes it seven) and a few badges.
  const won: (typeof playerWins.$inferInsert)[] = [];
  const XP = { checkin: 5, sort: 5, rename: 10, bill: 15, goal: 25, save: 20, milestone: 40, budget: 15, nospend: 15 } as const;
  const add = (kind: keyof typeof XP, ref: string, label: string | null, daysAgo: number) =>
    won.push({ id: `demo-win-${won.length + 1}`, userId: DEMO_USER_ID, kind, xp: XP[kind], label, ref, day: addDays(today, -daysAgo), createdAt: new Date(now.getTime() - daysAgo * 86_400_000 - (40 - won.length) * 60_000) });
  for (let d = 6; d >= 1; d--) add("checkin", addDays(today, -d), null, d);
  for (const g of goalSpecs) add("goal", g.id, g.name, 6);
  add("milestone", "demo-goal-emergency:25", "Emergency fund: 25%", 6);
  add("milestone", "demo-goal-emergency:50", "Emergency fund: 50%", 6);
  add("milestone", "demo-goal-japan:25", "Two weeks in Japan: 25%", 5);
  for (const c of ["groceries", "dining", "shopping"]) add("budget", `${c}:${monthOf(today)}`, { groceries: "Groceries", dining: "Restaurants & coffee", shopping: "Shopping" }[c] ?? c, 5);
  depositRows.slice(-6).forEach((dep, i) => add("save", dep.id, goalSpecs.find((g) => g.id === dep.goalId)?.name ?? null, 4 - (i % 3)));
  ["Blue Bottle", "Trader Joe’s", "Shell", "Target", "Chipotle", "Amazon", "Whole Foods", "Lyft", "Sweetgreen", "Costco", "Uber Eats", "CVS"].forEach((name, i) => add("sort", `demo-sort-${i}`, name, 1 + (i % 4)));
  ["Gym membership", "Water bill", "Phone plan", "Car wash club"].forEach((name, i) => add("rename", `demo-rename-${i}`, name, 2 + (i % 2)));
  add("bill", "demo-bill-1", "Gym membership", 3);
  add("bill", "demo-bill-2", "Water bill", 2);
  add("nospend", addDays(today, -4), null, 4);
  add("nospend", addDays(today, -2), null, 2);
  await db.insert(playerWins).values(won);
}

/** The next date (today or later) that falls on the given day of the month. */
function nextOn(today: ISODate, day: number): ISODate {
  const thisMonth = `${today.slice(0, 7)}-${String(day).padStart(2, "0")}`;
  return thisMonth >= today ? thisMonth : addMonths(thisMonth, 1);
}
