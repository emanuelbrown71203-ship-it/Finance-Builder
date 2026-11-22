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
  `toast`, `confirm`, `Segmented`, `Field`, `Blocks`) before making anything new. Only use the colour tokens in
  `src/app/globals.css`.
- **The look is Neon Arcade** (house style, section 8), chosen by the owner because the old one felt
  bland: a daytime arcade in light mode, neon at night. Cards take `edge` + `shadow-card`, headline
  cards `hero-card` / `hero-figure`, bars are `Blocks`, menu and category icons are `PixelIcon`, titles
  and big numbers use `display` / `figure` (Bungee). Nickel (`nickel/robo-dog.tsx`) and the app icon
  (`nickel/mark.tsx`, `public/nickel-*`) are the neon pup the owner picked: keep them that way.
- If the owner says something about how an app should feel that isn't in the file yet, add it there.

## Things that must keep working

- **Sample-data mode** (no Plaid keys): one made-up household, with a new card purchase arriving every
  30 to 60 seconds. Every feature must work in it. It never writes to a real database.
- Money is whole cents. Amounts are signed: positive is money in. Debts are stored negative. Dates are
  `YYYY-MM-DD` text in the person's own time zone. Moving money between your own accounts is a
  "transfer" and is neither income nor spending.
- Bills and subscriptions are worked out from transaction history each time; only the person's own
  choices ("I cancelled this") are stored.
- **Budgets are for everyday spending.** Bills are necessities only (rent, utilities, insurance, loans,
  phone): their payments are planned separately and never counted against a category's budget.
  Subscriptions you could live without are **Extras**: everyday spending that counts in its category
  (Netflix in Entertainment). The Bills screen lists both, and one tap moves a charge between them.
  Worked out on read (`src/lib/finance/budget.ts`); only limits and rollover are stored. The budget's plan must always add up to Home's "left to spend" (what rollover
  carried in from earlier months is shown separately). Removed budgets stay as rows with `removed_at`:
  read them through `loadLimits` / `budgetState`, never straight from the table.
- **The app has five places** (`src/components/nav.tsx`): Home, Spending, Bills, Wealth, You. No "More"
  menu. A new screen joins a place (as a tab under its title, or a row on You), and Home stays short.
- Bank access tokens are stored encrypted. The app can read accounts and can never move money.
- **Apple Card comes in from its statements** (Apple shares it only with App Store apps, so Plaid can't
  link it on the web). `src/lib/finance/card-import.ts` reads Wallet's CSV export, and only Apple's own
  columns (OFX is refused: no categories, different dates); `src/server/card-import.ts` keeps it as a
  card account with no bank connection (`item_id` null, `plaid_account_id` "import:apple-card:<person>").
  Each cleared purchase is keyed by the day it was made, the day it cleared, its amount and its place
  among identical ones, so a statement brought in twice adds nothing. An import shows what's new before
  saving, asks what the card owes, and has Undo. The sample household uses a made-up statement, never
  the person's file.
- **Apple Card taps arrive live** through a private tap link (`src/server/card-taps.ts`,
  `/api/tap/<key>`), called by an iPhone Shortcuts Wallet automation ("Transaction" before iOS 26) with the merchant and
  amount. The link can only add a pending Apple Card purchase: it reads nothing back. Only a hash of its
  key is kept (`tap_keys`), making one needs a fresh "confirm it's you", it's rate limited, and it
  switches itself off after 180 days unused. A statement confirms each tap (same amount, within 3 days),
  keeping a category the person picked, and drops taps it shows never went through. The sample
  household has a test button instead of a link.
- **Nickel (the robo dog) points things out** from the person's own numbers, and never gives
  investment advice (no stock, fund or crypto picks); he says he isn't a financial advisor. His wording
  lives in `src/lib/nickel/brain.ts` and tests check for advice-like phrasing.
- **Asked about a purchase ("can I afford…?", "should I buy…?"), Nickel is headstrong**, at the owner's
  request: a straight yes / not yet / no from the household's numbers (`judgePurchase` in
  `src/lib/nickel/answers.ts`), with the reason in numbers, and a plain warning when bills would be at
  risk. Pleading or asking again never changes it; only new numbers (a different price) do.
- His instructions and questions are understood by rules (`src/lib/nickel/commands.ts`,
  `answers.ts`); talking uses the phone's own speech recognition and voice (`voice.ts`). "Chat with
  Claude" opens the owner's own Claude app. A built-in AI chat would send data to an outside service:
  ask the owner first.
- **Small wins earn XP** (`src/lib/game/progress.ts` for what's worth what; `win()` in
  `src/server/game.ts` records them where the change happens, in `player_wins`). XP never comes from
  the browser; each thing counts once (`ref`), each kind has a daily limit, Undo on the same day takes
  it back, and a failed win never blocks the real change. Give any new everyday task a win.
- **Names never overwrite the bank's text.** `transactions.name` stays what the bank sent; shown names
  come from `custom_name`, `name_rules` and the tidy-up in `src/lib/finance/names.ts`, applied on read.
  Anything that matches charges (bills, category rules, the Tasks link) keys on the bank's text.
- **The Claude connector only makes the changes the owner approved** (add a bill or one-off bill, add
  or change a savings goal and record money toward it, change a loan's rate or payment, rename charges).
  Every change goes through `src/server/actions.ts`, is written to the activity list with Undo, and is
  rate limited. It never deletes anything, moves money, or touches bank connections, sign-in, passkeys
  or keys. Anything beyond that list needs the owner's OK first. Nickel's "Tell me what to do" uses the
  same actions.
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
- On Supabase, `DATABASE_URL` uses the **session** pooler (port 5432). The transaction pooler (6543)
  hangs on the driver's pipelined queries, which takes the whole live site down. Tests against a
  direct Postgres can't show this; after a deploy check `/api/health` reports `"pool":"ok"`.
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
