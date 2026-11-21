import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { createNameRule, getNames } from "@/server/names";

/** Saved names, and bank text that could be clearer. */
export const GET = withUser((ctx) => getNames(ctx));

const Body = z.object({
  /** A transaction to take the bank's text from: every charge like it gets the name. */
  transactionId: z.string().min(1).max(200),
  name: z.string().max(200),
  /** Only charges of exactly this transaction's amount. */
  onlyThisAmount: z.boolean().optional(),
  /** Sent from the charge's own sheet: a name given to just that charge makes way. */
  fromItsSheet: z.boolean().optional(),
});

export const POST = withUser(async (ctx, request) => createNameRule(ctx, await readBody(request, Body)));
