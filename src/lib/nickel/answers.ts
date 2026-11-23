import { diffDays, formatShort, monthEnd, monthOf, type ISODate } from "../dates";

/*
 * Answering everyday questions said or typed to Nickel ("what's left to
 * spend?", "when's rent due?", "how much did I spend on dining?", "how's the
 * Japan goal?") from the person's own numbers, with plain rules: no AI
 * service, nothing sent anywhere. Pure, so it's tested.
 *
 * Like the rest of Nickel, it says what the numbers are and never what to do.
 */

export type Snapshot = {
  today: ISODate;
  firstName: string;
  leftToSpend: number;
  perDay: number;
  daysLeft: number;
  incomeReceived: number;
  incomeExpected: number;
  /** Bills and subscriptions that repeat (or were added by hand), with when each is next due. */
  bills: { name: string; nextDate: ISODate; amount: number; active: boolean; category: string }[];
  /** This month's everyday spending by category, its budget (with anything carried over), and bills paid from it. */
  spending: { category: string; label: string; spent: number; limit: number | null; lastMonth?: number; bills?: number; status?: string }[];
  goals: { id: string; name: string; saved: number; target: number; status: string; perMonth: number | null; targetDate: ISODate | null; projectedDate: ISODate | null }[];
  netWorth: number;
  netWorthChange: number;
  latest: { name: string; amount: number; date: ISODate } | null;
  /** Money in checking (what bills come out of), or null when there's no checking account to go by. */
  cash: number | null;
  savings: number;
  nextPayday: ISODate | null;
  priciestDebt: { name: string; apr: number } | null;
  /** Balances: money in checking and savings, and what's owed on cards and loans (as a positive number). */
  accounts?: { name: string; kind: "checking" | "savings" | "card" | "loan"; balance: number }[];
  /** Spending (bills included, transfers not): today, this week from Monday, and all of last week. */
  weeks?: { today: number; thisWeek: number; lastWeek: number };
  /** Extras: subscriptions you could live without, and what each costs a month. */
  extras?: { name: string; monthly: number }[];
};

export type Verdict = "yes" | "wait" | "no";
/** What Nickel last decided about a purchase, so he can hold his ground when pushed. */
export type LastVerdict = { amount: number; item: string; verdict: Verdict };

export type Answer = { text: string; href?: string; link?: string; verdict?: LastVerdict };

/** Asked about spending at a place rather than a category: the server looks that up. */
export type Lookup = { merchant: string };

/** A steady pick from a few ways of saying something. */
function pick<T>(options: T[], seed: string): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return options[Math.abs(h) % options.length];
}

