# Working on Passbook

@AGENTS.md

Passbook is the owner's personal finance app: every account in one place, transactions as they happen,
bills and subscriptions, budgets, net worth, savings goals and investments. README.md describes the
features and how it is built; this file is how to work on it.

## Who you're working with

- The owner is **not a developer**. Explain in plain language, describe what changed on screen, and never
  ask them to edit code or run commands.
- They use their apps on an iPhone from the home screen first, then iPad and laptop.
- Keep personal details out of the repository, commits and outside services.

## Read this first: the house style

**`docs/house-style.md` is the owner's standing list of how every app of theirs should look, feel and
behave** (phone first, bottom tab bar, pull to refresh, sheets that slide up, Undo instead of "are you
sure?", big bold titles, bright colours, Settings with light/dark, home-screen app setup). They asked
for it to be remembered and used whenever an app is built.

- Follow it for every screen and every change here.
- **When starting a new app for this owner, copy `docs/house-style.md` into the new repository and
  point that repository's CLAUDE.md at it.** Their other apps are the reference for how it looks in
  practice: `ProductivityApp` (Tasks for Two), `Grocery-List` (Roux), `YouTube-Dashboard`,
  `HOHOperationsHub`. The work in each sits on its `claude/…` branch, not on `main`.
- Reuse the shared pieces in `src/components/ui.tsx` (`Sheet`, `PageHeader`, `Button`, `Dialog`, `Fold`,
  `toast`, `confirm`, `Segmented`, `Field`) before making anything new. Only use the colour tokens in
  `src/app/globals.css`.
- If the owner says something about how an app should feel that isn't in the file yet, add it there.

## Things that must keep working

- **Sample-data mode** (no Plaid keys): one made-up household, with a new card purchase arriving every
  30 to 60 seconds. Every feature must work in it. It never writes to a real database.
- Money is whole cents. Amounts are signed: positive is money in. Debts are stored negative. Dates are
  `YYYY-MM-DD` text in the person's own time zone. Moving money between your own accounts is a
  "transfer" and is neither income nor spending.
- Bills and subscriptions are worked out from transaction history each time; only the person's own
  choices ("I cancelled this") are stored.
- Bank access tokens are stored encrypted. The app can read accounts and can never move money.
- **The Claude connector is read-only.** Never add a tool to `src/server/connector.ts` that changes
  anything without asking the owner first.
- **The Tasks for Two link never runs on sample data or Plaid’s practice banks**, only ticks bills
  the owner has linked to a merchant, only on settled payments, and writes each tick down before
  sending it. It accepts only a connector address on the one Tasks for Two server in
  `TASKS_FOR_TWO_HOST` (`isTasksLink`). Keep all four of those true.

## Security rules (the owner asked for this app to be "super secure")

- Every user route goes through `withUser` (`src/server/http.ts`), and every query and change is
  limited to `ctx.userId`. An id that comes from the request is never trusted on its own.
- Writes must come from the app itself (`assertSameOrigin`). Don't add a route that changes
  something on a GET.
- Secrets (bank tokens, the Tasks link) go through `encryptSecret(value, owner)`; keys and session
  tokens are stored only as hashes. Nothing secret goes in a log, an error message or the browser.
- **Never `console.error(error)`.** Log `describeError(error)` (`src/server/errors.ts`). A raw Plaid
  error carries the Plaid secret and a bank token; a raw database error carries the query's values.
  Every Plaid call goes through `call()` in `src/server/plaid.ts`, which strips them.
- New sign-in or key-guessing surfaces get a rate limit (`src/server/rate-limit.ts`). Dates inside
  hand-written `sql` are bound with `sql.param(date, column)`: the in-memory database accepts a bare
  Date, real Postgres does not.
- Anything that adds a way into the account (a passkey, a connector key) or destroys it uses
  `withUser(handler, { fresh: true })`, which asks the person to confirm it’s them.
- New accounts need the invite code (`SIGNUP_CODE`). Don’t reopen sign-up.
- With real data the site’s address is `APP_URL` and nothing else: never read it from a request header.
- If a change touches sign-in, sessions, the connectors or the headers in `next.config.ts`, run the
  security checks again and get an independent review before publishing.

## Checking your work

1. `npm run check` (types, lint, tests). `npm run build` before deploying. The tests also run
   against real Postgres, and must before a change to sign-in or to hand-written SQL goes live:
   `DEMO_MODE=0 DATABASE_URL=postgres://… npm test` (a throwaway local Postgres is fine).
2. `npm run dev`, then screenshot every changed screen with Playwright at iPhone size in light and dark,
   and look at them. Check for sideways scrolling.
3. Touch features (pull to refresh, sheets) can be driven in Playwright with a phone device and
   `Input.dispatchTouchEvent` over a CDP session.
4. After changing `src/db/schema.ts`: `npm run db:generate`. The real database is updated with
   `npx tsx scripts/install-sql.ts --from <n>` (ask the owner first), never `npm run db:migrate`:
   on Supabase that would put the tables in `public`, where browsers can reach them.

## Publishing

- Work on the session's branch; commit and push there.
- Bump `APP_VERSION` in `src/lib/config.ts` and `version` in `package.json` with every change.
- Live sample-data site: **https://passbook-finance-zay-9e82.vercel.app** (Vercel project
  `passbook-finance`). Deploy with the Vercel tool `create_deployment`, `target: production`, gitSource
  github `emanuelbrown71203-ship-it/Finance-Builder` at the pushed branch, then confirm it is `READY`.
- This sandbox can't open vercel.app directly; use Vercel's `web_fetch_vercel_url` to check the live site.
- Anything that creates or changes a real database, or could cost money: explain it and ask first.

## Open items

- Real bank data needs Plaid keys and a database from the owner (see README, "Going live").
- The Plaid connection is tested against simulated responses only.
