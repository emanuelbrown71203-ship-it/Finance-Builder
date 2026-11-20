import { signOutEverywhere } from "@/server/auth";
import { json, withUser } from "@/server/http";

/** Ends every session this person has, on every device. */
export const POST = withUser(async (ctx) => json({ ok: true }, { headers: { "set-cookie": ctx.demo ? "" : await signOutEverywhere(ctx) } }));
