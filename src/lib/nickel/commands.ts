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
  | { kind: "bill"; name: string | null; amount: number | null; frequency: BillFrequency; date: ISODate | null }
  | { kind: "upcoming"; name: string | null; amount: number | null; date: ISODate | null }
  | { kind: "goal"; name: string | null; target: number | null; date: ISODate | null }
  | { kind: "deposit"; goal: string | null; amount: number | null }
  | { kind: "loan"; loan: string | null; aprPercent: number | null; payment: number | null }
  | { kind: "rename"; from: string | null; to: string | null };

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

/** "$15.99", "15.99", "2,150", "1.5k", "$40 dollars" → cents. */
function takeAmount(w: Words): number | null {
  const m = w.take(/(?:^|\s)(?:\$\s?(\d[\d,]*(?:\.\d{1,2})?)(k)?|(\d[\d,]*(?:\.\d{1,2})?)(k)?\s*(?:dollars|bucks|usd)|(\d[\d,]*\.\d{1,2})|(\d{1,3}(?:,\d{3})+|\d{2,})(k)?)(?=\s|$|[.,!?])/i);
  if (!m) return null;
  const raw = (m[1] ?? m[3] ?? m[5] ?? m[6] ?? "").replace(/,/g, "");
  const k = m[2] ?? m[4] ?? m[7];
  const value = Number(raw) * (k ? 1000 : 1);
  return Number.isFinite(value) && value > 0 && value < 100_000_000 ? Math.round(value * 100) : null;
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

/** The next time a day of the month comes round, today included. */
function nextDayOfMonth(today: ISODate, day: number): ISODate {
  const [y, m] = today.split("-").map(Number);
  const thisMonth = iso(y, m, day);
  if (thisMonth >= today) return thisMonth;
  const next = addMonths(`${today.slice(0, 7)}-01`, 1);
  const [ny, nm] = next.split("-").map(Number);
  return iso(ny, nm, day);
}

/** "on the 5th", "Dec 12", "12/5", "tomorrow", "next friday", "in 2 weeks", "by June", "by June 2027". */
function takeDate(w: Words, today: ISODate, forDeadline = false): ISODate | null {
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
  if ((m = w.take(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+of\s+(?:the|each|every)\s+month)?\b/i)) || (m = w.take(/\bon\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)) || (m = w.take(/\b(\d{1,2})(?:st|nd|rd|th)\b/i))) {
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

/** The known name (a goal, a loan) that the text mentions, if any. Longest match wins. */
function mention(text: string, names: string[]): string | null {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ")} `;
  const hits = names.filter((n) => {
    const key = n.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
    if (key && t.includes(` ${key} `)) return true;
    // "the emergency fund" for "Emergency fund", "auto loan" for "Auto Loan", "japan" for "Two weeks in Japan".
    const words = key.split(" ").filter((x) => x.length >= 4 && !["fund", "goal", "loan", "card", "account", "savings", "weeks"].includes(x));
    return words.length > 0 && words.some((x) => t.includes(` ${x} `));
  });
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function parseCommand(input: string, ctx: CommandContext): Command | null {
  const text = input.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) return null;
  const lower = text.toLowerCase();

  // Rename: "rename SQ *TARTINE to Tartine", "call PGANDE Electric bill".
  const m = /^(?:please\s+)?(?:rename|change the name of)\s+(.+?)\s+(?:to|as|into)\s+(.+)$/i.exec(text) ?? /^(?:please\s+)?call\s+(.+?)\s+(?:instead\s+)?["“](.+)["”]$/i.exec(text);
  if (m) return { kind: "rename", from: m[1].replace(/^["“]|["”]$/g, "").trim() || null, to: m[2].replace(/^["“]|["”]$/g, "").trim().slice(0, 60) || null };
  if (/^rename\b/i.test(text)) return { kind: "rename", from: text.replace(/^rename\s*/i, "").trim() || null, to: null };

  // Money into a goal: "add $200 to the emergency fund", "put 150 toward Japan".
  const goal = mention(text, ctx.goals);
  if (goal && /\b(?:add|put|move|save|saved|deposit|set aside|transfer)\b/i.test(text) && !/\b(?:new|create|goal for|start)\b/i.test(text)) {
    const w = new Words(text);
    return { kind: "deposit", goal, amount: takeAmount(w) };
  }

  // A loan's rate or payment: "student loan rate is 4.5%", "pay $350 a month on the auto loan".
  const loan = mention(text, ctx.loans);
  if ((loan || /\bloan\b/i.test(text)) && /(%|percent|\brate\b|\binterest\b|\bapr\b|\bpay(?:ment|ing)?\b|\bminimum\b)/i.test(text) && !/\bbill\b/i.test(text)) {
    const w = new Words(text);
    const aprPercent = takePercent(w);
    takeFrequency(w);
    const payment = /\bpay(?:ment|ing)?\b|\bminimum\b/i.test(text) ? takeAmount(w) : null;
    return { kind: "loan", loan, aprPercent, payment };
  }

  // A new goal: "new goal Japan $4,500 by June", "save $3,000 for a new roof by next year".
  if (/\b(?:goal|save up|saving up|saving for|save for|start saving)\b/i.test(lower) || (/^save\b/i.test(text) && /\bfor\b/i.test(text))) {
    const w = new Words(text);
    const target = takeAmount(w);
    const date = takeDate(w, ctx.today, true);
    // The words that say "make a goal" go; a name like "New roof" keeps its "New".
    w.take(/^(?:please\s+)?(?:(?:add|create|make|start|set\s+up)\s+)?(?:a\s+)?(?:new\s+)?(?:savings\s+)?goal(?:\s+(?:for|called|named))?:?(?=\s|$)/i);
    w.take(/\b(?:new\s+)?(?:savings\s+)?goal\b/i);
    w.take(/\b(?:save\s+up|saving\s+up|saving\s+for|save\s+for|start\s+saving(?:\s+for)?|save)\b/i);
    return { kind: "goal", name: nameFrom(w.text, GOAL_FILLER), target, date: date && date > ctx.today ? date : null };
  }

  // A bill: repeating unless it's clearly a one-off.
  const w = new Words(text);
  const frequency = takeFrequency(w);
  const amount = takeAmount(w);
  const date = takeDate(w, ctx.today);
  const oneOff = /\b(?:upcoming|one[- ]time|one[- ]off|once|just this once|coming up)\b/i.test(lower) || (!frequency && /\bdue\b/i.test(lower));
  const billish = frequency || oneOff || /\b(?:bill|subscription|payment|rent|insurance|membership)\b/i.test(lower) || (/^add\b/i.test(text) && amount !== null);
  if (!billish) return null;
  const name = nameFrom(w.text);
  if (oneOff && !frequency) return { kind: "upcoming", name, amount, date };
  return { kind: "bill", name, amount, frequency: frequency ?? "monthly", date: date ?? (frequency === "monthly" || !frequency ? null : null) };
}

/** The day of the month a monthly bill lands on, said the way people say it. */
export function ordinal(date: ISODate): string {
  const d = dayOfMonth(date);
  const suffix = d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th";
  return `${d}${suffix}`;
}
