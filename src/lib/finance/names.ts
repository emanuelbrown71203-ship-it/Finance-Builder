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
  /** nameKey() of the bank's text. */
  key: string;
  /** Signed cents. 0 means any amount. */
  amount: number;
  name: string;
};

export type NameSource = "custom" | "rule" | "clean" | "bank";

/** `exact` is true when the rule only covers one amount. */
export type ResolvedName = { name: string; source: NameSource; ruleId: string | null; exact: boolean };

export const MAX_NAME_LENGTH = 60;

/* ---------- spotting bank code ---------- */

const NOISE_START = /^(?:pos|dbt|debit|purchase|checkcard|check card|visa|mc|ach|recurring|recur|online|web|mobile|pmt|payment to|preauth(?:orized)?|card|sale|bill pay(?:ment)?|dda)\b[\s:.-]*/i;
const AUTHORIZED_ON = /^(?:purchase\s+)?authorized\s+on\s+\d{1,2}\/\d{1,2}\s*/i;
const LEADING_DATE = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+/;
/** Card processors that put their code in front of the shop's name. */
const PROCESSOR = /^(?:sq|sqsp|squ|tst|sp|pp|dd|py|bt|ec|in|par|ckf|tcb|cke|fsp|gpm|pt|wpy|ppl|wf|paypal|google|goog|amzn digital)\s?\*\s*/i;

const STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR".split(" "),
);
/** Short names that are written in capitals on purpose. */
const KEEP_UPPER = new Set(["ATM", "CVS", "REI", "AMC", "BP", "KFC", "HBO", "ESPN", "DMV", "IRS", "USAA", "USPS", "UPS", "IKEA", "TJ", "ACH", "ATT", "AT&T", "H&M", "LA", "NYC", "SF", "US", "USA", "HSA", "FSA", "IRA", "TV", "ABC", "NBC", "BBQ"]);
const SMALL_WORDS = new Set(["of", "and", "the", "at", "for", "to", "in", "on", "by", "a"]);

/** Well-known names whose bank text varies wildly. Checked only on text that already looks like code. */
const ALIASES: [RegExp, string][] = [
  [/^(?:amzn|amazon)\s*(?:prime|prime\s*video)\b|^prime video\b/i, "Amazon Prime"],
  [/^amzn\b|^amazon\b|^amazon\.com|^amzn\.com/i, "Amazon"],
  [/^apple\.com|^apple com\b|^itunes/i, "Apple"],
  [/youtube/i, "YouTube"],
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
  [/^venmo\b/i, "Venmo"],
  [/^zelle\b/i, "Zelle"],
  [/^paypal\b/i, "PayPal"],
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
  [/^mcdonald/i, "McDonald’s"],
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

/**
 * A readable version of a bank's text. Clear names come back unchanged, so
 * this is safe to apply to every name, any number of times.
 */
export function cleanName(name: string): string {
  const original = name.replace(/\s+/g, " ").trim();
  if (!looksUnclear(original)) return original;

  let s = original.replace(AUTHORIZED_ON, "").replace(LEADING_DATE, "");
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(NOISE_START, "").replace(PROCESSOR, "").replace(/^(?:[\d#]+\s+)+/, "").trim();
    if (s === before) break;
  }

  for (const [pattern, alias] of ALIASES) if (pattern.test(s)) return alias;

  // Anything after a processor star is a reference code.
  if (s.includes("*")) s = s.split("*")[0].trim() || s.replace(/\*/g, " ");
  s = s.replace(/\bwww\./gi, "").replace(/\.(?:com|net|org)\b.*$/i, "");

  // Cut at the first store number, phone number or reference code.
  const words = s.split(/\s+/).filter(Boolean);
  const cut = words.findIndex((w, i) => i > 0 && /[0-9#]/.test(w));
  let kept = cut === -1 ? words : words.slice(0, cut);
  if (kept.length === 1 && /\d/.test(kept[0]) && words.length > 1) kept = words.filter((w) => !/\d/.test(w)).slice(0, 3);

  // A state at the end ("... OAKLAND CA") is the bank saying where, not who.
  while (kept.length > 1 && STATES.has(kept[kept.length - 1].toUpperCase()) && kept[kept.length - 1].length === 2) kept = kept.slice(0, -1);
  while (kept.length > 1 && /^(?:llc|inc|corp|co|ltd)\.?$/i.test(kept[kept.length - 1])) kept = kept.slice(0, -1);

  const tidy = kept
    .join(" ")
    .replace(/[\s\-–:,./]+$/g, "")
    .replace(/^[\s\-–:,./]+/g, "")
    .trim();
  if (!tidy || !/[A-Za-z]/.test(tidy)) return original;
  return tidy
    .split(" ")
    .map((w, i) => titleWord(w, i === 0))
    .join(" ")
    .slice(0, MAX_NAME_LENGTH);
}

/**
 * What a name rule matches on: the tidied bank text, boiled down. So
 * "SQ *BLUE BOTTLE 0423 OAKLAND CA" and "SQ *BLUE BOTTLE 1102 SAN JOSE CA"
 * count as the same place.
 */
export function nameKey(bankName: string): string {
  return merchantKey(cleanName(bankName)) || merchantKey(bankName);
}

/** Checks a name someone typed. Returns the tidied name, or null when it can't be used. */
export function validName(input: string): string | null {
  const s = input.replace(/[\t\n\r]/g, " ").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();
  if (!s || s.length > MAX_NAME_LENGTH) return null;
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
  const look = (bankName: string) => {
    let hit = cache.get(bankName);
    if (!hit) {
      hit = { key: nameKey(bankName), clean: cleanName(bankName) };
      cache.set(bankName, hit);
    }
    return hit;
  };
  return (t: { name: string; amount: number; customName?: string | null }): ResolvedName => {
    if (t.customName) return { name: t.customName, source: "custom", ruleId: null, exact: false };
    const { key, clean } = look(t.name);
    const list = byKey.get(key);
    const rule = list?.find((r) => r.amount !== 0 && r.amount === t.amount) ?? list?.find((r) => r.amount === 0);
    if (rule) return { name: rule.name, source: "rule", ruleId: rule.id, exact: rule.amount !== 0 };
    return { name: clean, source: clean === t.name ? "bank" : "clean", ruleId: null, exact: false };
  };
}

export type Namer = ReturnType<typeof namer>;

/** True when a rule applies to a transaction (used to count and preview what a rule changes). */
export function ruleMatches(rule: { key: string; amount: number }, t: { name: string; amount: number }): boolean {
  return nameKey(t.name) === rule.key && (rule.amount === 0 || rule.amount === t.amount);
}
