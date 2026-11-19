import { plaidConfig } from "@/lib/config";
import type { Me } from "@/lib/types";
import { withUser } from "@/server/http";

export const GET = withUser(async (ctx): Promise<Me> => {
  const plaid = plaidConfig();
  return {
    user: { name: ctx.user.name, email: ctx.user.email },
    demo: ctx.demo,
    today: ctx.today,
    bankLinking: { available: !ctx.demo && plaid !== null, sandbox: plaid?.env === "sandbox" },
  };
});
