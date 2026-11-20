import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

// These features only run on real data, so this file runs the app in live mode.
process.env.DEMO_MODE = "0";
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

import { getDb, type DB } from "@/db";
import { accounts, billTicks, taskLinks, transactions, users } from "@/db/schema";
import { isTasksLink, matchPayments, suggestLinks, unpaidDueDates, type TasksBill } from "@/lib/finance/billmatch";
import type { Ctx } from "@/server/auth";
import { contextForKey, createConnectorKey, handleRpc, revokeConnectorKey } from "@/server/connector";
import { checkBills, connectTasks, getTasksLink, setBillLink } from "@/server/tasks-link";

const LINK = "https://abcdefghijklmnopqrst.supabase.co/functions/v1/pa-mcp/ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnop";
const USER = "tasks-user";
const today = "2026-11-19";
const now = new Date("2026-11-19T17:00:00Z");

describe("which links are accepted", () => {
  it("only a Tasks for Two connector address on Supabase", () => {
    expect(isTasksLink(LINK)).toBe(true);
    expect(isTasksLink(` ${LINK} `)).toBe(true);
    for (const bad of [
      "http://abcdefghijklmnopqrst.supabase.co/functions/v1/pa-mcp/ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnop", // not https
      "https://localhost/functions/v1/pa-mcp/ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnop",
      "https://169.254.169.254/functions/v1/pa-mcp/ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnop",
      "https://evil.example/functions/v1/pa-mcp/ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnop",
      "https://abcdefghijklmnopqrst.supabase.co.evil.example/functions/v1/pa-mcp/ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnop",
      "https://user:pass@abcdefghijklmnopqrst.supabase.co/functions/v1/pa-mcp/ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnop",
      "https://abcdefghijklmnopqrst.supabase.co:8443/functions/v1/pa-mcp/ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnop",
      "https://abcdefghijklmnopqrst.supabase.co/functions/v1/other/ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnop",
      "https://abcdefghijklmnopqrst.supabase.co/functions/v1/pa-mcp/short",
      "https://abcdefghijklmnopqrst.supabase.co/functions/v1/pa-mcp/ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnop?x=1",
      "not a link",
    ]) {
      expect(isTasksLink(bad), bad).toBe(false);
    }
  });
});

