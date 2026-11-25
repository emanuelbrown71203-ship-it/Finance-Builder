import { describe, expect, it } from "vitest";
import { answerQuestion, judgePurchase, planIn, type Answer, type Snapshot } from "@/lib/nickel/answers";

const snap: Snapshot = {
  today: "2026-11-21",
  firstName: "Sam",
  leftToSpend: 123_456,
  perDay: 12_346,
  daysLeft: 10,
  incomeReceived: 569_264,
  incomeExpected: 853_896,
  bills: [
    { name: "Parkview Apartments", nextDate: "2026-12-01", amount: -215_000, active: true, category: "housing" },
    { name: "Netflix", nextDate: "2026-12-09", amount: -1_799, active: true, category: "entertainment" },
    { name: "Geico", nextDate: "2026-11-23", amount: -13_250, active: true, category: "insurance" },
    { name: "Spotify", nextDate: "2026-11-27", amount: -1_199, active: true, category: "entertainment" },
    { name: "Hulu", nextDate: "2026-06-06", amount: -999, active: false, category: "entertainment" },
  ],
  spending: [
    { category: "dining", label: "Restaurants & coffee", spent: 31_250, limit: 40_000 },
    { category: "groceries", label: "Groceries", spent: 52_010, limit: null },
  ],
  goals: [
    { id: "g1", name: "Emergency fund", saved: 480_000, target: 1_500_000, status: "no_date", perMonth: null, targetDate: null, projectedDate: "2028-09-01" },
    { id: "g2", name: "Two weeks in Japan", saved: 150_000, target: 450_000, status: "behind", perMonth: 37_500, targetDate: "2027-08-31", projectedDate: null },
  ],
  netWorth: 8_123_400,
  netWorthChange: 210_000,
  latest: { name: "Tartine Bakery", amount: -1_210, date: "2026-11-21" },
  cash: 420_000,
  savings: 1_200_000,
  nextPayday: "2026-11-27",
  priciestDebt: { name: "Cashback Visa", apr: 24.99 },
};
const ask = (q: string) => answerQuestion(q, snap) as Answer;

