import { merchantKey } from "./recurring";

/*
 * Names for transactions and bills. Banks write things like
 * "SQ *TARTINE BAKERY 0423 SAN FRANCISCO CA"; people want "Tartine Bakery".
 *
 * Three layers, the first that applies wins:
 *  1. A name given to one transaction only ("just this one").
 *  2. A name rule: "every charge the bank calls X is Y", optionally only at
 *     one exact amount (for Venmo and the like, where the same name pays for
 *     different things).
 *  3. An automatic tidy-up of bank code, used only when the bank's text looks
 *     like code. Clear names are left exactly as they are.
 *
 * Nothing here changes what the bank sent: the original text is kept and shown
 * in the transaction's details, and matching keys stay based on it, so bills,
 * remembered categories and the Tasks for Two link never notice a rename.
 * Pure, so it's tested and works the same on sample data.
 */

export type NameRule = {
  id: string;
  /** ruleKey() of the bank's text: direction plus the tidied name, like "out:tartine bakery". */
  key: string;
  /** Signed cents. 0 means any amount (in the same direction). */
  amount: number;
  name: string;
};

export type NameSource = "custom" | "rule" | "clean" | "bank";

/** `exact` is true when the rule only covers one amount. */
export type ResolvedName = { name: string; source: NameSource; ruleId: string | null; exact: boolean };

export const MAX_NAME_LENGTH = 60;

/* ---------- spotting bank code ---------- */