describe("matching bank payments to bills", () => {
  const electric: TasksBill = { id: "b-electric", name: "Electricity", amount: 86.4, next_due: "2026-11-12", this_month: ["2026-11-12 to pay"] };
  const card: TasksBill = { id: "b-card", name: "Visa card", amount: 120, next_due: "2026-11-06", this_month: ["2026-11-06 to pay $250.00", "2026-11-20 to pay $120.00 (usual; not set yet)"] };
  const rent: TasksBill = { id: "b-rent", name: "Rent", amount: 2150, next_due: "2026-12-01", this_month: ["2026-11-01 paid"] };
  const pay = (id: string, date: string, name: string, dollars: number) => ({ id, date, name, amount: -Math.round(dollars * 100) });
  const base = { usedTransactions: new Set<string>(), ticked: new Set<string>(), today };

  it("reads the unpaid due dates off a bill", () => {
    expect(unpaidDueDates(card)).toEqual(["2026-11-06", "2026-11-20"]);
    expect(unpaidDueDates(rent)).toEqual(["2026-12-01"]);
  });

  it("ticks a linked bill when a payment to that merchant lands near the due date, with what was really paid", () => {
    const ticks = matchPayments({ ...base, bills: [electric], links: new Map([["b-electric", "city light & power"]]), payments: [pay("t1", "2026-11-12", "City Light & Power", 94.68)] });
    expect(ticks).toEqual([{ billId: "b-electric", billName: "Electricity", dueDate: "2026-11-12", transactionId: "t1", amount: 9468 }]);
  });

  it("never ticks a bill that hasn't been linked, however alike it looks", () => {
    expect(matchPayments({ ...base, bills: [electric], links: new Map(), payments: [pay("t1", "2026-11-12", "Electricity", 86.4)] })).toEqual([]);
  });

  it("ignores payments to other places, too far from the due date, or dated in the future", () => {
    const links = new Map([["b-electric", "city light & power"]]);
    expect(matchPayments({ ...base, bills: [electric], links, payments: [pay("t1", "2026-11-12", "Fiberline Internet", 65)] })).toEqual([]);
    expect(matchPayments({ ...base, bills: [electric], links, payments: [pay("t1", "2026-10-12", "City Light & Power", 90)] })).toEqual([]);
    expect(matchPayments({ ...base, bills: [{ ...electric, next_due: "2026-11-22", this_month: ["2026-11-22 to pay"] }], links, payments: [pay("t1", "2026-11-21", "City Light & Power", 90)] })).toEqual([]);
  });

  it("gives each payment to one due date only (a card paid twice a month)", () => {
    const ticks = matchPayments({ ...base, bills: [card], links: new Map([["b-card", "meridian card payment"]]), payments: [pay("t1", "2026-11-05", "Meridian Card Payment", 250), pay("t2", "2026-11-19", "Meridian Card Payment", 130)] });
    expect(ticks.map((t) => [t.dueDate, t.transactionId, t.amount])).toEqual([
      ["2026-11-06", "t1", 25000],
      ["2026-11-20", "t2", 13000],
    ]);
  });

  it("doesn't reuse a payment or tick the same due date twice", () => {
    const links = new Map([["b-electric", "city light & power"]]);
    const payments = [pay("t1", "2026-11-12", "City Light & Power", 94.68)];
    expect(matchPayments({ ...base, bills: [electric], links, payments, usedTransactions: new Set(["t1"]) })).toEqual([]);
    expect(matchPayments({ ...base, bills: [electric], links, payments, ticked: new Set(["b-electric|2026-11-12"]) })).toEqual([]);
  });

  it("suggests a merchant by shared words or the same amount, for the owner to confirm", () => {
    const merchants = [
      { key: "geico", name: "Geico", amount: -13250 },
      { key: "parkview apartments", name: "Parkview Apartments", amount: -215000 },
      { key: "city light & power", name: "City Light & Power", amount: -9468 },
    ];
    const bills: TasksBill[] = [{ id: "1", name: "Car insurance", amount: 132.5 }, { id: "2", name: "Parkview rent", amount: 2150 }, { id: "3", name: "Phone", amount: 45 }];
    const out = suggestLinks(bills, merchants, new Map());
    expect(out.get("2")).toBe("parkview apartments");
    expect(out.has("3")).toBe(false);
    // Same amount alone isn't enough to suggest: "Car insurance" shares no word with "Geico".
    expect(out.has("1")).toBe(false);
  });
});

