import { addDays, addMonths, daysInMonth, dayOfMonth, monthEnd, type ISODate } from "../dates";

/*
 * Understanding what someone types to Nickel ("add Netflix $15.99 on the
 * 5th", "new goal Japan $4,500 by June", "student loan rate 4.5%") without
 * any AI service: plain rules over the words, run on the device and in tests.
 *
 * It only works out a draft. Anything it couldn't find is left empty, so the
 * screen can ask for just that; nothing is guessed into a number.
 */

export type BillFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "yearly";

export type Command =
  /** `date` is the next one due; `anchor` the date carrying the day asked for (the 31st), which may be in the past. */
  | { kind: "bill"; name: string | null; amount: number | null; frequency: BillFrequency; date: ISODate | null; anchor: ISODate | null }
  | { kind: "upcoming"; name: string | null; amount: number | null; date: ISODate | null }
  | { kind: "goal"; name: string | null; target: number | null; date: ISODate | null }
  | { kind: "deposit"; goal: string | null; amount: number | null }
  | { kind: "loan"; loan: string | null; aprPercent: number | null; payment: number | null }
  | { kind: "rename"; from: string | null; to: string | null; onlyAmount: number | null };

export type CommandContext = { today: ISODate; goals: string[]; loans: string[] };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, daysInMonth(y, m))).padStart(2, "0")}`;
const monthIndex = (word: string) => MONTHS.findIndex((m) => m.startsWith(word.toLowerCase().slice(0, 3)));

/** Text with the parts that have been understood taken out, so what's left is the name. */
class Words {
  constructor(public text: string) {}
  take(re: RegExp): RegExpExecArray | null {
    const m = re.exec(this.text);
    if (m) this.text = `${this.text.slice(0, m.index)} ${this.text.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim();
    return m;
  }
}

/**
 * "$15.99", "15.99", "2,150", "1.5k", "40 dollars" → cents. A "$" amount wins
 * over a bare number anywhere in the text, and dates are read first, so a
 * year or a day of the month is never taken for the amount.
 */
function takeAmount(w: Words): number | null {
  const tries = [
    /(?:^|\s)\$\s?(\d[\d,]*(?:\.\d{1,2})?)(k)?(?=\s|$|[.,!?])/i,
    /(?:^|\s)(\d[\d,]*(?:\.\d{1,2})?)(k)?\s*(?:dollars|bucks|usd)\b/i,
    /(?:^|\s)(\d[\d,]*\.\d{1,2})()(?=\s|$|[.,!?])/,
    /(?:^|\s)(\d{1,3}(?:,\d{3})+|\d{2,})(k)?(?=\s|$|[.,!?])/i,
  ];
  for (const re of tries) {
    // A bare year ("2027") is only the amount when nothing else could be.
    const m = re === tries[3] ? (w.take(/(?:^|\s)(?!20\d{2}(?=\s|$|[.,!?]))(\d{1,3}(?:,\d{3})+|\d{2,})(k)?(?=\s|$|[.,!?])/i) ?? w.take(re)) : w.take(re);
    if (!m) continue;
    const value = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
    return Number.isFinite(value) && value > 0 && value < 100_000_000 ? Math.round(value * 100) : null;
  }
  return null;
}

function takePercent(w: Words): number | null {
  const m = w.take(/(\d{1,2}(?:\.\d{1,3})?)\s?(?:%|percent)/i);
  if (!m) return null;
  const v = Number(m[1]);
  return v >= 0 && v <= 99 ? v : null;
}

function takeFrequency(w: Words): BillFrequency | null {
  if (w.take(/\b(?:every\s+(?:other|2|two)\s+weeks?|bi-?weekly|fortnightly)\b/i)) return "biweekly";
  if (w.take(/\b(?:every\s+week|weekly|a\s+week|per\s+week|each\s+week)\b/i)) return "weekly";
  if (w.take(/\b(?:every\s+(?:3|three)\s+months|quarterly)\b/i)) return "quarterly";
  if (w.take(/\b(?:every\s+(?:6|six)\s+months|semi-?annual(?:ly)?|twice\s+a\s+year)\b/i)) return "semiannual";
  if (w.take(/\b(?:every\s+year|yearly|annually|annual|a\s+year|per\s+year|each\s+year)\b/i)) return "yearly";
  if (w.take(/\b(?:every\s+month|monthly|a\s+month|per\s+month|each\s+month|\/\s?mo(?:nth)?)\b/i)) return "monthly";
  return null;
}