const NOISE_START = /^(?:pos|dbt|debit|purchase|checkcard|check card|visa|ach|recurring|recur|online|web|mobile|pmt|payment to|preauth(?:orized)?|card purchase|sale|bill pay(?:ment)?|dda)\b[\s:.-]*/i;
const AUTHORIZED_ON = /^(?:purchase\s+)?authorized\s+on\s+\d{1,2}\/\d{1,2}\s*/i;
const LEADING_DATE = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+/;
/** Card processors that put their code in front of the shop's name. */
const PROCESSOR = /^(?:sq|sqsp|squ|tst|sp|pp|dd|py|bt|ec|in|par|ckf|tcb|cke|fsp|gpm|pt|wpy|ppl|wf|paypal|google|goog)\s?\*\s*/i;
/** A store number or reference code at the start ("1102 BLUE BOTTLE"), but not "24 HOUR FITNESS". */
const LEADING_CODE = /^(?:(?:#\S*|\d{4,}\S*)\s+)+/;
/** Money sent between people: the name after it is the person, so it's kept. */
const PEOPLE_APPS: [RegExp, string][] = [
  [/^venmo\b\s*\*?\s*/i, "Venmo"],
  [/^zelle\b\s*\*?\s*/i, "Zelle"],
  [/^(?:cash app|square cash|sq \*?cash)\b\s*\*?\s*/i, "Cash App"],
  [/^apple cash\b\s*/i, "Apple Cash"],
  [/^paypal\b(?!\s*\*)\s*/i, "PayPal"],
];
const PEOPLE_FILLER = /^(?:payments?|pmt|to|from|sent|received|transfer|xfer|inst|id|web|instant|request|cashout)\b\s*/i;

const STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR".split(" "),
);
/** State codes that are also everyday words, so never taken off the end of a name. */
const WORD_STATES = new Set(["IN", "OR", "ME", "OK", "HI"]);
/** Short names that are written in capitals on purpose. */
const KEEP_UPPER = new Set(["ATM", "CVS", "REI", "AMC", "BP", "KFC", "HBO", "ESPN", "DMV", "IRS", "USAA", "USPS", "UPS", "IKEA", "TJ", "ACH", "ATT", "AT&T", "H&M", "LA", "NYC", "SF", "US", "USA", "HSA", "FSA", "IRA", "TV", "ABC", "NBC", "BBQ"]);
const SMALL_WORDS = new Set(["of", "and", "the", "at", "for", "to", "in", "on", "by", "a", "ending"]);
/** Words banks add around a well-known name that say nothing about who it was. */
const CODE_WORDS = new Set(["mktp", "mktpl", "mktplace", "marketplace", "us", "usa", "com", "bill", "billing", "help", "pending", "store", "stores", "inc", "llc", "co", "corp", "payment", "pmt", "recurring", "purchase", "membership", "subscription", "subscr", "sub", "online", "www", "trip", "whse", "pharmacy", "wrls", "wireless", "po", "digital", "services", "svcs", "intl", "ca", "na"]);

/** Well-known names whose bank text varies wildly. Used only when what follows the name is code. */
const ALIASES: [RegExp, string][] = [
  [/^amzn digital|^amazon digital/i, "Amazon Digital"],
  [/^(?:amzn|amazon)\s*prime\s*video|^prime video/i, "Prime Video"],
  [/^(?:amzn|amazon)\s*prime/i, "Amazon Prime"],
  [/^amazon\.com|^amzn\.com|^amzn\b|^amazon\b/i, "Amazon"],
  [/^apple\.com|^apple com\b|^itunes/i, "Apple"],
  [/^youtube\s*tv/i, "YouTube TV"],
  [/^youtube\s*premium/i, "YouTube Premium"],
  [/^youtube\s*music/i, "YouTube Music"],
  [/^youtube/i, "YouTube"],
  [/^netflix/i, "Netflix"],
  [/^spotify/i, "Spotify"],
  [/^uber\s*\*?\s*eats/i, "Uber Eats"],
  [/^uber\b/i, "Uber"],
  [/^lyft\b/i, "Lyft"],
  [/^doordash/i, "DoorDash"],
  [/^starbucks/i, "Starbucks"],
  [/^wal-?mart|^wm supercenter/i, "Walmart"],
  [/^target\b|^tgt\b/i, "Target"],
  [/^costco/i, "Costco"],
  [/^instacart/i, "Instacart"],
  [/^hulu/i, "Hulu"],
  [/^disney\s*(?:plus|\+)/i, "Disney+"],
  [/^comcast|^xfinity/i, "Xfinity"],
  [/^verizon/i, "Verizon"],
  [/^t-?mobile/i, "T-Mobile"],
  [/^at&t|^att\b/i, "AT&T"],
  [/^geico/i, "Geico"],
  [/^chevron/i, "Chevron"],
  [/^shell\s+(?:oil|service)/i, "Shell"],
  [/^patreon/i, "Patreon"],
  [/^steamgames|^steam\s+(?:games|purchase)|^valve\b/i, "Steam"],
  [/^mc\s?donald'?s?/i, "McDonald’s"],
  [/^chick-?fil-?a/i, "Chick-fil-A"],
  [/^cvs/i, "CVS Pharmacy"],
  [/^walgreens/i, "Walgreens"],
  [/^7-?eleven|^7 eleven/i, "7-Eleven"],
  [/^usps/i, "USPS"],
  [/^ebay/i, "eBay"],
  [/^etsy/i, "Etsy"],
  [/^audible/i, "Audible"],
  [/^openai|^chatgpt/i, "OpenAI"],
  [/^claude\.ai|^anthropic/i, "Claude"],
];

const hasCode = (w: string) => /[#*]/.test(w) || (w.match(/\d/g)?.length ?? 0) >= 4 || (/\d/.test(w) && /[a-z]/i.test(w)) || /\.(?:com|net|org|ai|io|co)\b|^\./i.test(w);

/** True when nothing after a well-known name says who it was: only codes, places or filler. */
function codeTail(rest: string): boolean {
  for (const raw of rest.split(/\s+/).filter(Boolean)) {
    if (hasCode(raw) || /^\d+$/.test(raw)) return true; // from here on it's reference code and place names
    const w = raw.replace(/[^a-z&]/gi, "").toLowerCase();
    if (w && !CODE_WORDS.has(w) && !STATES.has(w.toUpperCase())) return false;
  }
  return true;
}

function aliasFor(s: string): string | null {
  for (const [pattern, alias] of ALIASES) {
    const m = pattern.exec(s);
    if (m && codeTail(s.slice(m.index + m[0].length))) return alias;
  }
  return null;
}

/**
 * True when a name looks like bank code rather than something a person would
 * write: reference numbers, processor stars, or a long run of capitals.
 */
export function looksUnclear(name: string): boolean {
  const s = name.trim();
  if (!s) return false;
  if (/[*#]/.test(s)) return true;
  if (/\d{3,}/.test(s)) return true;
  if (/\.(?:com|net|org)\b|\bwww\./i.test(s)) return true;
  if (AUTHORIZED_ON.test(s) || LEADING_DATE.test(s)) return true;
  const letters = s.replace(/[^A-Za-z]/g, "");
  const upper = s.replace(/[^A-Z]/g, "");
  if (letters.length >= 4 && upper.length / letters.length >= 0.85) {
    // "REI" or "IKEA" alone are fine; "UBER TRIP" or "FIBERLINE INTERNET" aren't.
    const words = s.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
    return !(words.length === 1 && KEEP_UPPER.has(words[0].toUpperCase()));
  }
  return false;
}

function titleWord(word: string, first: boolean): string {
  const bare = word.replace(/[^A-Za-z&]/g, "").toUpperCase();
  if (KEEP_UPPER.has(bare) && bare.length > 0) return word.toUpperCase();
  if (/&/.test(word) && word.length <= 4) return word.toUpperCase();
  const lower = word.toLowerCase();
  if (!first && SMALL_WORDS.has(lower)) return lower;
  // Capitalise each part of "chick-fil-a" and the start of "o'brien", but not the "s" in "joe's".
  return lower.replace(/(^|[-/(])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase()).replace(/'([a-z]{2,})/g, (_, rest: string) => `'${rest[0].toUpperCase()}${rest.slice(1)}`);
}

const titleCase = (words: string[]) => words.map((w, i) => titleWord(w, i === 0)).join(" ");

/** Where the name ends and the store number, phone number, reference code or place begins. */
function cutAt(words: string[]): number {
  return words.findIndex((w, i) => {
    if (i === 0) return false;
    if (hasCode(w)) return true;
    // A short plain number is a store number when it ends the text or comes before a place ("123 SEATTLE WA"),
    // but part of the name in "ROUTE 101 DINER".
    if (/^\d{1,3}$/.test(w)) {
      const tail = words.slice(i + 1);
      return tail.length === 0 || STATES.has(tail[tail.length - 1].toUpperCase());
    }
    return false;
  });
}

/**
 * A readable version of a bank's text. Clear names come back unchanged, so
 * this is safe to apply to every name, any number of times.
 */
/**
 * A round-up: the spare change from a purchase moved from checking into savings (SoFi does this after each
 * card purchase). It shows up twice, a few cents out of checking and the same into the vault, named after
 * the store, so it reads like a tiny purchase and a refund. It's a transfer under a dollar between bank
 * accounts, or one the bank calls "Roundup".
 */
export function isRoundUp(t: { amount: number; category: string; name: string; rawName: string | null; accountType: string }): boolean {
  if (t.category !== "transfer" || t.accountType !== "depository" || t.amount === 0) return false;
  return Math.abs(t.amount) < 100 || /^round\s*-?\s*up\b/i.test(t.rawName ?? t.name);
}

const ROUND_UP = /^round\s*-?\s*up\s*\*?\s*/i;

/**
 * "Round-up from Ingles Markets" (into savings) or "Round-up for Ingles Markets" (out of checking): the
 * store from the shown name, or from the bank's text when the shown name lost it ("Roundup *RICE AND…").
 */
export function roundUpName(amount: number, shown: string, bankText: string): string {
  const fromShown = shown.replace(ROUND_UP, "").trim();
  const fromBank = bankText.replace(ROUND_UP, "").trim();
  const tidy = (t: string) => cleanName(t).toLowerCase().replace(/(^|[\s/&-])([a-z])/g, (_, gap: string, c: string) => gap + c.toUpperCase());
  const place = fromShown && !ROUND_UP.test(shown) ? fromShown : fromBank ? tidy(fromBank) : "a purchase";
  return `Round-up ${amount > 0 ? "from" : "for"} ${place}`;
}

export function cleanName(name: string): string {
  const original = name.replace(/\s+/g, " ").trim();
  if (!looksUnclear(original)) return original;

  let s = original.replace(AUTHORIZED_ON, "").replace(LEADING_DATE, "");
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(NOISE_START, "").replace(LEADING_CODE, "").trim();
    if (!PEOPLE_APPS.some(([p]) => p.test(s))) s = s.replace(PROCESSOR, "").trim();
    if (s === before) break;
  }

  // Money to or from a person: "ZELLE PAYMENT TO JOHN SMITH 1234" is "Zelle John Smith".
  for (const [pattern, label] of PEOPLE_APPS) {
    if (!pattern.test(s)) continue;
    let rest = s.replace(pattern, "");
    for (let i = 0; i < 4; i++) rest = rest.replace(PEOPLE_FILLER, "");
    const words = rest.split(/[\s*]+/).filter(Boolean);
    const cut = words.findIndex((w) => hasCode(w) || /^\d+$/.test(w));
    const who = (cut === -1 ? words : words.slice(0, cut)).slice(0, 3);
    return who.length > 0 && who.join("").replace(/[^a-z]/gi, "").length >= 2 ? `${label} ${titleCase(who)}`.slice(0, MAX_NAME_LENGTH) : label;
  }

  const alias = aliasFor(s);
  if (alias) return alias;

  const masked = /\bending\s+in\s+(\d{2,4})\b/i.exec(s);
  // Anything after a processor star is a reference code.
  if (s.includes("*")) s = s.split("*")[0].trim() || s.replace(/\*/g, " ");
  s = s.replace(/\bwww\./gi, "").replace(/\.(?:com|net|org)\b.*$/i, "");

  const words = s.split(/\s+/).filter(Boolean);
  const cut = cutAt(words);
  let kept = cut === -1 ? words : words.slice(0, cut);

  // A state at the end ("... OAKLAND CA") is the bank saying where, not who.
  const last = () => kept[kept.length - 1];
  while (kept.length > 1 && last().length === 2 && STATES.has(last().toUpperCase()) && !WORD_STATES.has(last().toUpperCase())) kept = kept.slice(0, -1);
  while (kept.length > 1 && /^(?:llc|inc|corp|co|ltd)\.?$/i.test(last())) kept = kept.slice(0, -1);
  // "CARD ENDING IN 1234" keeps its last four digits, which is how people tell cards apart.
  if (masked) {
    while (kept.length > 1 && /^(?:ending|in)$/i.test(last())) kept = kept.slice(0, -1);
    kept = [...kept, "ending", masked[1]];
  }

  const tidy = kept.join(" ").replace(/[\s\-–:,./]+$/g, "").replace(/^[\s\-–:,./]+/g, "").trim();
  const letters = tidy.replace(/[^A-Za-z]/g, "");
  // Too little left to be a name (a lone code or a state): better to show what the bank sent.
  if (letters.length < 3 || STATES.has(tidy.toUpperCase()) || (kept.length === 1 && /\d/.test(kept[0]))) return original;
  return titleCase(tidy.split(" ")).slice(0, MAX_NAME_LENGTH);
}

/** The tidied bank text boiled down: "SQ *BLUE BOTTLE 0423 OAKLAND CA" and "… 1102 SAN JOSE CA" match. */
export function nameKey(bankName: string): string {
  return merchantKey(cleanName(bankName)) || merchantKey(bankName);
}

/** What a name rule matches on: money in or out, plus the tidied bank text. */
export function ruleKey(bankName: string, amount: number): string {
  const key = nameKey(bankName);
  return key ? `${amount > 0 ? "in" : "out"}:${key}` : "";
}

/** The shape every stored rule key has. */
export const RULE_KEY_PATTERN = /^(?:in|out):[a-z& ]{1,200}$/;

/** Checks a name someone typed. Returns the tidied name, or null when it can't be used. */
export function validName(input: string): string | null {
  const s = input
    .replace(/[\t\n\r]/g, " ")
    // Control and formatting characters (including text-direction tricks) and characters that look like nothing.
    .replace(/[\p{Cc}\p{Cf}ᅟᅠㅤﾠ⠀]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || s.length > MAX_NAME_LENGTH || !/[\p{L}\p{N}]/u.test(s)) return null;
  return s;
}

/**
 * Builds a function that gives any transaction its name, from the person's
 * rules. Bank text is tidied once per distinct name.
 */
export function namer(rules: NameRule[]) {
  const byKey = new Map<string, NameRule[]>();
  for (const r of rules) {
    const list = byKey.get(r.key);
    if (list) list.push(r);
    else byKey.set(r.key, [r]);
  }
  const cache = new Map<string, { key: string; clean: string }>();
  const look = (bankName: string, amount: number) => {
    const id = `${amount > 0 ? "+" : "-"}${bankName}`;
    let hit = cache.get(id);
    if (!hit) {
      const clean = cleanName(bankName);
      const key = merchantKey(clean) || merchantKey(bankName);
      hit = { key: key ? `${amount > 0 ? "in" : "out"}:${key}` : "", clean };
      cache.set(id, hit);
    }
    return hit;
  };
  const resolve = (t: { name: string; amount: number; customName?: string | null }): ResolvedName => {
    if (t.customName) return { name: t.customName, source: "custom", ruleId: null, exact: false };
    const { key, clean } = look(t.name, t.amount);
    const list = byKey.get(key);
    const rule = list?.find((r) => r.amount !== 0 && r.amount === t.amount) ?? list?.find((r) => r.amount === 0);
    if (rule) return { name: rule.name, source: "rule", ruleId: rule.id, exact: rule.amount !== 0 };
    return { name: clean, source: clean === t.name ? "bank" : "clean", ruleId: null, exact: false };
  };
  return Object.assign(resolve, {
    /** The name for a bank text in one direction, ignoring rules that only cover one amount. */
    base: (bankName: string, incoming: boolean): ResolvedName => {
      const { key, clean } = look(bankName, incoming ? 1 : -1);
      const rule = byKey.get(key)?.find((r) => r.amount === 0);
      if (rule) return { name: rule.name, source: "rule", ruleId: rule.id, exact: false };
      return { name: clean, source: clean === bankName ? "bank" : "clean", ruleId: null, exact: false };
    },
    keyOf: (bankName: string, amount: number) => look(bankName, amount).key,
    exactRules: rules.filter((r) => r.amount !== 0),
  });
}

export type Namer = ReturnType<typeof namer>;