const money = (cents: number) => {
  const abs = Math.abs(cents);
  return `$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: abs % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
};
const plain = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}'& ]/gu, " ").replace(/\s+/g, " ").trim();

/** Everyday words for each spending category. */
const CATEGORY_WORDS: Record<string, string[]> = {
  housing: ["rent", "home", "housing", "mortgage"],
  utilities: ["utilities", "utility", "electric", "electricity", "power", "internet", "phone", "water"],
  groceries: ["groceries", "grocery", "food shopping", "supermarket"],
  dining: ["dining", "restaurants", "restaurant", "eating out", "takeout", "take out", "coffee", "food", "lunch", "dinner"],
  transport: ["transport", "transportation", "gas", "fuel", "car", "uber", "lyft", "transit", "parking"],
  shopping: ["shopping", "clothes"],
  entertainment: ["entertainment", "fun", "movies", "streaming", "games"],
  health: ["health", "doctor", "pharmacy", "medical", "gym", "fitness"],
  personal: ["personal care", "haircut", "beauty"],
  travel: ["travel", "trips", "hotels", "flights", "vacation"],
  insurance: ["insurance"],
  loans: ["loans", "loan payments", "debt payments"],
  giving: ["gifts", "donations", "giving", "charity"],
  fees: ["fees", "interest"],
  other: ["everything else", "other"],
};

/** The known name (a bill, a goal) that the question mentions, if any: whole name first, then a telling word. */
function mentioned<T extends { name: string }>(q: string, items: T[]): T | null {
  const t = ` ${q} `;
  const whole = items.filter((i) => plain(i.name) && t.includes(` ${plain(i.name)} `)).sort((a, b) => b.name.length - a.name.length)[0];
  if (whole) return whole;
  const common = new Set(["fund", "goal", "bill", "payment", "loan", "card", "the", "and", "for", "two", "weeks", "account", "savings", "membership"]);
  return items.find((i) => plain(i.name).split(" ").some((w) => w.length >= 4 && !common.has(w) && t.includes(` ${w} `))) ?? null;
}

function goalLine(g: Snapshot["goals"][number]): string {
  const of = `${money(g.saved)} of ${money(g.target)}`;
  switch (g.status) {
    case "reached":
      return `“${g.name}” is fully funded: ${money(g.target)}! *tail helicopter*`;
    case "ahead":
      return `“${g.name}” is ahead of its track: ${of}.`;
    case "on_track":
      return `“${g.name}” is right on track: ${of}${g.perMonth ? `, about ${money(g.perMonth)} a month gets it there by ${formatShort(g.targetDate!)}` : ""}.`;
    case "behind":
      return `“${g.name}” is behind its track: ${of}.${g.perMonth && g.targetDate ? ` About ${money(g.perMonth)} a month from now gets it there by ${formatShort(g.targetDate)}.` : ""}`;
    case "overdue":
      return `“${g.name}” passed its date with ${money(g.target - g.saved)} to go.`;
    default:
      return `“${g.name}”: ${of} saved${g.projectedDate ? `, there around ${formatShort(g.projectedDate)} at the current pace` : ""}.`;
  }
}

/* ---------- straight answers about a purchase ---------- */

/**
 * A price in what was said, in cents: "$1,200", "1200 dollars", "1.2k", "25k", "2 tickets at $45 each".
 * A bare number ("a 65 inch TV", "iPhone 16") is never taken for a price, except as a follow-up
 * ("what about 300?") when `bare` is set.
 */
function amountIn(q: string, bare = false): number | null {
  const each = /\b(\d{1,2})\s+[a-z]+\s+(?:at|for)\s+\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:each|apiece|a piece)\b/i.exec(q);
  if (each) return Math.round(Number(each[1]) * Number(each[2].replace(/,/g, "")) * 100);
  const m =
    /\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s?(k)?\b/i.exec(q) ??
    /\b(\d[\d,]*(?:\.\d{1,2})?)\s?(k|grand|thousand)?\s*(?:dollars|bucks)\b/i.exec(q) ??
    /\b(\d[\d,]*(?:\.\d{1,2})?)(k|grand)\b/i.exec(q) ??
    (bare ? /\b(\d{2,}[\d,]*(?:\.\d{1,2})?)\b/.exec(q) : null);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n * 100) : null;
}

/** Investing: he doesn't give verdicts on stocks, funds or crypto. */
const INVESTING = /\b(stocks?|shares?|bitcoin|btc|crypto|ethereum|eth|etfs?|index funds?|mutual funds?|invest|investing|investment|options|nfts?|bonds?|gold|forex|day trad\w*)\b/;

const PURCHASE = /\b(can i afford|afford|should i (buy|get|spend|order|book|splurge)|is it (ok|okay|fine|smart|wise|a good idea) to (buy|spend|get|book)|thinking (of|about) (buying|getting|booking)|i want to (buy|get|book)|worth (buying|getting)|ok to spend|okay to spend|good idea to (buy|get|spend))\b/;
const PUSHBACK = /\b(but|please|come on|are you sure|really|just this once|i want it|i need it|on sale|i deserve|treat myself|it'?s fine|trust me|change your mind|reconsider|you'?re wrong|why not|pretty please|i promise|it'?s worth it|i'?ll be fine|let me|seriously)\b/;

const ITEM_STOP = new Set(["on", "for", "at", "in", "this", "next", "today", "tomorrow", "right", "now", "by", "before", "after", "with", "from", "if", "or", "and", "to", "each", "apiece", "off", "until", "when", "because"]);
const ITEM_SKIP = new Set(["a", "an", "the", "some", "this", "that", "those", "these", "my", "new", "it"]);

/** What's being bought: the few words after "buy" / "afford", without prices, dates or filler. */
function itemIn(q: string): string {
  const cleaned = q.replace(/\$\s?\d[\d,]*(?:\.\d{1,2})?\s?k?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:k|grand|thousand)?\s*(?:dollars|bucks)\b/gi, " ").replace(/\s+/g, " ");
  const m = /\b(?:afford|buy|get|order|book|spend on|buying|getting|booking|splurge on)\b\s*(.*)$/.exec(cleaned);
  const words: string[] = [];
  for (const w of (m?.[1] ?? "").split(" ").filter(Boolean)) {
    if (ITEM_STOP.has(w) && words.length > 0) break;
    // Prices and amounts aren't part of the name ("25 000 car" is a car).
    if (ITEM_SKIP.has(w) || ITEM_STOP.has(w) || /^\d[\d.]*k?$/.test(w) || /^(grand|thousand|dollars?|bucks)$/.test(w)) continue;
    words.push(w);
    if (words.length === 4) break;
  }
  return words.join(" ").slice(0, 40);
}

/**
 * Nickel's straight answer about spending `amount`, from the household's own
 * numbers: yes, not yet, or no, with the reason in numbers. He decides on the
 * numbers alone, so asking again or pleading doesn't change it; new numbers do.
 */
export function judgePurchase(amount: number, item: string, s: Snapshot): { verdict: Verdict; reason: string } {
  const what = item ? `the ${item}` : "that";
  const due = s.bills.filter((b) => b.active && b.nextDate >= s.today && b.nextDate <= (s.nextPayday ?? s.today.slice(0, 8) + "31")).reduce((sum, b) => sum + Math.abs(b.amount), 0);
  // Without a checking account to go by (cards only, or none linked) there's no cash test, only the month's plan.
  const cashAfter = s.cash === null ? Infinity : s.cash - amount - due;
  const after = s.leftToSpend - amount;
  const days = Math.max(1, s.daysLeft);
  if (cashAfter < 0) {
    return { verdict: "no", reason: `Paying for ${what} would leave checking ${money(cashAfter)} short of the ${money(due)} in bills and Extras due before ${s.nextPayday ? `payday on ${formatShort(s.nextPayday)}` : "the month ends"}. That puts the household’s bills at risk.` };
  }
  if (after < 0) {
    return { verdict: "no", reason: `${what[0].toUpperCase()}${what.slice(1)} would put this month ${money(after)} past what’s left after bills and goals${s.savings >= amount ? ", and paying from savings would set your goals back" : ""}.` };
  }
  const perDayAfter = Math.floor(after / days);
  const tight = Math.max(1_000, Math.round(s.perDay * 0.4));
  if (perDayAfter < tight) {
    return { verdict: "wait", reason: `${what[0].toUpperCase()}${what.slice(1)} would leave ${money(after)} for ${days} days, about ${money(perDayAfter)} a day.${s.nextPayday ? ` After payday on ${formatShort(s.nextPayday)} it’s an easier yes.` : ""}` };
  }
  const debt = s.priciestDebt && s.priciestDebt.apr >= 15 && amount >= 50_000 ? ` Just know ${s.priciestDebt.name} is charging ${s.priciestDebt.apr.toFixed(2)}% interest.` : "";
  return { verdict: "yes", reason: `You’d still have ${money(after)} left this month, about ${money(perDayAfter)} a day.${debt}` };
}

const OPENERS: Record<Verdict, string[]> = {
  yes: ["Yes, that fits.", "Paws up: that fits.", "Yes. Woof!"],
  wait: ["Not yet.", "Hold that thought: not yet.", "Not this month."],
  no: ["No.", "Paws down: no.", "That’s a no from me."],
};
const HOLDING: Record<Verdict, string[]> = {
  yes: ["Still a yes from me.", "Asking twice won’t make it scarier: still a yes."],
  wait: ["Still not yet. I’m not budging on this one.", "My answer stays “not yet”. The numbers haven’t moved."],
  no: ["Still no. I’m not budging, because the household comes first.", "I hear you, and I wish I could say yes. It’s still a no.", "No again. Pleading doesn’t change the numbers, and the numbers are what I go by."],
};

/**
 * What Nickel says back to a question, or a place to look up (spending at a
 * merchant), or null when he didn't understand. `last` is what he last
 * decided about a purchase in this conversation.
 */
export function answerQuestion(question: string, s: Snapshot, last?: LastVerdict | null): Answer | Lookup | null {
  const q = plain(question);
  if (!q) return null;

  const seed = `${q}:${s.today}`;
  // Investing: no verdicts on stocks, funds or crypto, ever.
  if (INVESTING.test(q) && (PURCHASE.test(q) || /\b(should i|is it|good idea|worth)\b/.test(q))) {
    return { text: `That’s investing, and I don’t pick investments: I’m a robot dog, not a financial advisor. What I can tell you: after bills and goals there’s ${money(s.leftToSpend)} left this month.`, href: "/investing", link: "See investing" };
  }
  // A purchase: a straight answer from the numbers, and he holds to it unless the numbers change.
  const followUp = last !== null && last !== undefined && /\b(what about|how about|and if|if it'?s|if it was|what if)\b/.test(q);
  if (PURCHASE.test(q) || followUp) {
    const amount = amountIn(question, followUp);
    if (amount === null && !followUp) return { text: "How much is it? Ask me like “can I afford a $300 jacket?”" };
    if (amount !== null) {
      const item = itemIn(q) || last?.item || "";
      const { verdict, reason } = judgePurchase(amount, item, s);
      const changed = last && last.verdict !== verdict ? `At ${money(amount)}, that changes things. ` : "";
      return { text: `${changed}${pick(OPENERS[verdict], seed)} ${reason}`, verdict: { amount, item, verdict }, href: "/", link: "See the month" };
    }
  }

  if (/^(hi|hey|hello|yo|howdy|hiya|good (morning|afternoon|evening))\b/.test(q) && q.split(" ").length <= 4) {
    return { text: `Hi${s.firstName ? ` ${s.firstName}` : ""}! *wag wag* Ask me what’s left to spend, what’s coming up, or tell me to add a bill.` };
  }
  if (/\b(good (boy|dog|bot|nickel)|thank(s| you)|love you|cute)\b/.test(q)) return { text: "*happy beeps* Anytime! Woof!" };
  if (/\b(who are you|what can you do|what do you do|help|how do you work)\b/.test(q)) {
    return { text: "I’m a robot dog who reads your numbers. Ask me what’s left to spend, what’s due, what you spent on something or at a store (this week, this month or last), how much you owe or have, whether you’re over budget, or “can I afford…?”. Or tell me to add a bill or a goal. I’m not a financial advisor, just a very good boy." };
  }

  // Net worth ("is Netflix worth it" isn't about net worth).
  if (/\bnet worth\b|\bwhat am i worth\b|\bhow much am i worth\b/.test(q)) {
    const change = s.netWorthChange === 0 ? "" : `, ${s.netWorthChange > 0 ? "up" : "down"} ${money(s.netWorthChange)} over the last 30 days`;
    return { text: `Your net worth is ${s.netWorth < 0 ? "−" : ""}${money(s.netWorth)}${change}.`, href: "/net-worth", link: "See net worth" };
  }

  // The latest charge.
  // ("What did I spend at Amazon" or "last month" is about spending, below.)
  const justNow = /\bwhat did i (just )?(buy|spend)\b/.test(q) && !/\b(at|on|for|in)\s+\w/.test(q.replace(/^.*?\b(buy|spend)\b/, "")) && !/\b(this|last) (month|week)\b|\btoday\b/.test(q);
  if (/\b(last|latest|recent|newest) (purchase|charge|transaction|payment|thing i bought)\b/.test(q) || justNow) {
    if (!s.latest) return { text: "Nothing’s come through yet." };
    return { text: `The latest is ${money(s.latest.amount)} ${s.latest.amount < 0 ? "at" : "from"} ${s.latest.name} on ${formatShort(s.latest.date)}.`, href: "/transactions", link: "See transactions" };
  }

  // What's owed on cards and loans ("when is the card due" is about bills, below).
  const cardsOnly = /\b(credit )?cards?\b/.test(q) && !/\bloans?\b/.test(q);
  const loansOnly = /\bloans?\b/.test(q) && !/\bcards?\b/.test(q);
  const owed = (s.accounts ?? []).filter((a) => (cardsOnly ? a.kind === "card" : loansOnly ? a.kind === "loan" : a.kind === "card" || a.kind === "loan") && a.balance > 0);
  if (/\b(owe|owing|debts?|in debt|credit cards?|card balances?|loan balances?|balance on|how much (is|do i have) on)\b/.test(q) && !/\b(due|minimum|when)\b/.test(q)) {
    const one = mentioned(q, owed);
    if (one) return { text: `${one.name} has ${money(one.balance)} on it.`, href: "/debt", link: "See debt payoff" };
    if (owed.length === 0) return { text: `You don’t owe anything on ${cardsOnly ? "a card" : "a card or loan"} that I can see. *proud wag*`, href: "/debt", link: "See debt payoff" };
    const total = owed.reduce((sum, a) => sum + a.balance, 0);
    const top = [...owed].sort((a, b) => b.balance - a.balance).slice(0, 3).map((a) => `${a.name} ${money(a.balance)}`);
    const what = cardsOnly ? (owed.length === 1 ? "1 card" : `${owed.length} cards`) : loansOnly ? (owed.length === 1 ? "1 loan" : `${owed.length} loans`) : owed.length === 1 ? "1 card or loan" : `${owed.length} cards and loans`;
    return { text: `You owe ${money(total)} across ${what}: ${top.join(", ")}${owed.length > 3 ? ", and more" : ""}.`, href: "/debt", link: "See debt payoff" };
  }

  // Money in the bank.
  const banked = (s.accounts ?? []).filter((a) => a.kind === "checking" || a.kind === "savings");
  if (/\b(how much (money|cash)|money (do|have) i (have|got)|cash (do|have) i (have|got)|in (my )?(checking|savings|bank|accounts?)|bank (balance|account)|account balances?|my balance|checking balance|savings balance)\b/.test(q)) {
    if (banked.length === 0) return { text: "I can’t see a checking or savings account yet.", href: "/accounts", link: "See accounts" };
    const checking = banked.filter((a) => a.kind === "checking").reduce((sum, a) => sum + a.balance, 0);
    const savings = banked.filter((a) => a.kind === "savings").reduce((sum, a) => sum + a.balance, 0);
    const one = /\bsavings\b/.test(q) && !/\bchecking\b/.test(q) ? "savings" : /\bchecking\b/.test(q) && !/\bsavings\b/.test(q) ? "checking" : null;
    if (one === "savings") return { text: `${money(savings)} in savings.`, href: "/accounts", link: "See accounts" };
    if (one === "checking") return { text: `${money(checking)} in checking.`, href: "/accounts", link: "See accounts" };
    return { text: `${checking < 0 ? "−" : ""}${money(checking)} in checking${savings ? ` and ${money(savings)} in savings` : ""}.`, href: "/accounts", link: "See accounts" };
  }

  // Where the money goes.
  if (/\b(where (is|does|did|has) (all )?(my|the) money (go|going|gone|went)|where'?s (all )?my money (going|gone)|biggest (expense|expenses|spending|category)|spend(ing)? (the )?most|most money (on|goes)|top (categories|spending|expenses))\b/.test(q)) {
    const rows = s.spending.map((r) => ({ label: r.label, total: Math.max(0, r.spent) + (r.bills ?? 0) })).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
    if (rows.length === 0) return { text: "Nothing’s been spent yet this month.", href: "/budget", link: "See budget" };
    return { text: `This month the most has gone to ${rows.slice(0, 3).map((r) => `${r.label} (${money(r.total)})`).join(", ")}.`, href: "/budget", link: "See budget" };
  }

  // Budgets: over, heading over, or fine.
  if (/\b(over (my |the )?budgets?|on budget|under budget|within (my |the )?budget|blown? (my |the )?budget|how'?s (my|the) budget|how is (my|the) budget|budgets? (doing|looking))\b/.test(q)) {
    const limited = s.spending.filter((r) => r.limit !== null);
    if (limited.length === 0) return { text: "You haven’t set any budgets yet. Spending, Budget has a one-tap suggestion.", href: "/budget", link: "See budget" };
    const over = limited.filter((r) => r.spent > (r.limit ?? 0));
    const heading = limited.filter((r) => r.status === "watch" && !over.includes(r)).map((r) => r.label);
    const going = heading.length ? `${heading.join(" and ")} ${heading.length === 1 ? "is" : "are"} on pace to go over.` : "";
    if (over.length) return { text: `${over.map((r) => `${r.label} is ${money(r.spent - (r.limit ?? 0))} over`).join(", ")}.${going ? ` ${going}` : ""}`, href: "/budget", link: "See budget" };
    if (going) return { text: `Nothing’s over yet, but ${going.charAt(0).toLowerCase()}${going.slice(1)}`, href: "/budget", link: "See budget" };
    return { text: `All ${limited.length} of your budgets are on track. *happy wag*`, href: "/budget", link: "See budget" };
  }

  // Saved so far.
  if (/\b(how much (have i|i'?ve|did i) (saved|save)|my savings|total saved|saved up)\b/.test(q)) {
    const inGoals = s.goals.reduce((sum, g) => sum + g.saved, 0);
    const goals = s.goals.length ? ` Your goals have ${money(inGoals)} put toward them.` : " No savings goals yet: tell me “new goal” to start one.";
    return { text: `${money(s.savings)} in savings accounts.${goals}`, href: "/savings", link: "See savings" };
  }

  // Payday.
  if (/\b(when'?s|when is|next) (my )?(payday|pay day|paycheck|pay check)\b|\bwhen do i (next )?get paid\b/.test(q)) {
    if (!s.nextPayday) return { text: "I can’t see a regular paycheck yet, so I don’t know when payday is." };
    const days = diffDays(s.nextPayday, s.today);
    return { text: `Next payday looks like ${days === 0 ? "today" : days === 1 ? "tomorrow" : `${formatShort(s.nextPayday)}, in ${days} days`}.`, href: "/", link: "See the month" };
  }

  // Money in.
  if (/\b(paycheck|pay check|salary|income|get paid|got paid|money in|how much (do|did) i (make|earn|bring in)|i earn(ed)?)\b/.test(q) && !/\bbefore\b/.test(q)) {
    return { text: `${money(s.incomeReceived)} has come in this month, of about ${money(s.incomeExpected)} expected.`, href: "/", link: "See the month" };
  }

  // Goals.
  const goal = mentioned(q, s.goals);
  if (goal || /\b(goals?|saving for|savings)\b/.test(q)) {
    if (goal) return { text: goalLine(goal), href: `/savings/goal?id=${encodeURIComponent(goal.id)}`, link: "See the track" };
    if (s.goals.length === 0) return { text: "No savings goals yet. Tell me “new goal” and a name to make one!" };
    const behind = s.goals.filter((g) => g.status === "behind").length;
    const good = s.goals.filter((g) => g.status === "on_track" || g.status === "ahead" || g.status === "reached").length;
    return { text: `${s.goals.length} goal${s.goals.length === 1 ? "" : "s"}: ${good} on track or ahead${behind ? `, ${behind} behind` : ""}. ${goalLine(s.goals[0])}`, href: "/savings", link: "See goals" };
  }

  // What's left to spend: the question asked most ("what's left to spend" is about the month, not past spending).
  const leftQ = /\b(left|how am i doing|how'?s (my|the|this) month|how is (my|the|this) month|afford|per day|a day|remaining)\b/.test(q) || /\bcan i (spend|buy)\b/.test(q);
  if (leftQ) {
    if (s.leftToSpend < 0) return { text: `This month is ${money(s.leftToSpend)} past what’s left after bills and goals, with ${s.daysLeft} days to go.`, href: "/", link: "See the month" };
    return { text: `After bills and goals there’s ${money(s.leftToSpend)} left this month: about ${money(s.perDay)} a day for ${s.daysLeft} days.`, href: "/", link: "See the month" };
  }

  // Spending in a category, or at a place.
  const spendQ = /\b(spen[dt]|spending|cost me|paid for|pay for)\b/.test(q);
  if (spendQ) {
    const cat = Object.entries(CATEGORY_WORDS).find(([, words]) => words.some((w) => ` ${q} `.includes(` ${w} `)));
    const row = cat ? s.spending.find((r) => r.category === cat[0]) : undefined;
    const lastMonth = /\blast month\b/.test(q);
    if (cat) {
      const label = row?.label ?? cat[0];
      if (lastMonth) return { text: `You spent ${money(row?.lastMonth ?? 0)} on ${label} last month.`, href: `/transactions?category=${cat[0]}`, link: "See them" };
      const spent = row?.spent ?? 0;
      const bills = row?.bills ?? 0;
      // A budget is for everyday spending; bills paid from the same category are said separately.
      const limit = row?.limit ? ` of your ${money(row.limit)} limit` : "";
      const plus = bills > 0 ? (row?.limit ? `, plus ${money(bills)} in bills` : "") : "";
      const shown = row?.limit ? spent : spent + bills;
      return { text: `You’ve spent ${money(shown)} on ${label} this month${limit}${plus}.`, href: `/transactions?category=${cat[0]}`, link: "See them" };
    }
    const place = /\b(?:at|on)\s+(.+?)(?:\s+(?:this|last)\s+(?:month|week|year)|\s+today)?$/.exec(q);
    if (place && place[1].length >= 2 && !/^(the )?(month|week|year|today|average|total)$/.test(place[1])) return { merchant: place[1] };
    if (lastMonth) {
      const before = s.spending.reduce((sum, r) => sum + (r.lastMonth ?? 0), 0);
      return { text: `You spent ${money(before)} last month, bills included, not counting transfers.`, href: "/budget", link: "See budget" };
    }
    const w = s.weeks;
    if (w && /\blast week\b/.test(q)) return { text: `You spent ${money(w.lastWeek)} last week, bills included.`, href: "/transactions", link: "See transactions" };
    if (w && /\b(this week|week so far)\b/.test(q)) return { text: `${money(w.thisWeek)} spent so far this week, bills included.`, href: "/transactions", link: "See transactions" };
    if (w && /\btoday\b/.test(q)) return { text: w.today > 0 ? `${money(w.today)} spent today.` : "Nothing spent today. *impressed tail wag*", href: "/transactions", link: "See transactions" };
    const total = s.spending.reduce((sum, r) => sum + r.spent + (r.bills ?? 0), 0);
    return { text: `${money(total)} spent so far this month, bills included, not counting transfers.`, href: "/budget", link: "See budget" };
  }

  // Extras: the subscriptions you could live without.
  if (/\b(subscriptions?|extras|streaming services?)\b/.test(q) && !/\b(due|coming up|upcoming|next|when)\b/.test(q) && s.extras) {
    if (s.extras.length === 0) return { text: "I don’t see any subscriptions repeating right now.", href: "/bills", link: "See bills" };
    const total = s.extras.reduce((sum, e) => sum + e.monthly, 0);
    const top = [...s.extras].sort((a, b) => b.monthly - a.monthly).slice(0, 4).map((e) => `${e.name} ${money(e.monthly)}`);
    return { text: `${s.extras.length} extra${s.extras.length === 1 ? "" : "s"}, about ${money(total)} a month: ${top.join(", ")}${s.extras.length > 4 ? ", and more" : ""}.`, href: "/bills", link: "See bills" };
  }

  // Bills: one by name ("Netflix") or by what it is ("rent" for a landlord's name), or what's coming up.
  const live = s.bills.filter((b) => b.active);
  const kind = Object.entries(CATEGORY_WORDS).find(([key, words]) => ["housing", "utilities", "insurance", "loans"].includes(key) && words.some((w) => ` ${q} `.includes(` ${w} `)));
  const bill = mentioned(q, live) ?? (kind ? ([...live].filter((b) => b.category === kind[0]).sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1))[0] ?? null) : null);
  if (bill && /\b(due|when|next|bill|pay|cost|how much)\b/.test(q)) {
    const days = diffDays(bill.nextDate, s.today);
    const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `on ${formatShort(bill.nextDate)}`;
    return { text: `${bill.name} (${money(bill.amount)}) is next due ${when}.`, href: "/bills", link: "See bills" };
  }
  if (/\b(bills?|due|coming up|upcoming|subscriptions?|payments? coming)\b/.test(q)) {
    const until = /\bbefore payday\b/.test(q) && s.nextPayday ? s.nextPayday : /\bthis month\b/.test(q) ? monthEnd(monthOf(s.today)) : /\btoday\b/.test(q) ? s.today : null;
    const limitDays = until ? diffDays(until, s.today) : 7;
    const soon = s.bills.filter((b) => b.active && diffDays(b.nextDate, s.today) >= 0 && diffDays(b.nextDate, s.today) <= limitDays).sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
    const span = until ? (until === s.today ? "today" : until === s.nextPayday ? `before payday on ${formatShort(until)}` : "the rest of this month") : "the next week";
    if (soon.length === 0) return { text: `Nothing due ${span}. *relaxed tail wag*`, href: "/bills", link: "See bills" };
    const list = soon.slice(0, 4).map((b) => `${b.name} ${money(b.amount)} ${diffDays(b.nextDate, s.today) === 0 ? "today" : formatShort(b.nextDate)}`);
    const total = soon.reduce((sum, b) => sum + Math.abs(b.amount), 0);
    return { text: `${soon.length} due ${span}, ${money(total)} in all: ${list.join(", ")}${soon.length > 4 ? ", and more" : ""}.`, href: "/bills", link: "See bills" };
  }

  // Pushing back on a purchase answer, and nothing else was asked: he holds his ground.
  if (last && PUSHBACK.test(q)) {
    const { verdict, reason } = judgePurchase(last.amount, last.item, s);
    if (verdict !== last.verdict) return { text: `The numbers have moved since I last looked. ${pick(OPENERS[verdict], seed)} ${reason}`, verdict: { ...last, verdict }, href: "/", link: "See the month" };
    return { text: `${pick(HOLDING[verdict], seed)} ${reason}`, verdict: { ...last, verdict }, href: "/", link: "See the month" };
  }

  if (/\bbudget\b/.test(q)) {
    return { text: `After bills and goals there’s ${money(s.leftToSpend)} left this month: about ${money(s.perDay)} a day for ${s.daysLeft} days.`, href: "/budget", link: "See budget" };
  }

  return null;
}