type Dated = { date: ISODate; anchor?: ISODate };

/**
 * The next time a day of the month comes round, today included, falling on
 * the last day in a shorter month ("the 31st" in November is the 30th). The
 * anchor is the latest month that really has that day, so a monthly bill
 * counted from it comes back to the 31st instead of drifting to the 30th.
 */
function nextDayOfMonth(today: ISODate, day: number): Dated {
  const [y, m] = today.split("-").map(Number);
  let date = iso(y, m, day);
  if (date < today) {
    const [ny, nm] = addMonths(`${today.slice(0, 7)}-01`, 1).split("-").map(Number);
    date = iso(ny, nm, day);
  }
  let anchor = date;
  for (let i = 0; i < 12 && Number(anchor.slice(8)) !== day; i++) {
    const [ay, am] = addMonths(`${anchor.slice(0, 7)}-01`, -1).split("-").map(Number);
    anchor = iso(ay, am, day);
  }
  return { date, anchor };
}

/** "on the 5th", "Dec 12", "12/5", "tomorrow", "next friday", "in 2 weeks", "by June", "by June 2027". */
function takeDate(w: Words, today: ISODate, forDeadline = false): ISODate | null {
  return takeDated(w, today, forDeadline)?.date ?? null;
}

function takeDated(w: Words, today: ISODate, forDeadline = false): Dated | null {
  const found = readDate(w, today, forDeadline);
  return found === null ? null : typeof found === "string" ? { date: found } : found;
}

