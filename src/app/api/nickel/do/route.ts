import { z } from "zod";
import { BILL_FREQUENCIES } from "@/server/manual-bills";
import { addBill, addGoal, addToGoal, changeLoan, findCharge, findDebt, findGoal, renameCharges } from "@/server/actions";
import { readBody, withUser } from "@/server/http";

const cents = z.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** An instruction for Nickel, already understood on the phone (src/lib/nickel/commands.ts) and checked again here. */
const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bill"), name: z.string().max(200), amount: cents, frequency: z.enum(BILL_FREQUENCIES).exclude(["once"]), date, billKind: z.enum(["bill", "subscription"]).optional() }),
  z.object({ kind: z.literal("upcoming"), name: z.string().max(200), amount: cents, date }),
  z.object({ kind: z.literal("goal"), name: z.string().max(200), target: cents, date: date.nullable() }),
  z.object({ kind: z.literal("deposit"), goal: z.string().max(200), amount: cents }),
  z.object({ kind: z.literal("loan"), loan: z.string().max(200), aprPercent: z.number().min(0).max(99).nullable(), payment: cents.nullable() }),
  z.object({ kind: z.literal("rename"), from: z.string().max(200), to: z.string().max(200), onlyThisAmount: z.boolean().optional() }),
]);

/** Nickel does what he was asked and says what he did; it lands in the activity list with Undo. */
export const POST = withUser(async (ctx, request) => {
  const c = await readBody(request, Body);
  switch (c.kind) {
    case "bill":
      return addBill(ctx, "nickel", { name: c.name, amount: c.amount, frequency: c.frequency, date: c.date, kind: c.billKind });
    case "upcoming":
      return addBill(ctx, "nickel", { name: c.name, amount: c.amount, frequency: "once", date: c.date });
    case "goal":
      return addGoal(ctx, "nickel", { name: c.name, target: c.target, targetDate: c.date });
    case "deposit":
      return addToGoal(ctx, "nickel", (await findGoal(ctx, c.goal)).id, c.amount);
    case "loan":
      return changeLoan(ctx, "nickel", (await findDebt(ctx, c.loan)).id, { ...(c.aprPercent !== null ? { aprPercent: c.aprPercent } : {}), ...(c.payment !== null ? { monthlyPayment: c.payment } : {}) });
    case "rename":
      return renameCharges(ctx, "nickel", (await findCharge(ctx, c.from)).id, c.to, c.onlyThisAmount);
  }
});
