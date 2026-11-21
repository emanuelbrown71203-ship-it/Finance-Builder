import { diffDays, formatShort, type ISODate } from "../dates";

/*
 * Nickel's brain: what the robo dog notices in someone's numbers, and how he
 * says it. Pure, so it can be tested and runs the same on sample data.
 *
 * He points things out; he doesn't tell anyone what to do with their money.
 * Wording leans on "could", questions, and plain facts, never "you should".
 */

export type Mood = "happy" | "excited" | "proud" | "curious" | "worried" | "sleepy";

export type Tip = {
  /** Stable for the same thing on the same day, so a tip isn't repeated once seen. */
  id: string;
  /** 1 is "say this now", 5 is small talk. */
  priority: 1 | 2 | 3 | 4 | 5;
  mood: Mood;
  text: string;
  /** Where to look, if anywhere. */
  href?: string;
  link?: string;
};

export type NickelInput = {
  today: ISODate;
  demo: boolean;
  linked: boolean;
  firstName: string;
  leftToSpend: number;
  perDay: number;
  daysLeft: number;
  /** Money in today (a paycheck), if any. */
  paidToday: number;
  attention: { kind: string; title: string; detail: string }[];
  budget: { category: string; label: string; spent: number; limit: number | null }[];
  goals: { id: string; name: string; saved: number; target: number; status: string; gap: number | null; perMonth: number | null; perPayday: number | null; targetDate: ISODate | null }[];
  upcoming: { name: string; date: ISODate; amount: number }[];
  /** Days in a row, up to yesterday, with no everyday spending. */
  noSpendStreak: number;
  netWorthChange: number;
  priciestDebt: { name: string; apr: number } | null;
  latest: { name: string; amount: number; date: ISODate } | null;
};

