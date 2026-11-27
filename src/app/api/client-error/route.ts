import { z } from "zod";
import { json, publicRoute, readBody } from "@/server/http";
import { limit } from "@/server/rate-limit";

/*
 * When a screen breaks in someone's browser, the page sends a short note here
 * (what broke and where in the code) so it shows up in the server log. That is
 * the only way to see a problem that happens on a phone and nowhere else.
 *
 * Nothing about the person or their money is sent: only the error text, the
 * screen's path without any query, and the browser's name. It is limited per
 * address, so it can't be used to fill the log.
 */

const short = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => s.replace(/[^\x20-\x7e\n]/g, "?").slice(0, max));

const Body = z.object({
  kind: z.enum(["error", "rejection", "resource", "csp", "boundary"]),
  message: short(500),
  stack: short(2500).optional(),
  path: short(120),
  digest: short(80).optional(),
  build: short(64).optional(),
  agent: short(200).optional(),
});

export const POST = publicRoute(async (request) => {
  await limit(request, "client-error", 30, 10 * 60_000);
  const body = await readBody(request, Body);
  const path = body.path.split("?")[0].split("#")[0];
  // Only the stack keeps its line breaks, each line indented, so nothing sent can pass for a line of the server's own.
  const oneLine = (s: string) => s.replace(/\n/g, " ");
  const stack = body.stack ? `\n${body.stack.split("\n").map((line) => `    | ${line}`).join("\n")}` : "";
  console.error(`Client ${body.kind} on ${oneLine(path)} (build ${oneLine(body.build ?? "?")}; ${oneLine(body.agent ?? "unknown browser")}): ${oneLine(body.message)}${body.digest ? ` [digest ${oneLine(body.digest)}]` : ""}${stack}`);
  return json({ ok: true });
});