function readDate(w: Words, today: ISODate, forDeadline: boolean): ISODate | Dated | null {
  const [ty, tm] = today.split("-").map(Number);
  let m: RegExpExecArray | null;
  if ((m = w.take(/\b(?:on\s+|by\s+|due\s+|starting\s+)?(\d{4})-(\d{2})-(\d{2})\b/i))) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = w.take(/\b(?:on\s+|by\s+|due\s+)?(today|tonight)\b/i))) return today;
  if ((m = w.take(/\b(?:on\s+|by\s+|due\s+)?tomorrow\b/i))) return addDays(today, 1);
  if ((m = w.take(/\b(?:on\s+|by\s+|due\s+)?(?:next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)) || (m = w.take(/\b(?:on|by|due)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i))) {
    const target = DAYS.indexOf(m[1].toLowerCase());
    let d = addDays(today, 1);
    while (new Date(`${d}T12:00:00Z`).getUTCDay() !== target) d = addDays(d, 1);
    return d;
  }
  if ((m = w.take(/\b(?:in|within)\s+(\d{1,2}|a|one|two|three|six)\s+(day|week|month|year)s?\b/i))) {
    const n = { a: 1, one: 1, two: 2, three: 3, six: 6 }[m[1].toLowerCase()] ?? Number(m[1]);
    const unit = m[2].toLowerCase();
    return unit === "day" ? addDays(today, n) : unit === "week" ? addDays(today, 7 * n) : unit === "month" ? addMonths(today, n) : addMonths(today, 12 * n);
  }
  if ((m = w.take(/\b(?:by\s+)?next\s+(month|year)\b/i))) return m[1].toLowerCase() === "month" ? (forDeadline ? monthEnd(addMonths(today, 1).slice(0, 7)) : addMonths(today, 1)) : forDeadline ? `${ty + 1}-12-31` : addMonths(today, 12);
  // "Dec 12", "December 12th, 2027", "12 Dec"
  if ((m = w.take(new RegExp(`\\b(?:on\\s+|by\\s+|due\\s+)?${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i"))) || (m = w.take(new RegExp(`\\b(?:on\\s+|by\\s+|due\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?\\b`, "i")))) {
    const monthFirst = Number.isNaN(Number(m[1]));
    const mi = monthIndex(monthFirst ? m[1] : m[2]) + 1;
    const day = Number(monthFirst ? m[2] : m[1]);
    let year = m[3] ? Number(m[3]) : ty;
    if (!m[3] && iso(year, mi, day) < today) year++;
    return day >= 1 && day <= 31 ? iso(year, mi, day) : null;
  }
  // "by June", "by June 2027": the end of that month.
  if ((m = w.take(new RegExp(`\\b(?:by|in|before|until)\\s+${MONTH_RE}(?:\\s+(\\d{4}))?\\b`, "i")))) {
    const mi = monthIndex(m[1]) + 1;
    let year = m[2] ? Number(m[2]) : ty;
    if (!m[2] && (mi < tm || (mi === tm && forDeadline))) year++;
    return monthEnd(`${year}-${String(mi).padStart(2, "0")}`);
  }
  if ((m = w.take(/\b(?:by|in|before)\s+(20\d{2})\b/i))) return `${m[1]}-12-31`;
  // A goal's bare year ("trip 2027 3000") is its deadline, never its amount.
  if (forDeadline && (m = w.take(/\b(20\d{2})\b(?!\s*(?:dollars|bucks|usd))/i)) && Number(m[1]) >= Number(today.slice(0, 4))) return `${m[1]}-12-31`;
  // "12/5", "12/5/2027"
  if ((m = w.take(/\b(?:on\s+|by\s+|due\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const mo = Number(m[1]);
    const day = Number(m[2]);
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : ty;
    if (!m[3] && iso(year, mo, day) < today) year++;
    return iso(year, mo, day);
  }
  // "on the 5th", "the 1st of every month", "on the 15"
  if ((m = w.take(/\b(?:on\s+|by\s+|due\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+of\s+(?:the|each|every)\s+month)?\b/i)) || (m = w.take(/\b(?:on|by)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)) || (m = w.take(/\b(\d{1,2})(?:st|nd|rd|th)\b/i))) {
    const day = Number(m[1]);
    return day >= 1 && day <= 31 ? nextDayOfMonth(today, day) : null;
  }
  return null;
}

const FILLER_WORDS = ["please", "can you", "could you", "hey", "nickel", "for me", "i have", "i've got", "there's", "there is", "i need to", "i want to", "i'd like to", "we have", "a", "an", "my", "our", "the", "new", "add", "create", "make", "set up", "put in", "record", "bill", "bills", "subscription", "subscriptions", "payment", "upcoming", "one-time", "one time", "one-off", "one off", "coming up", "due", "for", "of", "called", "named", "that", "is", "it", "it's", "to my", "to", "starting", "beginning", "from"];
const fillerRe = (keep: string[]) => new RegExp(`\\b(?:${FILLER_WORDS.filter((f) => !keep.includes(f)).map((f) => f.replace(/[-']/g, (c) => `\\${c}`)).join("|")})\\b`, "gi");
const FILLER = fillerRe([]);
const GOAL_FILLER = fillerRe(["new"]);

/** What's left after the understood parts and filler words are taken out: the name. */
function nameFrom(rest: string, filler: RegExp = FILLER): string | null {
  const s = rest
    .replace(filler, " ")
    .replace(/[^\p{L}\p{N}&'’+.\- ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-.\s]+|[-.\s]+$/g, "");
  if (!s || !/\p{L}/u.test(s)) return null;
  // Typed all in lower case: capitalise the words. Otherwise keep their capitals ("iCloud", "HBO").
  const name = s === s.toLowerCase() ? s.replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase()) : s;
  return name.slice(0, 60);
}

const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
/** Words too common to point at one goal or loan on their own. */
const COMMON = new Set(["fund", "goal", "loan", "card", "account", "savings", "weeks", "payment", "down", "trip", "money", "bill", "plan", "new", "visa", "cashback"]);
/** The words of a name that are specific enough to recognise it by. */
const keyWords = (name: string) => plain(name).split(" ").filter((x) => x.length >= 4 && !COMMON.has(x));

/** The known name (a goal, a loan) that the text mentions, if any. Longest match wins. */
function mention(text: string, names: string[]): string | null {
  const t = ` ${plain(text)} `;
  const hits = names.filter((n) => {
    const key = plain(n);
    if (key && t.includes(` ${key} `)) return true;
    // "the emergency fund" for "Emergency fund", "japan" for "Two weeks in Japan".
    return keyWords(n).some((x) => t.includes(` ${x} `));
  });
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** "…to the emergency fund", "…toward Japan": money aimed at that goal, not just the goal's name somewhere. */
function aimedAt(text: string, goal: string): boolean {
  const options = [plain(goal), ...keyWords(goal)].filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(?:to|toward|towards|into|in|for|on)\\s+(?:the\\s+|my\\s+|our\\s+)?(?:\\S+\\s+){0,2}?(?:${options.join("|")})\\b`, "i").test(plain(text));
}

/** Words that mean a bill is being talked about, not money into a goal. */
const BILL_WORDS = /\b(?:bill|bills|subscription|insurance|payment|rent|membership|due|every|monthly|weekly|yearly|annually|quarterly|upcoming|one[- ]time|one[- ]off)\b/i;

/** How questions start: these are asked, not told. */
const QUESTION = /^(how|what|what'?s|whats|when|when'?s|where|which|who|why|is|isn'?t|are|am|do|does|did|can|could|should|would|will|have|has|was|were|any|show|tell|list|give)\b/;

export function parseCommand(input: string, ctx: CommandContext): Command | null {
  // "Can you add Netflix $15.99 on the 5th?" is "add Netflix $15.99 on the 5th".
  const polite = /^(?:(?:can|could|would|will) you\s+|please\s+)+(?=(?:add|put|make|create|rename|change|record|set up)\b)/i.exec(input.trim());
  if (polite) input = input.trim().slice(polite[0].length).replace(/\?+\s*$/, "");
  const command = parseInstruction(input, ctx);
  // Just a name ("rent", "netflix") with no amount, date or "add" is asking about it, not adding it.
  if (command && (command.kind === "bill" || command.kind === "upcoming") && command.amount === null && command.date === null && !/\b(add|new|create|remind|set up|track|upcoming)\b/i.test(input)) return null;
  return command;
}

function parseInstruction(input: string, ctx: CommandContext): Command | null {
  const text = input.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) return null;
  const lower = text.toLowerCase();

  // A question is never an instruction: "how much is my rent?" or "when is rent due" asks, and gets an
  // answer; "add rent $2,150 on the 1st" tells. (Only a question that plainly asks him to add or make
  // something, like "can you add rent $2,150?", is taken as one.)
  if ((QUESTION.test(lower) || text.endsWith("?")) && !/\b(add|new|create|make|set up|put|record|rename|change)\b/.test(lower)) return null;

  // Rename: "rename SQ *TARTINE to Tartine", "rename Venmo to Rent only at $1,200".
  const m = /^(?:please\s+)?(?:rename|change the name of)\s+(.+?)\s+(?:to|as|into)\s+(.+)$/i.exec(text) ?? /^(?:please\s+)?call\s+(.+?)\s+(?:instead\s+)?["“](.+)["”]$/i.exec(text);
  if (m) {
    const only = /\s+only\s+(?:at|for|when\s+it'?s|if\s+it'?s|when)\s+\$?\s?(\d[\d,]*(?:\.\d{1,2})?)\s*$/i.exec(m[2]) ?? /\s+(?:at|for|when\s+it'?s|if\s+it'?s)\s+\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*$/i.exec(m[2]);
    const to = (only ? m[2].slice(0, only.index) : m[2]).replace(/^["“]|["”]$/g, "").trim().slice(0, 60);
    const onlyAmount = only ? Math.round(Number(only[1].replace(/,/g, "")) * 100) : null;
    return { kind: "rename", from: m[1].replace(/^["“]|["”]$/g, "").trim() || null, to: to || null, onlyAmount: onlyAmount && onlyAmount > 0 ? onlyAmount : null };
  }
  if (/^rename\b/i.test(text)) return { kind: "rename", from: text.replace(/^rename\s*/i, "").trim() || null, to: null, onlyAmount: null };

  // Money into a goal: "add $200 to the emergency fund", "put 150 toward Japan". Only when the money is
  // aimed at the goal and nothing says it's a bill: "add emergency vet bill $400" is a bill.
  const goal = mention(text, ctx.goals);
  const withoutGoal = goal ? text.replace(new RegExp(plain(goal).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\W+"), "i"), " ") : text;
  const deadline = takeDate(new Words(withoutGoal), ctx.today, true) !== null;
  if (goal && /\b(?:add|put|move|save|saved|deposit|set aside|transfer|transferred|stash)\b/i.test(text) && aimedAt(text, goal) && !BILL_WORDS.test(withoutGoal) && !deadline && !/\b(?:new|create|goal for|start)\b/i.test(withoutGoal)) {
    const w = new Words(text);
    return { kind: "deposit", goal, amount: takeAmount(w) };
  }

  // A loan's rate or payment: "student loan rate is 4.5%", "pay $350 a month on the auto loan".
  // "Add student loan payment $300 on the 15th" is adding a bill, so a date or "add" sends it there.
  const loan = mention(text, ctx.loans);
  const hasDate = takeDate(new Words(text), ctx.today) !== null;
  if ((loan || /\bloan\b/i.test(text)) && /(%|percent|\brate\b|\binterest\b|\bapr\b|\bpay(?:ment|ing)?\b|\bminimum\b)/i.test(text) && !/\bbill\b/i.test(text) && !hasDate && !/^(?:please\s+)?(?:add|new|create)\b/i.test(text)) {
    const w = new Words(text);
    const aprPercent = takePercent(w);
    takeFrequency(w);
    const payment = /\bpay(?:ment|ing)?\b|\bminimum\b/i.test(text) ? takeAmount(w) : null;
    return { kind: "loan", loan, aprPercent, payment };
  }

  // A new goal: "new goal Japan $4,500 by June", "save $3,000 for a new roof by next year".
  if (/\b(?:goal|save up|saving up|saving for|save for|start saving)\b/i.test(lower) || (/^save\b/i.test(text) && /\bfor\b/i.test(text))) {
    const w = new Words(text);
    const date = takeDate(w, ctx.today, true);
    const target = takeAmount(w);
    // The words that say "make a goal" go; a name like "New roof" keeps its "New".
    w.take(/^(?:please\s+)?(?:(?:add|create|make|start|set\s+up)\s+)?(?:a\s+)?(?:new\s+)?(?:savings\s+)?goal(?:\s+(?:for|called|named))?:?(?=\s|$)/i);
    w.take(/\b(?:new\s+)?(?:savings\s+)?goal\b/i);
    w.take(/\b(?:save\s+up|saving\s+up|saving\s+for|save\s+for|start\s+saving(?:\s+for)?|save)\b/i);
    return { kind: "goal", name: nameFrom(w.text, GOAL_FILLER), target, date: date && date > ctx.today ? date : null };
  }

  // A bill: repeating unless it's clearly a one-off.
  const w = new Words(text);
  const frequency = takeFrequency(w);
  const dated = takeDated(w, ctx.today);
  const date = dated?.date ?? null;
  const amount = takeAmount(w);
  const oneOff = /\b(?:upcoming|one[- ]time|one[- ]off|once|just this once|coming up)\b/i.test(lower) || (!frequency && /\bdue\b/i.test(lower));
  const billish = frequency || oneOff || /\b(?:bill|subscription|payment|rent|insurance|membership)\b/i.test(lower) || (/^add\b/i.test(text) && amount !== null);
  if (!billish) return null;
  const name = nameFrom(w.text);
  if (oneOff && !frequency) return { kind: "upcoming", name, amount, date };
  return { kind: "bill", name, amount, frequency: frequency ?? "monthly", date, anchor: dated?.anchor ?? date };
}

/** The day of the month a monthly bill lands on, said the way people say it. */
export function ordinal(date: ISODate): string {
  const d = dayOfMonth(date);
  const suffix = d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th";
  return `${d}${suffix}`;
}
