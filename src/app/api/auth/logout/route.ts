import { signOut } from "@/server/auth";
import { json, publicRoute } from "@/server/http";

export const POST = publicRoute(async (request) => json({ ok: true }, { headers: { "set-cookie": await signOut(request) } }));
