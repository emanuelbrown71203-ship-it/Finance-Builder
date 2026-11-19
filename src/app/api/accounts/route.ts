import { z } from "zod";
import { readBody, withUser } from "@/server/http";
import { createManualAccount } from "@/server/mutations";
import { getAccounts } from "@/server/queries";

export const GET = withUser((ctx) => getAccounts(ctx));

const Body = z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(["asset", "debt"]), value: z.number().int().min(0).max(100_000_000_000) });

export const POST = withUser(async (ctx, request) => {
  await createManualAccount(ctx, await readBody(request, Body));
  return { ok: true };
});
