import { withUser } from "@/server/http";
import { getNickel } from "@/server/nickel";

/** What Nickel the robo dog has noticed in your numbers. Read-only. */
export const GET = withUser((ctx) => getNickel(ctx));
