import { describe, expect, it } from "vitest";
import { cleanName, looksUnclear, nameKey, namer, ruleKey, validName } from "@/lib/finance/names";

describe("spotting bank code", () => {
  it("flags reference numbers, processor stars and shouting, but not real names", () => {
    for (const s of ["SQ *TARTINE BAKERY 0423 SAN FRANCISCO CA", "TST* LA TAQUERIA", "FIBERLINE INTERNET", "UBER   TRIP", "AMZN Mktp US*2K4LT8A93", "Netflix.com", "PURCHASE AUTHORIZED ON 11/02 SHELL OIL 5744"]) {
      expect(looksUnclear(s), s).toBe(true);
    }
    for (const s of ["Tartine Bakery", "Trader Joe’s", "REI", "AMC Theatres", "CVS Pharmacy", "ATM Fee", "7-Eleven", "Transfer to Savings", "Disney+", ""]) {
      expect(looksUnclear(s), s).toBe(false);
    }
  });
});

describe("tidying a bank's text", () => {
  it.each([
    ["SQ *TARTINE BAKERY 0423 SAN FRANCISCO CA", "Tartine Bakery"],
    ["TST* LA TAQUERIA 0188 SAN FRANCISCO CA", "LA Taqueria"],
    ["AMZN Mktp US*2K4LT8A93", "Amazon"],
    ["AMAZON PRIME*1J23K4 AMZN.COM/BILL WA", "Amazon Prime"],
    ["APPLE.COM/BILL 866-712-7753 CA", "Apple"],
    ["GOOGLE *YouTubePremium g.co/helppay#", "YouTube Premium"],
    ["GOOGLE *YOUTUBE TV 650-253-0000 CA", "YouTube TV"],
    ["PAYPAL *EBAY INC 4029357733 CA", "eBay"],
    ["UBER   *TRIP HELP.UBER.COM CA", "Uber"],
    ["UBER *EATS PENDING", "Uber Eats"],
    ["PURCHASE AUTHORIZED ON 11/02 SHELL OIL 57444 OAKLAND CA", "Shell"],
    ["FIBERLINE INTERNET 800-555-0142 OR", "Fiberline Internet"],
    ["PATREON* MEMBERSHIP 4155550123 CA", "Patreon"],
    ["POS DEBIT JOE'S PIZZA #12 NEW YORK NY", "Joe's Pizza"],
    ["CHECKCARD 1102 BLUE BOTTLE COFFEE OAKLAND CA", "Blue Bottle Coffee Oakland"],
    ["ACME WIDGETS LLC", "Acme Widgets"],
    ["CITY OF OAKLAND PARKING", "City of Oakland Parking"],
    // Well-known names only take over when the rest is code; real words stay.
    ["AMAZON WEB SERVICES", "Amazon Web Services"],
    ["AMAZON FRESH 1234 SEATTLE WA", "Amazon Fresh"],
    ["AMZN DIGITAL*2K4AB1 888-802-3080 WA", "Amazon Digital"],
    ["MC DONALDS F1234", "McDonald’s"],
    // Numbers that are part of a name stay; store numbers go.
    ["24 HOUR FITNESS", "24 Hour Fitness"],
    ["99 RANCH MARKET #123", "99 Ranch Market"],
    ["ROUTE 101 DINER", "Route 101 Diner"],
    ["CHIPOTLE 123 SEATTLE WA", "Chipotle"],
    ["PAYMENT TO CHASE CARD ENDING IN 1234", "Chase Card ending 1234"],
    // Money between people keeps who it was.
    ["ZELLE PAYMENT TO JOHN SMITH 12345678", "Zelle John Smith"],
    ["VENMO *ROSA M 1188", "Venmo Rosa M"],
    ["VENMO PAYMENT 1022", "Venmo"],
  ])("%s → %s", (raw, clean) => {
    expect(cleanName(raw)).toBe(clean);
  });

  it("leaves clear names exactly as they are, and is safe to run twice", () => {
    for (const s of ["Tartine Bakery", "Target Optical", "Uber Eats", "Transfer to Savings", "Halden Studio Payroll"]) expect(cleanName(s)).toBe(s);
    const once = cleanName("SQ *TARTINE BAKERY 0423 SAN FRANCISCO CA");
    expect(cleanName(once)).toBe(once);
  });

  it("falls back to the bank's text when there's nothing readable left", () => {
    expect(cleanName("CHECK 1234")).toBe("Check");
    expect(cleanName("#4471 8812")).toBe("#4471 8812");
    expect(cleanName("AB*2K4AB1 WA")).toBe("AB*2K4AB1 WA");
  });
});