describe("answering everyday questions from the person's own numbers", () => {
  it("says what's free to spend, however it's asked", () => {
    for (const q of ["What's left to spend?", "what's free to spend?", "how am I doing this month", "How much can I spend per day", "what’s left"]) {
      expect(ask(q).text, q).toBe("$1,234.56 is free to spend this month, after every bill and your savings: about $123.46 a day for 10 days.");
    }
    expect((answerQuestion("what's left", { ...snap, leftToSpend: -5_000 }) as Answer).text).toMatch(/^You’re over by \$50 this month, with 10 days to go/);
  });

  it("says how much is over, and what's spoken for, in the owner's words", () => {
    const over = { ...snap, leftToSpend: -41_200, spending: [{ category: "groceries", label: "Groceries", spent: 74_149, limit: 65_000 }, { category: "dining", label: "Restaurants & coffee", spent: 10_000, limit: 28_000 }] };
    expect((answerQuestion("how much am I over?", over) as Answer).text).toBe("You’re over by $412 this month: spending has gone past what came in, after bills and savings. Over budget: Groceries by $91.49.");
    expect(ask("am I over?").text).toBe("You’re not over: $1,234.56 is still free to spend this month.");
    const withMonth = { ...snap, month: { billsPaid: 99_900, everyday: 86_100, billsDue: 102_600, saving: 12_400 } };
    expect((answerQuestion("what's spoken for?", withMonth) as Answer).text).toBe(
      "$8,538.96 came in this month ($5,692.64 so far, $2,846.32 still coming). $1,860 is already spent ($999 on bills, $861 everyday). $1,150 is spoken for ($1,026 for bills still to pay, $124 for savings). That leaves $1,234.56 free to spend.",
    );
    expect((answerQuestion("give me the breakdown", withMonth) as Answer).text).toMatch(/is spoken for/);
  });

  it("knows what's coming up and when a named bill is due", () => {
    expect(ask("what bills are coming up?").text).toBe("2 due the next week, $144.49 in all: Geico $132.50 Nov 23, Spotify $11.99 Nov 27.");
    expect(ask("when is rent due").text).toBe("Parkview Apartments ($2,150) is next due on Dec 1.");
    expect(ask("when's my insurance due").text).toBe("Geico ($132.50) is next due on Nov 23.");
    expect(ask("when is Netflix due?").text).toBe("Netflix ($17.99) is next due on Dec 9.");
    expect(ask("what's due this month").text).toMatch(/^2 due the rest of this month/);
    // A bill that stopped isn't "coming up".
    expect(ask("when is hulu due").text).not.toMatch(/Hulu \(/);
  });

  it("says what was spent on a category, with its limit", () => {
    expect(ask("how much did I spend on eating out this month?").text).toBe("You’ve spent $312.50 on Restaurants & coffee this month of your $400 limit.");
    expect(ask("how much have I spent on groceries").text).toBe("You’ve spent $520.10 on Groceries this month.");
    // A place rather than a category is looked up on the server.
    expect(answerQuestion("how much did I spend at Costco", snap)).toEqual({ merchant: "costco" });
  });

  it("knows how each goal is doing", () => {
    expect(ask("how's my Japan goal").text).toBe("“Two weeks in Japan” is behind its track: $1,500 of $4,500. About $375 a month from now gets it there by Aug 31.");
    expect(ask("how much is in the emergency fund?").text).toMatch(/^“Emergency fund”: \$4,800 of \$15,000 saved/);
    expect(ask("how are my goals doing").text).toMatch(/^2 goals: 0 on track or ahead, 1 behind/);
  });

  it("answers net worth, the latest charge, money in, and a hello", () => {
    expect(ask("what's my net worth").text).toBe("Your net worth is $81,234, up $2,100 over the last 30 days.");
    expect(ask("what was my last purchase").text).toBe("The latest is $12.10 at Tartine Bakery on Nov 21.");
    expect(ask("did I get paid").text).toBe("$5,692.64 has come in this month, of about $8,538.96 expected.");
    expect(ask("hi nickel").text).toMatch(/^Hi Sam!/);
    expect(ask("good boy").text).toMatch(/happy beeps/);
  });

  it("says nothing when it didn't understand, and never gives advice", () => {
    expect(answerQuestion("what's the weather", snap)).toBeNull();
    expect(answerQuestion("", snap)).toBeNull();
    const all = ["what's left", "what bills are coming up", "how's my japan goal", "how are my goals", "net worth", "help", "spent on dining"].map((q) => ask(q).text.toLowerCase());
    for (const t of all) expect(t).not.toMatch(/\byou should\b|\byou must\b|\bi recommend\b|\binvest in\b/);
  });
});

describe("the questions the owner asked that he couldn't answer", () => {
  const more: Snapshot = {
    ...snap,
    spending: [
      { category: "dining", label: "Restaurants & coffee", spent: 31_250, limit: 40_000, lastMonth: 35_000, status: "watch" },
      { category: "groceries", label: "Groceries", spent: 52_010, limit: 50_000, lastMonth: 48_000, status: "over" },
      { category: "housing", label: "Home & rent", spent: 0, limit: null, lastMonth: 215_000, bills: 215_000 },
    ],
    accounts: [
      { name: "Everyday Checking", kind: "checking", balance: 420_000 },
      { name: "High Yield Savings", kind: "savings", balance: 1_200_000 },
      { name: "Cashback Visa", kind: "card", balance: 269_726 },
      { name: "Auto Loan", kind: "loan", balance: 1_456_939 },
    ],
    weeks: { today: 0, thisWeek: 39_180, lastWeek: 70_342 },
    extras: [
      { name: "Netflix", monthly: 1_799 },
      { name: "Spotify", monthly: 1_199 },
    ],
  };
  const say = (q: string) => (answerQuestion(q, more) as Answer).text;

  it("says what's owed, on cards, on loans, or on one card", () => {
    expect(say("how much do I owe")).toBe("You owe $17,266.65 across 2 cards and loans: Auto Loan $14,569.39, Cashback Visa $2,697.26.");
    expect(say("what's my credit card balance")).toBe("You owe $2,697.26 across 1 card: Cashback Visa $2,697.26.");
    expect(say("how much do I owe on my loans")).toBe("You owe $14,569.39 across 1 loan: Auto Loan $14,569.39.");
    expect(say("how much is on my cashback visa")).toBe("Cashback Visa has $2,697.26 on it.");
    // When it's due is a bills question.
    expect(say("when is my credit card due")).not.toMatch(/You owe/);
  });

  it("says what's in the bank", () => {
    expect(say("how much money do I have")).toBe("$4,200 in checking and $12,000 in savings.");
    expect(say("how much is in my checking")).toBe("$4,200 in checking.");
    expect(say("how much is in savings")).toBe("$12,000 in savings.");
  });

  it("says what was spent this week, last week, today and last month", () => {
    expect(say("how much did I spend this week")).toBe("$391.80 spent so far this week, bills included.");
    expect(say("how much did I spend last week")).toBe("You spent $703.42 last week, bills included.");
    expect(say("how much did I spend today")).toMatch(/Nothing spent today/);
    expect(say("how much did I spend last month")).toBe("You spent $2,980 last month, bills included, not counting transfers.");
    expect(say("what did I spend last month")).toMatch(/last month/);
  });

  it("looks up a store rather than the latest charge", () => {
    expect(answerQuestion("what did I spend at amazon", more)).toEqual({ merchant: "amazon" });
    expect(answerQuestion("how much did I spend at trader joe's this week", more)).toEqual({ merchant: "trader joe's" });
    expect(say("what did I just buy")).toMatch(/Tartine Bakery/);
  });

  it("answers about a bill asked by name, the biggest bill, and a card's bill", () => {
    expect(say("rent")).toBe("Parkview Apartments ($2,150) is next due on Dec 1.");
    expect(say("what's my biggest bill")).toBe("Your biggest bill is Parkview Apartments, $2,150, next due Dec 1.");
    expect(say("how much is my cashback visa bill")).toBe("Cashback Visa has $2,697.26 on it.");
  });

  it("says what interest and fees have cost", () => {
    const withCosts = { ...more, costs: { thisMonth: 5_377, thisYear: 48_500, interestYear: 35_600, feesYear: 12_900 } };
    expect((answerQuestion("how much interest have I paid", withCosts) as Answer).text).toBe("$485 in interest and fees this year ($356 interest, $129 fees), $53.77 of it this month.");
    expect((answerQuestion("what's the interest rate on my loan", withCosts) as Answer | null)?.text ?? "").not.toMatch(/interest and fees this year/);
  });

  it("says where the money goes, how the budgets stand, what's saved, income and subscriptions", () => {
    expect(say("where is my money going")).toBe("This month the most has gone to Home & rent ($2,150), Groceries ($520.10), Restaurants & coffee ($312.50).");
    expect(say("am I over budget")).toBe("Groceries is $20.10 over. Restaurants & coffee is on pace to go over.");
    expect(say("how much have I saved")).toBe("$12,000 in savings accounts. Your goals have $6,300 put toward them.");
    expect(say("how much do I make")).toMatch(/has come in this month/);
    expect(say("show me my subscriptions")).toBe("2 extras, about $29.98 a month: Netflix $17.99, Spotify $11.99.");
  });
});

describe("a straight answer about a purchase, and he holds to it", () => {
  it("says yes, not yet or no from the numbers, with the reason", () => {
    const yes = ask("can I afford a $40 pizza night?");
    expect(yes.text).toMatch(/^(Yes, that fits\.|Paws up: that fits\.|Yes\. Woof!) You’d still have \$1,194\.56 left this month/);
    expect(yes.verdict).toEqual({ amount: 4_000, item: "pizza night", verdict: "yes" });
    const wait = ask("should I buy a $1,000 tv");
    expect(wait.verdict?.verdict).toBe("wait");
    expect(wait.text).toMatch(/would leave \$234\.56 for 10 days, about \$23\.45 a day\. After payday on Nov 27 it’s an easier yes\./);
    const no = ask("can I afford a $2,000 couch");
    expect(no.verdict?.verdict).toBe("no");
    expect(no.text).toMatch(/would put this month \$765\.44 past what’s left after bills and goals, and paying from savings would set your goals back\./);
  });

  it("says plainly when a purchase would put the bills at risk", () => {
    const r = judgePurchase(410_000, "laptop", snap);
    expect(r.verdict).toBe("no");
    expect(r.reason).toMatch(/checking \$44\.49 short of the \$144\.49 in bills and Extras due before payday on Nov 27\. That puts the household’s bills at risk\./);
  });

  it("doesn't cave to pleading, but does look again at a new price", () => {
    const first = ask("can I afford a $2,000 couch");
    for (const push of ["but I really want it", "come on, it's on sale", "are you sure?", "please, just this once", "I deserve it"]) {
      const again = answerQuestion(push, snap, first.verdict) as Answer;
      expect(again.verdict?.verdict, push).toBe("no");
      expect(again.text, push).toMatch(/^(Still no|I hear you|No again)/);
      expect(again.text, push).toContain("$765.44");
    }
    const cheaper = answerQuestion("what about $300?", snap, first.verdict) as Answer;
    expect(cheaper.verdict).toEqual({ amount: 30_000, item: "couch", verdict: "yes" });
    expect(cheaper.text).toMatch(/^At \$300, that changes things\./);
  });

  it("asks how much when there's no price, and keeps out of investment picks", () => {
    expect(ask("should I buy it?").text).toMatch(/^How much is it\?/);
    const texts = ["can I afford a $40 pizza", "should I buy a $1,000 tv", "can I afford a $2,000 couch"].map((q) => ask(q).text.toLowerCase());
    for (const t of texts) expect(t).not.toMatch(/\binvest in\b|\bbuy (stock|shares|crypto)\b/);
  });
});


describe("the things a review caught", () => {
  it("never takes a bare number for a price, but does count '2 at $45 each'", () => {
    expect(ask("should I buy a 65 inch tv").text).toMatch(/^How much is it\?/);
    expect(ask("can I afford an iphone 16 pro").text).toMatch(/^How much is it\?/);
    expect(ask("can I afford 2 tickets at $45 each").verdict).toMatchObject({ amount: 9_000, item: "tickets" });
    expect(ask("can I afford a $25,000 car").verdict?.item).toBe("car");
  });

  it("stays out of investing", () => {
    for (const q of ["should I buy $500 of bitcoin", "can I afford $300 of an index fund", "is it a good idea to buy stocks"]) {
      const a = ask(q);
      expect(a.verdict, q).toBeUndefined();
      expect(a.text, q).toMatch(/I don’t pick investments: I’m a robot dog, not a financial advisor/);
    }
  });

  it("doesn't warn about bills at risk when there's no checking account to go by", () => {
    const cardsOnly = { ...snap, cash: null };
    expect((answerQuestion("can I afford a $100 dinner", cardsOnly) as Answer).verdict?.verdict).toBe("yes");
    expect((answerQuestion("can I afford a $100 dinner", cardsOnly) as Answer).text).not.toMatch(/at risk/);
  });

  it("answers a real follow-up question instead of treating it as pleading", () => {
    const first = ask("can I afford a $2,000 couch");
    expect((answerQuestion("but when is rent due", snap, first.verdict) as Answer).text).toBe("Parkview Apartments ($2,150) is next due on Dec 1.");
    expect((answerQuestion("please tell me what's due this month", snap, first.verdict) as Answer).text).toMatch(/due the rest of this month/);
    expect((answerQuestion("but I want it", snap, first.verdict) as Answer).text).toMatch(/^(Still no|I hear you|No again)/);
  });

  it("gets the smaller questions right", () => {
    expect(answerQuestion("is netflix worth it", snap)).not.toMatchObject({ text: expect.stringMatching(/net worth/) });
    expect(ask("when is payday?").text).toBe("Next payday looks like Nov 27, in 6 days.");
    expect(ask("what bills are due before payday").text).toMatch(/due before payday on Nov 27/);
    expect(ask("how much did I spend for the month").text).toMatch(/spent so far this month/);
    expect((answerQuestion("how much did I spend on dining last month", { ...snap, spending: [{ ...snap.spending[0], lastMonth: 41_000 }] }) as Answer).text).toBe("You spent $410 on Restaurants & coffee last month.");
  });
});

describe("buying on a payment plan", () => {
  it("reads the plan from the words: pay in 4 every two weeks unless said otherwise", () => {
    expect(planIn("can i afford it on a payment plan")).toEqual({ count: 4, everyDays: 14 });
    expect(planIn("what if i pay it in 4")).toEqual({ count: 4, everyDays: 14 });
    expect(planIn("split it into 3 payments")).toEqual({ count: 3, everyDays: 14 });
    expect(planIn("can i get it with affirm")).toEqual({ count: 4, everyDays: 14 });
    expect(planIn("a laptop over 6 months")).toEqual({ count: 6, everyDays: 30 });
    expect(planIn("12 monthly payments")).toEqual({ count: 12, everyDays: 30 });
    expect(planIn("pay it off over 8 weeks")).toEqual({ count: 4, everyDays: 14 });
    expect(planIn("can i afford a 300 jacket")).toBeNull();
  });

  it("judges the payments, not the whole price, and names the thing even when asked about 'them'", () => {
    const a = ask("I need new headphones $250. Can I afford them if I put them on a payment plan");
    expect(a.verdict).toEqual({ amount: 25_000, item: "headphones", verdict: "yes", plan: { count: 4, everyDays: 14 } });
    expect(a.text).toMatch(/^(Yes, that fits\.|Paws up: that fits\.|Yes\. Woof!) \$62\.50 today, then \$62\.50 every two weeks until Jan 2 \(4 payments\)\. This month that leaves \$1,172\.06, about \$117\.20 a day\. Only take it if it’s 0% interest\.$/);
    const monthly = ask("can I afford a $1,200 laptop over 6 months");
    expect(monthly.text).toContain("$200 today, then $200 every month until Apr 21 (6 payments). This month that leaves $1,034.56, about $103.45 a day.");
  });

  it("says when the cards are already costing interest: 0% only, paid from checking", () => {
    const withCosts = { ...snap, costs: { thisMonth: 17_787, thisYear: 60_000, interestYear: 40_000, feesYear: 20_000 } };
    expect((answerQuestion("can I afford $250 headphones on a payment plan", withCosts) as Answer).text).toMatch(/Only take it at 0% interest, paid from checking, not a card: your cards already cost \$177\.87 in interest and fees this month\.$/);
  });

  it("puts bills first: a plan that leaves checking short before payday is a no", () => {
    const tight = { ...snap, cash: 10_000 };
    const a = answerQuestion("can I afford $250 headphones on a payment plan", tight) as Answer;
    expect(a.verdict?.verdict).toBe("no");
    expect(a.text).toMatch(/Even split up, the headphones would leave checking \$106\.99 short of the \$144\.49 in bills due before payday on Nov 27\. That puts the household’s bills at risk\./);
  });

  it("keeps the no-spend week: the first payment would land in it, and so would any purchase", () => {
    const lastWeek = { ...snap, today: "2026-11-25" };
    const plan = answerQuestion("can I afford $250 headphones on a payment plan", lastWeek) as Answer;
    expect(plan.verdict?.verdict).toBe("wait");
    expect(plan.text).toMatch(/It’s your no-spend week through Nov 30, and the first \$62\.50 would come out today\. Start the plan on Dec 1 or later and ask me again\./);
    const pizza = answerQuestion("can I afford a $40 pizza", lastWeek) as Answer;
    expect(pizza.verdict?.verdict).toBe("wait");
    expect(pizza.text).toMatch(/It’s your no-spend week through Nov 30: bills only\. The pizza can wait until Dec 1/);
  });

  it("looks again when asked 'what if I pay it in 4', and holds to the plan answer when pushed", () => {
    const first = ask("can I afford a $2,000 couch");
    expect(first.verdict?.verdict).toBe("no");
    const split = answerQuestion("what if I pay it in 4", snap, first.verdict) as Answer;
    expect(split.verdict).toEqual({ amount: 200_000, item: "couch", verdict: "yes", plan: { count: 4, everyDays: 14 } });
    expect(split.text).toMatch(/^On a payment plan, that changes things\. .* \$500 today, then \$500 every two weeks until Jan 2 \(4 payments\)\./);
    const pushed = answerQuestion("are you sure?", snap, split.verdict) as Answer;
    expect(pushed.verdict?.verdict).toBe("yes");
    expect(pushed.text).toContain("$500 today");
  });
});

describe("savings, each paycheck", () => {
  const saving = { planned: 40_000, saved: 10_000, toDo: 15_000, todos: [{ goalName: "Emergency Savings", date: "2026-11-10", remaining: 0, status: "done" }, { goalName: "DreamCon", date: "2026-11-10", remaining: 15_000, status: "todo" }, { goalName: "DreamCon", date: "2026-11-24", remaining: 15_000, status: "coming" }] };
  it("says what's put aside this month and what's still to do", () => {
    const withSaving = { ...snap, saving };
    expect((answerQuestion("how am I doing on savings?", withSaving) as Answer).text).toBe("$100 of $400 put aside this month. Still to do: DreamCon $150 (Nov 10 paycheck).");
    expect((answerQuestion("what should I save this paycheck", withSaving) as Answer).link).toBe("See savings");
    const allDone = { ...snap, saving: { planned: 40_000, saved: 40_000, toDo: 0, todos: [] } };
    expect((answerQuestion("did I save this month", allDone) as Answer).text).toBe("$400 of $400 put aside this month. All done! *proud wag*");
  });

  it("says whether saving more fits, from the month's numbers and checking before payday", () => {
    expect(ask("can I save $200 more this month?").text).toBe("Yes: $200 more would still leave $1,034.56 free to spend this month, about $103.45 a day. *proud wag*");
    expect(ask("can I afford to save $2,000?").text).toMatch(/^Not this month: only \$1,234\.56 is free after bills and the savings already planned\. Saving \$1,234\.56 more would keep the month even\./);
    expect((answerQuestion("can I put aside $300", { ...snap, cash: 30_000 }) as Answer).text).toMatch(/^Not from checking right now/);
  });
});
