import { withUser } from "@/server/http";
import { listPasskeys } from "@/server/passkeys";

export const GET = withUser(async (ctx) => ({ passkeys: ctx.demo ? [] : await listPasskeys(ctx) }));