describe("matching a rule", () => {
  it("treats different branches of the same shop as one place", () => {
    expect(nameKey("SQ *BLUE BOTTLE 0423 OAKLAND CA")).toBe(nameKey("SQ *BLUE BOTTLE 1102 SAN JOSE CA"));
    expect(nameKey("Tartine Bakery")).toBe("tartine bakery");
    expect(nameKey("SQ *TARTINE BAKERY 0423 SAN FRANCISCO CA")).toBe("tartine bakery");
  });

  it("keeps money in and money out apart, and different people apart", () => {
    expect(ruleKey("ZELLE PAYMENT TO JOHN SMITH 1234", -150_000)).toBe("out:zelle john smith");
    expect(ruleKey("ZELLE PAYMENT FROM JOHN SMITH 9876", 4_000)).toBe("in:zelle john smith");
    expect(ruleKey("ZELLE PAYMENT TO JANE DOE 1234", -150_000)).not.toBe(ruleKey("ZELLE PAYMENT TO JOHN SMITH 1234", -150_000));
  });
});

describe("naming a transaction", () => {
  const name = namer([
    { id: "r1", key: "out:venmo rosa m", amount: 0, name: "Venmo Rosa" },
    { id: "r2", key: "out:venmo rosa m", amount: -120_000, name: "Rent to Rosa" },
    { id: "r3", key: "out:tartine bakery", amount: 0, name: "Tartine" },
  ]);

  it("uses a one-off name first, then an exact-amount rule, then any-amount rule, then the tidy-up", () => {
    expect(name({ name: "VENMO *ROSA M 1188", amount: -120_000, customName: "June rent" })).toEqual({ name: "June rent", source: "custom", ruleId: null, exact: false });
    expect(name({ name: "VENMO *ROSA M 1188", amount: -120_000 })).toEqual({ name: "Rent to Rosa", source: "rule", ruleId: "r2", exact: true });
    expect(name({ name: "VENMO *ROSA M 1188", amount: -4_000 })).toEqual({ name: "Venmo Rosa", source: "rule", ruleId: "r1", exact: false });
    // Money coming back from Rosa isn't covered by a rule for money going to her.
    expect(name({ name: "VENMO *ROSA M 1188", amount: 4_000 })).toEqual({ name: "Venmo Rosa M", source: "clean", ruleId: null, exact: false });
    expect(name.base("VENMO *ROSA M 1188", false)).toMatchObject({ name: "Venmo Rosa", ruleId: "r1" });
    expect(name({ name: "SQ *TARTINE BAKERY 0423 SAN FRANCISCO CA", amount: -1_200 })).toMatchObject({ name: "Tartine", ruleId: "r3" });
    expect(name({ name: "TST* LA TAQUERIA 0188 SAN FRANCISCO CA", amount: -1_800 })).toEqual({ name: "LA Taqueria", source: "clean", ruleId: null, exact: false });
    expect(name({ name: "Chipotle", amount: -1_400 })).toEqual({ name: "Chipotle", source: "bank", ruleId: null, exact: false });
  });
});

describe("checking a typed name", () => {
  it("trims, squashes spaces, strips invisible characters and limits length", () => {
    expect(validName("  Rent   to\tRosa ")).toBe("Rent to Rosa");
    expect(validName("Rent\u202easoR")).toBe("RentasoR");
    expect(validName("   ")).toBeNull();
    expect(validName("x".repeat(61))).toBeNull();
    // Names that would show as nothing.
    expect(validName("\u3164\u3164")).toBeNull();
    expect(validName("\u061c\u200b")).toBeNull();
    expect(validName("Caf\u00e9 \u2615")).toBe("Caf\u00e9 \u2615");
  });
});
