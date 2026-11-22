import type { CategoryKey } from "../categories";
import { addMonthsToMonth, monthOf, type ISODate } from "../dates";

/*
 * Reading an Apple Card statement. Apple doesn't let websites link Apple Card
 * (it shares it only with App Store apps), but the Wallet app and
 * card.apple.com export each month's transactions as a spreadsheet (CSV).
 * This turns that into Passbook's own shape: whole cents, money out negative,
 * a category, the merchant's name and the statement's text.
 *
 * Only Apple's own spreadsheet is accepted (its columns are checked), so
 * another bank's file can't be read the wrong way round. Apple's OFX file
 * isn't: it has no categories, and dates it differently, so mixing the two
 * could bring a month in twice.
 *
 * Every purchase gets a key from the day it was made, the day it cleared, its
 * amount, and how many identical ones came before it, so bringing in the same
 * month twice never doubles anything, while two identical coffees that land
 * on different statements stay two. Purchases that haven't cleared yet are
 * left for the next statement.
 */

export type ImportedRow = {
  date: ISODate;
  /** The day it cleared: part of its key. */
  cleared: ISODate;
  /** The merchant, when the statement names one; otherwise its own text. */
  name: string;
  /** The statement's own text, kept as it came. */
  rawName: string;
  /** Cents, money out negative. */
  amount: number;
  category: CategoryKey;
};

export type ParsedStatement = {
  rows: ImportedRow[];
  /** Purchases in the file that haven't cleared yet: left out until a later statement. */
  pending: number;
  /** Those purchases' dates and amounts, so a tap waiting for one of them isn't mistaken for one that never went through. */
  uncleared: { date: ISODate; amount: number }[];
};

/** A problem with the file itself, worded for the person who picked it. */
export class StatementError extends Error {}

const NOT_APPLE = "That file doesn’t look like an Apple Card export. In Wallet, open Apple Card, tap Card Balance, pick a monthly statement, tap Export Transactions and choose CSV.";
const NOT_CSV = "That’s Apple’s OFX file. Export the statement again and choose CSV: it has the categories, so purchases land in the right place.";
/** More than any card's year of statements: a file this long is something else. */
const MAX_ROWS = 5000;
/** $10 million: an amount past this is a misread file, not a purchase. */
const MAX_CENTS = 1_000_000_000;

