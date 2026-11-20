/** Which build the server is running. Pull to refresh uses it to spot a newer version. */
export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? null }, { headers: { "cache-control": "no-store" } });
}