const money = (cents: number) => {
  const abs = Math.abs(cents);
  return `$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: abs % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
};

/** A steady pick from a few ways of saying something: the same all day, different tomorrow. */
export function pick<T>(options: T[], seed: string): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return options[Math.abs(h) % options.length];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

export function thinkAbout(input: NickelInput): { mood: Mood; tips: Tip[] } {
  const { today } = input;
  const tips: Tip[] = [];
  const say = ({ key, ...tip }: Omit<Tip, "id"> & { key: string }) => tips.push({ ...tip, id: `${key}:${today}` });
  const s = (key: string, options: string[]) => pick(options, `${key}:${today}`);

  if (!input.demo && !input.linked) {
    say({ key: "link", priority: 1, mood: "curious", text: s("link", ["Link a bank and I’ll start sniffing around your numbers. Woof!", "Nothing to sniff yet! Link a bank and I’ll tell you what I notice."]), href: "/accounts", link: "Link a bank" });
    return { mood: "curious", tips };
  }

  if (input.paidToday > 0) {
    const behind = input.goals.filter((g) => g.status === "behind" && g.perPayday).sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0))[0];
    const extra = behind ? ` Putting ${money(behind.perPayday!)} toward “${behind.name}” would keep it on its track.` : "";
    say({ key: "payday", priority: 1, mood: "excited", text: `${s("payday", ["Payday!", "Woof woof, payday!", "Ooh, payday!"])} ${money(input.paidToday)} just came in.${extra}`, href: behind ? `/savings/goal?id=${encodeURIComponent(behind.id)}` : "/", link: behind ? "Open the goal" : undefined });
  }

  if (input.leftToSpend < 0) {
    say({ key: "over", priority: 1, mood: "worried", text: s("over", [`This month is ${money(-input.leftToSpend)} past what’s left after bills and goals. A few lighter days could pull it back.`, `Ruh-roh. After bills and goals, this month is over by ${money(-input.leftToSpend)}.`]), href: "/", link: "See the month" });
  }

  for (const a of input.attention) {
    const k = `${a.kind}-${slug(a.title)}`;
    if (a.kind === "due") say({ key: k, priority: 2, mood: "curious", text: `Heads up: ${a.title.replace(/ is due/, " is due")} (${a.detail}).`, href: "/bills", link: "See bills" });
    else if (a.kind === "price") say({ key: k, priority: 2, mood: "curious", text: `${s(k, ["Sniff sniff…", "Hmm!", "I noticed something:"])} ${a.title}: ${a.detail}. Still worth it to you?`, href: "/bills", link: "See bills" });
    else if (a.kind === "renewal") say({ key: k, priority: 2, mood: "curious", text: `${a.title}. ${a.detail}`, href: "/bills", link: "See bills" });
    else if (a.kind === "new") say({ key: k, priority: 3, mood: "curious", text: `New smell! ${a.title} (${a.detail}). Meant to keep it?`, href: "/bills", link: "See bills" });
    else if (a.kind === "bank") say({ key: k, priority: 1, mood: "worried", text: `${a.title}. ${a.detail}`, href: "/accounts", link: "Fix it" });
  }

  for (const b of input.budget) {
    if (!b.limit) continue;
    const k = `budget-${b.category}`;
    if (b.spent > b.limit) say({ key: k, priority: 2, mood: "worried", text: `${b.label} is ${money(b.spent - b.limit)} over its ${money(b.limit)} limit this month.`, href: "/budget", link: "See budget" });
    else if (b.spent >= b.limit * 0.9 && input.daysLeft > 3) say({ key: k, priority: 3, mood: "curious", text: `${b.label} is at ${Math.round((b.spent / b.limit) * 100)}% of its limit with ${input.daysLeft} days to go.`, href: "/budget", link: "See budget" });
  }

  for (const g of input.goals) {
    const k = `goal-${g.id}`;
    const href = `/savings/goal?id=${encodeURIComponent(g.id)}`;
    if (g.status === "reached") say({ key: k, priority: 2, mood: "excited", text: s(k, [`You reached “${g.name}”! I’m doing zoomies.`, `“${g.name}” is fully funded! Best day ever. Woof!`]), href, link: "See the goal" });
    else if (g.status === "behind" && g.gap !== null && g.perMonth) say({ key: k, priority: 3, mood: "worried", text: `“${g.name}” is ${money(-g.gap)} behind its track. About ${money(g.perMonth)} a month from now gets it there by ${formatShort(g.targetDate!)}.`, href, link: "See the track" });
    else if (g.status === "ahead" && g.gap !== null) say({ key: k, priority: 3, mood: "proud", text: s(k, [`“${g.name}” is ${money(g.gap)} ahead of plan! *tail wags*`, `Look at you: “${g.name}” is ${money(g.gap)} ahead of its track.`]), href, link: "See the track" });
    else if (g.status === "on_track") say({ key: k, priority: 4, mood: "happy", text: `“${g.name}” is right on track. ${money(g.saved)} of ${money(g.target)}.`, href, link: "See the track" });
    else if (g.status === "overdue") say({ key: k, priority: 3, mood: "curious", text: `“${g.name}” passed its date with ${money(g.target - g.saved)} to go. A new date would give it a fresh plan.`, href, link: "Change it" });
  }

  const soon = input.upcoming.filter((u) => diffDays(u.date, today) >= 0 && diffDays(u.date, today) <= 7);
  if (soon.length >= 2) {
    const total = soon.reduce((sum, u) => sum + Math.abs(u.amount), 0);
    say({ key: "week-bills", priority: 4, mood: "curious", text: `${soon.length} bills come out in the next week, ${money(total)} in all.`, href: "/bills", link: "See bills" });
  }

  if (input.noSpendStreak >= 2) say({ key: "streak", priority: 3, mood: "proud", text: s("streak", [`${input.noSpendStreak} no-spend days in a row. I’m so proud of you.`, `That’s ${input.noSpendStreak} days in a row without everyday spending. Good human!`]) });

  if (input.leftToSpend > 0 && input.perDay > 0) say({ key: "pace", priority: 4, mood: "happy", text: s("pace", [`After bills and goals there’s ${money(input.leftToSpend)} left this month: about ${money(input.perDay)} a day.`, `${money(input.perDay)} a day left to spend through the end of the month. Nice and steady.`]), href: "/", link: "See the month" });

  if (input.netWorthChange > 0) say({ key: "worth", priority: 4, mood: "proud", text: `Your net worth is up ${money(input.netWorthChange)} over the last six months. *happy beeps*`, href: "/net-worth", link: "See net worth" });

  if (input.priciestDebt && input.priciestDebt.apr >= 15) say({ key: "debt", priority: 4, mood: "curious", text: `${input.priciestDebt.name} charges ${input.priciestDebt.apr.toFixed(2)}% interest, the most of anything you owe. The debt plan shows what a little extra there changes.`, href: "/debt", link: "See debt plan" });

  if (input.latest) say({ key: `latest-${slug(input.latest.name)}`, priority: 5, mood: "curious", text: `Latest sniff: ${money(input.latest.amount)} ${input.latest.amount < 0 ? "at" : "from"} ${input.latest.name}.`, href: "/transactions", link: "See transactions" });

  if (input.demo) say({ key: "demo", priority: 4, mood: "happy", text: "Psst: this is a pretend household so you can play. None of these numbers are real money." });

  if (!tips.some((t) => t.priority <= 2)) say({ key: "clear", priority: 3, mood: "happy", text: s("clear", ["Nothing needs a look right now. All clear!", "I sniffed everything. All clear, nothing needs you today."]) });

  tips.sort((a, b) => a.priority - b.priority);
  const top = tips[0];
  const mood: Mood = tips.some((t) => t.mood === "excited" && t.priority <= 2) ? "excited" : top && top.priority <= 2 && top.mood === "worried" ? "worried" : tips.some((t) => t.mood === "proud" && t.priority <= 3) ? "proud" : "happy";
  return { mood, tips };
}

/** What he says when tapped and there's nothing new: a little life, no money talk. */
export const SMALL_TALK = [
  "*happy beeps*",
  "That tickles!",
  "I run on solar power and good budgeting.",
  "Fetching numbers is my favorite game.",
  "Who’s a good bot? Me. I’m the good bot.",
  "Boop! Just checking in.",
  "I buried a coin somewhere. Can’t remember where. Classic me.",
  "My tail has three speeds: wag, WAG, and helicopter.",
  "Every dollar saved is a treat for future you.",
];

/** Said once, the first time he meets someone. */
export const INTRO = "Hi, I’m Nickel! I sniff through your numbers and tell you what I notice. I’m a robot dog, not a financial advisor, so my ideas are just ideas. Tap me any time. Hold me for options.";