/** Splits a spreadsheet file into rows of fields: quoted fields may hold commas, line breaks and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/** "1,204.10", "$6.50", "-500.00" → cents. Null when it isn't a sensible number. */
function toCents(raw: string): number | null {
  const clean = raw.replace(/[$,\s]/g, "");
  if (!/^[-+]?\d{1,12}(\.\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return Math.abs(cents) > MAX_CENTS ? null : cents + 0;
}

function usDate(raw: string): ISODate | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [Number(m[3]), Number(m[1]), Number(m[2])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The categories Apple Card puts on purchases, matched loosely so a renamed one still lands sensibly. */
const APPLE_CATEGORIES: [RegExp, CategoryKey][] = [
  [/restaurant|food|dining|coffee|\bbars?\b/, "dining"],
  [/grocer|supermarket/, "groceries"],
  [/\bgas\b|fuel|transport|parking|transit|taxi|rideshare|auto|toll/, "transport"],
  [/airline|hotel|travel|lodging|rental car/, "travel"],
  [/entertainment|streaming|music|movie|game/, "entertainment"],
  [/health|medical|pharmac|doctor|dental|fitness/, "health"],
  [/utilit|phone|internet|cable|electric|water/, "utilities"],
  [/insurance/, "insurance"],
  [/shopping|merchandise|electronic|clothing|retail|department/, "shopping"],
  [/personal|beauty|salon|\bspa\b/, "personal"],
  [/donation|charit|gift/, "giving"],
  [/interest|fee/, "fees"],
];

function categoryFor(label: string): CategoryKey {
  const l = label.toLowerCase();
  return APPLE_CATEGORIES.find(([pattern]) => pattern.test(l))?.[1] ?? "other";
}

/** Apple's spreadsheet columns, all of which must be there. */
const COLUMNS = ["transaction date", "clearing date", "description", "merchant", "category", "type", "amount (usd)"] as const;

/** Reads Apple Card's exported spreadsheet. Throws StatementError, in plain words, when it can't. */
export function parseStatement(text: string): ParsedStatement {
  const body = text.replace(/^﻿/, "");
  if (!body.trim()) throw new StatementError(NOT_APPLE);
  if (/<OFX>|^OFXHEADER/im.test(body)) throw new StatementError(NOT_CSV);
  const [header, ...lines] = parseCsv(body);
  const names = (header ?? []).map((h) => h.trim().toLowerCase());
  const at = Object.fromEntries(COLUMNS.map((c) => [c, names.indexOf(c)])) as Record<(typeof COLUMNS)[number], number>;
  if (COLUMNS.some((c) => at[c] < 0)) throw new StatementError(NOT_APPLE);
  if (lines.length > MAX_ROWS) throw new StatementError("That file has more transactions than a card statement would. Export one month at a time.");

  const rows: ImportedRow[] = [];
  const uncleared: { date: ISODate; amount: number }[] = [];
  lines.forEach((cells, i) => {
    const get = (column: (typeof COLUMNS)[number]) => (cells[at[column]] ?? "").trim();
    const line = i + 2;
    const date = usDate(get("transaction date"));
    if (!date) throw new StatementError(`Line ${line} of that file has a date Passbook can’t read (“${get("transaction date")}”). Try exporting it again.`);
    const cents = toCents(get("amount (usd)"));
    if (cents === null) throw new StatementError(`Line ${line} of that file has an amount Passbook can’t read (“${get("amount (usd)")}”). Try exporting it again.`);
    const cleared = usDate(get("clearing date"));
    const type = get("type").toLowerCase();
    const rawName = get("description");
    const name = get("merchant") || rawName || "Apple Card";
    // Apple writes charges as positive and money back as negative. Where the type is plain, it decides
    // (so a file that writes every amount positive still comes out right); anything else (a reversed
    // payment, a Daily Cash adjustment) keeps the file's own sign.
    const reversed = /revers|return/.test(type);
    const amount = !reversed && /^(purchase|installment|interest|fee|debit)/.test(type) ? -Math.abs(cents) : !reversed && /^(payment|credit)/.test(type) ? Math.abs(cents) : -cents;
    // Paying the card off (or a payment bouncing) is money moving between your own accounts; a refund
    // belongs with what it refunds; interest and fees are fees.
    const category: CategoryKey = /payment|daily cash/.test(type) ? "transfer" : /interest|fee/.test(type) ? "fees" : categoryFor(get("category"));
    // Not cleared yet: it may still change, so it waits for the export it clears in.
    if (!cleared) uncleared.push({ date, amount });
    else rows.push({ date, cleared, name, rawName: rawName || name, amount, category });
  });
  if (rows.length === 0) throw new StatementError(uncleared.length > 0 ? "Nothing in that file has cleared yet. Bring it in once the statement is ready." : "That file has no transactions in it. Pick a month that has a statement.");
  return { rows, pending: uncleared.length, uncleared };
}

/** A key for each row that's the same in every export: when it was made, when it cleared, its amount, its place among identical ones. */
export function rowKeys(rows: ImportedRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${r.date}:${r.cleared}:${r.amount}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}:${n}`;
  });
}

/**
 * A made-up Apple Card statement for last month, for the sample household: on
 * a sample site everyone shares one pretend household, so nobody's real
 * statement is ever brought into it.
 */
export function sampleStatement(today: ISODate): string {
  const month = addMonthsToMonth(monthOf(today), -1);
  const [y, m] = month.split("-");
  const day = (d: number) => `${m}/${String(d).padStart(2, "0")}/${y}`;
  const lines: [number, number, string, string, string, string, string][] = [
    [2, 3, "SOFT SERVE CO 118 PARK ST", "Soft Serve Co", "Restaurants", "Purchase", "7.25"],
    [4, 5, "GREEN GROCER 44", "Green Grocer", "Grocery", "Purchase", "62.18"],
    [6, 6, "APPLE.COM/BILL", "Apple Services", "Other", "Purchase", "9.99"],
    [9, 10, "PIXEL TOYS 9", "Pixel Toys", "Shopping", "Purchase", "38.00"],
    [12, 12, "ACH DEPOSIT INTERNET TRANSFER", "Ach Deposit Internet Transfer", "Payment", "Payment", "-150.00"],
    [15, 16, "PIXEL TOYS 9", "Pixel Toys", "Shopping", "Credit", "-12.00"],
    [19, 20, "RIVERSIDE FUEL 3", "Riverside Fuel", "Gas", "Purchase", "41.30"],
    [24, 25, "SOFT SERVE CO 118 PARK ST", "Soft Serve Co", "Restaurants", "Purchase", "7.25"],
  ];
  const rows = lines.map(([made, cleared, description, merchant, category, type, amount]) => [day(made), day(cleared), `"${description}"`, merchant, category, type, amount, "Sample"].join(","));
  return ["Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By", ...rows].join("\n");
}
