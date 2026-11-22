import { describe, expect, it } from "vitest";
import { StatementError, parseCsv, parseStatement, rowKeys, sampleStatement } from "@/lib/finance/card-import";

const HEADER = "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By";
// The columns of Apple Card's "Export Transactions" spreadsheet, with made-up purchases.
const CSV = [
  "﻿" + HEADER,
  '11/03/2026,11/04/2026,"BLUE BOTTLE COFFEE 123 MAIN ST, OAKLAND CA",Blue Bottle Coffee,Restaurants,Purchase,6.50,Sam Sample',
  '11/03/2026,11/04/2026,"BLUE BOTTLE COFFEE 123 MAIN ST, OAKLAND CA",Blue Bottle Coffee,Restaurants,Purchase,6.50,Sam Sample',
  "11/05/2026,11/06/2026,WHOLEFDS OAK 10234,Whole Foods,Grocery,Purchase,84.12,Sam Sample",
  "11/10/2026,11/10/2026,ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 1234,Ach Deposit Internet Transfer,Payment,Payment,-500.00,Sam Sample",
  '11/12/2026,11/13/2026,"THE ""GOOD"" BOOKSHOP",The Good Bookshop,Shopping,Purchase,"1,204.10",Sam Sample',
  "11/15/2026,11/16/2026,TARGET 00012345,Target,Shopping,Credit,-12.00,Sam Sample",
  "11/20/2026,11/20/2026,MONTHLY INSTALLMENTS (3 OF 24),Apple Online Store,Other,Installment,41.62,Sam Sample",
  "11/30/2026,11/30/2026,INTEREST CHARGE,Interest Charge,Other,Interest,3.21,Sam Sample",
].join("\r\n");

const row = (cells: string) => `${HEADER}\n${cells}`;

describe("reading a spreadsheet", () => {
  it("splits quoted fields with commas and doubled quotes, and either line ending", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\nd,e,f\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["d", "e", "f"],
    ]);
  });
});

describe("reading an Apple Card statement", () => {
  it("reads the dates, the merchant's name, the statement's text, and money out as negative", () => {
    const s = parseStatement(CSV);
    expect(s.rows).toHaveLength(8);
    expect(s.pending).toBe(0);
    expect(s.rows[0]).toEqual({ date: "2026-11-03", cleared: "2026-11-04", name: "Blue Bottle Coffee", rawName: "BLUE BOTTLE COFFEE 123 MAIN ST, OAKLAND CA", amount: -650, category: "dining" });
    expect(s.rows[4]).toMatchObject({ rawName: 'THE "GOOD" BOOKSHOP', amount: -120410, category: "shopping" });
  });

  it("files payments as transfers, refunds as money back in their category, interest as fees", () => {
    const [, , groceries, payment, , refund, installment, interest] = parseStatement(CSV).rows;
    expect(groceries).toMatchObject({ amount: -8412, category: "groceries" });
    expect(payment).toMatchObject({ amount: 50000, category: "transfer" });
    expect(refund).toMatchObject({ amount: 1200, category: "shopping" });
    expect(installment).toMatchObject({ amount: -4162, category: "other" });
    expect(interest).toMatchObject({ amount: -321, category: "fees" });
  });

  it("gets the direction right from the type, and keeps the file's own sign where the type isn't plain", () => {
    // A file that writes every amount as positive still has the payment coming in.
    expect(parseStatement(row("11/10/2026,11/10/2026,ACH DEPOSIT,Ach Deposit,Payment,Payment,500.00,Sam")).rows[0].amount).toBe(50000);
    // A payment that bounced takes the money back out; a Daily Cash adjustment goes the way the file says.
    expect(parseStatement(row("11/11/2026,11/11/2026,RETURNED PAYMENT,Returned Payment,Payment,Payment Reversal,500.00,Sam")).rows[0]).toMatchObject({ amount: -50000, category: "transfer" });
    expect(parseStatement(row("11/12/2026,11/12/2026,DAILY CASH ADJUSTMENT,Daily Cash,Other,Daily Cash Adjustment,2.40,Sam")).rows[0]).toMatchObject({ amount: -240, category: "transfer" });
  });

  it("leaves out purchases that haven't cleared yet, for the next statement", () => {
    const s = parseStatement(`${CSV}\r\n11/30/2026,,CORNER SHOP,Corner Shop,Shopping,Purchase,3.00,Sam Sample`);
    expect(s.rows).toHaveLength(8);
    expect(s.pending).toBe(1);
    expect(() => parseStatement(row("11/30/2026,,CORNER SHOP,Corner Shop,Shopping,Purchase,3.00,Sam"))).toThrow(/cleared/);
  });

  it("gives each purchase a key that's the same in every export, so the same month brought in twice adds nothing", () => {
    expect(rowKeys(parseStatement(CSV).rows).slice(0, 3)).toEqual(["2026-11-03:2026-11-04:-650:0", "2026-11-03:2026-11-04:-650:1", "2026-11-05:2026-11-06:-8412:0"]);
  });

  it("keeps two identical purchases that land on different statements apart", () => {
    // Two $6.50 coffees on Oct 31: one cleared that day (October's statement), one the next (November's).
    const october = rowKeys(parseStatement(row("10/31/2026,10/31/2026,BLUE BOTTLE,Blue Bottle,Restaurants,Purchase,6.50,Sam")).rows);
    const november = rowKeys(parseStatement(row("10/31/2026,11/01/2026,BLUE BOTTLE,Blue Bottle,Restaurants,Purchase,6.50,Sam")).rows);
    expect(october[0]).not.toBe(november[0]);
  });

  it("only reads Apple's own spreadsheet, and says what to do about anything else", () => {
    expect(() => parseStatement("")).toThrow(StatementError);
    expect(() => parseStatement("name,amount\nCoffee,3")).toThrow(/Apple Card export/);
    // Another bank's file (purchases negative, its own columns) isn't read the wrong way round.
    expect(() => parseStatement("Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n11/03/2026,11/04/2026,COFFEE,Food & Drink,Sale,-6.50,")).toThrow(/Apple Card export/);
    expect(() => parseStatement("OFXHEADER:100\nDATA:OFXSGML\n<OFX><STMTTRN><TRNAMT>-6.50</STMTTRN></OFX>")).toThrow(/choose CSV/);
    expect(() => parseStatement(row("13/45/2026,11/04/2026,COFFEE,Coffee,Restaurants,Purchase,6.50,Sam"))).toThrow(/date/);
    expect(() => parseStatement(row("11/03/2026,11/04/2026,COFFEE,Coffee,Restaurants,Purchase,99999999999999999.99,Sam"))).toThrow(/amount/);
  });

  it("has a made-up statement for last month, for the sample household", () => {
    const s = parseStatement(sampleStatement("2026-11-19"));
    expect(s.rows).toHaveLength(8);
    expect(s.rows.every((r) => r.date.startsWith("2026-10"))).toBe(true);
    expect(s.rows.filter((r) => r.category === "transfer")).toHaveLength(1);
  });
});