describe("ticking bills in Tasks for Two", () => {
  let db: DB;
  let ctx: Ctx;
  const calls: { tool: string; args: { payments?: { id: string; due_date: string; amount: number }[] } }[] = [];
  let bills: TasksBill[] = [];
  let failPay = false;
  /** A stand-in for Tasks for Two's connector, answering in its real shapes. */
  const fakeTasks = (async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe(LINK);
    const body = JSON.parse(String(init!.body));
    calls.push({ tool: body.params.name, args: body.params.arguments });
    const reply = (out: unknown, isError = false) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }], isError } }), { status: 200 });
    if (body.params.name === "list_bills") return reply({ count: bills.length, bills });
    if (failPay) return reply("Something broke", true);
    return reply({ paid: body.params.arguments.payments });
  }) as typeof fetch;

  beforeAll(async () => {
    db = await getDb();
    await db.insert(users).values({ id: USER, email: "tasks@example.com", name: "Riley" });
    await db.insert(accounts).values({ id: "acc", userId: USER, name: "Checking", institutionName: "Bank", type: "depository", balance: 100000 });
    await db.insert(transactions).values([
      { id: "tx-electric", userId: USER, accountId: "acc", date: "2026-11-12", name: "City Light & Power", amount: -9468, category: "utilities" },
      { id: "tx-pending", userId: USER, accountId: "acc", date: "2026-11-18", name: "Fiberline Internet", amount: -6500, category: "utilities", pending: true },
    ]);
    ctx = { db, userId: USER, user: { id: USER, name: "Riley", email: "tasks@example.com" }, today, demo: false };
    bills = [
      { id: "b-electric", name: "Electricity", amount: 86.4, next_due: "2026-11-12", this_month: ["2026-11-12 to pay"] },
      { id: "b-internet", name: "Internet", amount: 65, next_due: "2026-11-18", this_month: ["2026-11-18 to pay"] },
    ];
  });

  it("refuses anything that isn't a Tasks for Two link, and stores a real one encrypted", async () => {
    await expect(connectTasks(ctx, "https://evil.example/steal", fakeTasks)).rejects.toThrow("doesn’t look like a Tasks for Two connector link");
    await connectTasks(ctx, LINK, fakeTasks);
    const [row] = await db.select().from(taskLinks).where(eq(taskLinks.userId, USER));
    expect(row.urlEnc).not.toContain("supabase");
  });

  it("does nothing until the owner links a bill to a merchant", async () => {
    calls.length = 0;
    expect(await checkBills(db, USER, fakeTasks, now)).toEqual({ ticked: 0, message: "Nothing new to tick off." });
    expect(calls.map((c) => c.tool)).toEqual(["list_bills"]);
  });

  it("ticks a linked bill once the payment has settled, and only once", async () => {
    const status = await getTasksLink(ctx, fakeTasks);
    expect(status.bills.map((b) => b.name)).toEqual(["Electricity", "Internet"]);
    await setBillLink(ctx, { id: "b-electric", name: "Electricity" }, "city light & power");
    await setBillLink(ctx, { id: "b-internet", name: "Internet" }, "fiberline internet");

    calls.length = 0;
    const result = await checkBills(db, USER, fakeTasks, now);
    expect(result).toEqual({ ticked: 1, message: "Ticked off 1 bill." });
    // Electricity was paid for real. The internet charge is still pending, so it waits.
    expect(calls.filter((c) => c.tool === "pay_bills").map((c) => c.args.payments)).toEqual([[{ id: "b-electric", due_date: "2026-11-12", amount: 94.68 }]]);

    // Running it again, even though Tasks for Two still lists the bill as unpaid, sends nothing.
    calls.length = 0;
    expect((await checkBills(db, USER, fakeTasks, now)).ticked).toBe(0);
    expect(calls.some((c) => c.tool === "pay_bills")).toBe(false);
  });

  it("forgets a tick that Tasks for Two refused, so it is tried again next time", async () => {
    await db.update(transactions).set({ pending: false }).where(eq(transactions.id, "tx-pending"));
    failPay = true;
    const failed = await checkBills(db, USER, fakeTasks, now);
    expect(failed).toEqual({ ticked: 0, message: "Couldn’t tick Internet. It will try again next time." });
    expect(await db.select().from(billTicks).where(eq(billTicks.tasksBillId, "b-internet"))).toHaveLength(0);
    failPay = false;
    expect((await checkBills(db, USER, fakeTasks, now)).ticked).toBe(1);
  });
});

describe("the Claude connector", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    const db = await getDb();
    ctx = { db, userId: USER, user: { id: USER, name: "Riley", email: "tasks@example.com" }, today, demo: false };
  });

  it("a key opens only its owner's data, and a replaced or revoked key stops working", async () => {
    const first = await createConnectorKey(ctx);
    expect(first.length).toBe(40);
    expect((await contextForKey(first))?.userId).toBe(USER);
    expect(await contextForKey("x".repeat(40))).toBeNull();
    expect(await contextForKey("sample-household")).toBeNull(); // the try-it key exists only in sample-data mode
    const second = await createConnectorKey(ctx);
    expect(await contextForKey(first)).toBeNull();
    expect((await contextForKey(second))?.userId).toBe(USER);
    await revokeConnectorKey(ctx);
    expect(await contextForKey(second)).toBeNull();
  });

  it("speaks the protocol Claude expects and only offers read-only tools", async () => {
    const init = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx)) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "passbook" } });
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx)).toBeNull();
    const list = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx)) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(["get_money_overview", "list_transactions", "get_spending", "list_bills", "get_net_worth", "list_goals", "get_investments", "get_debt_plan", "get_weekly_recap"]);
    expect(list.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  it("answers in dollars from the owner's own data, and keeps errors short", async () => {
    const call = async (name: string, args = {}) => {
      const out = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } }, ctx)) as { result: { content: { text: string }[]; isError?: boolean } };
      return { ...out.result, data: out.result.isError ? null : JSON.parse(out.result.content[0].text) };
    };
    const tx = await call("list_transactions", { search: "city light" });
    expect(tx.data.transactions).toEqual([{ date: "2026-11-12", name: "City Light & Power", amount: -94.68, category: "Utilities", account: "Checking" }]);
    const worth = await call("get_net_worth");
    expect(worth.data).toMatchObject({ net_worth: 1000, owned: 1000, owed: 0 });
    expect((await call("get_money_overview")).data.today).toBe(today);
    const unknown = await call("delete_everything");
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toBe("Unknown tool: delete_everything");
  });
});
