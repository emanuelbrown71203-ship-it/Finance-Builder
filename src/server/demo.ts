import { and, eq, sql } from "drizzle-orm";
import { DEFAULT_TIMEZONE, DEMO_USER_ID } from "@/lib/config";
import { todayIn, type ISODate } from "@/lib/dates";
import type { DB } from "@/db";
import { accounts, balanceSnapshots, items, transactions } from "@/db/schema";
import { EVERYDAY, seedDemo } from "@/db/seed";
import { merchantKey } from "@/lib/finance/recurring";
import { loadRules } from "./rules";

/**
 * Demo mode keeps one sample household fresh: seeded once per day, with a
 * simulator that adds a card purchase every so often while someone is
 * looking, so the live feed has something to show.
 */

const state = globalThis as unknown as {
  __passbookDemo?: { seededFor: ISODate | null; seeding: Promise<void> | null; nextTickAt: number; counter: number };
};
state.__passbookDemo ??= { seededFor: null, seeding: null, nextTickAt: 0, counter: 0 };
const demo = state.__passbookDemo;

export function demoToday(now: Date = new Date()): ISODate {
  return todayIn(DEFAULT_TIMEZONE, now);
}

export async function ensureDemo(db: DB, now: Date = new Date()): Promise<void> {
  const today = demoToday(now);
  if (demo.seededFor !== today) {
    demo.seeding ??= seedDemo(db, today, now)
      .then(() => {
        demo.seededFor = today;
        demo.nextTickAt = now.getTime() + 12_000;
      })
      .finally(() => {
        demo.seeding = null;
      });
    await demo.seeding;
  }
  if (now.getTime() >= demo.nextTickAt) {
    demo.nextTickAt = now.getTime() + 25_000 + Math.floor(Math.random() * 40_000);
    await simulatePurchase(db, today, now);
  }
}

async function simulatePurchase(db: DB, today: ISODate, now: Date): Promise<void> {
  const pool = EVERYDAY.flatMap((g) => g.merchants.map((m) => ({ m, weight: g.perDay / g.merchants.length })));
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let roll = Math.random() * total;
  const merchant = (pool.find((p) => (roll -= p.weight) <= 0) ?? pool[0]).m;
  const amount = -Math.round((merchant.min + Math.random() * (merchant.max - merchant.min)) * 100);
  const cardId = "demo-card";

  await db.insert(transactions).values({
    id: `demo-live-${now.getTime()}-${++demo.counter}`,
    userId: DEMO_USER_ID,
    accountId: cardId,
    date: today,
    name: merchant.name,
    rawName: merchant.name.toUpperCase(),
    amount,
    category: (await loadRules(db, DEMO_USER_ID)).get(merchantKey(merchant.name)) ?? merchant.category,
    pending: true,
    createdAt: now,
  });
  await db.update(accounts).set({ balance: sql`${accounts.balance} + ${amount}` }).where(eq(accounts.id, cardId));
  await db
    .update(balanceSnapshots)
    .set({ balance: sql`${balanceSnapshots.balance} + ${amount}` })
    .where(and(eq(balanceSnapshots.accountId, cardId), eq(balanceSnapshots.date, today)));
  await db.update(items).set({ lastSyncedAt: now }).where(eq(items.userId, DEMO_USER_ID));
}
