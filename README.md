# Passbook

A personal finance app: every account in one place, transactions as they happen, bills and
subscriptions found automatically, budgets, net worth, savings goals and investments.

"Passbook" is a working name. It lives in one constant (`APP_NAME` in `src/lib/config.ts`).

## Try it

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no configuration the app runs in **demo mode**: one sample
household with about 13 months of history, and a simulator that adds a card purchase every
30 to 60 seconds so you can watch the live feed work. Nothing to sign in to, nothing to set up.
Sample data resets each day.

## Made for the phone

Passbook follows the same house style as the owner's other apps (written down in
`docs/house-style.md`):

- A bar along the bottom on a phone, a menu down the side on a wide screen.
- **Pull down at the top of any screen to refresh.** It checks the banks, reloads every number and
  loads a newer version of the app if one is out.
- Pop-ups slide up from the bottom and can be dragged down to close.
- Everyday changes show a short message with **Undo**. Only permanent things ask "are you sure?".
- Settings has Automatic / Light / Dark and the version number.
- It can be added to an iPhone or Android home screen and opens full screen like an app.

## The screens

| Screen | What it does |
| --- | --- |
| Home | What's left to spend this month after bills and savings, what needs a look (bills due, price increases, categories over their limit), what's coming up and the latest activity. |
| Transactions | Everything from every account, live. Search and filter. Tap one to change its category or add a note. |
| Bills | Recurring bills, subscriptions and income, found from history. Upcoming due dates, price-increase alerts, "I cancelled this". |
| Budget | Spending by category against monthly limits, month over month, and six months of money in vs money out. |
| Net worth | What you own minus what you owe over time, by account. Add things no bank reports (a car, a house) by hand. |
| Savings | Savings balance, monthly saving history, and goals with a projected finish date. |
| Investing | Total, trend, split by type, and holdings with gain or loss. |
| Accounts | Linked banks, their status, and linking or removing one. |
| Settings | Light or dark, how to put it on your home screen, your account, version. |

## Going live with real bank data

Demo mode ends when Plaid keys are present. You need three things:

1. **A Postgres database.** Any Postgres works; Supabase is the intended home. Put its
   connection string in `DATABASE_URL`, then create the tables: `npm run db:migrate`.
2. **Plaid keys.** Sign up at https://dashboard.plaid.com, copy the client ID and the
   Sandbox secret into `PLAID_CLIENT_ID` and `PLAID_SECRET`, and leave `PLAID_ENV=sandbox`.
   Sandbox uses practice banks (username `user_good`, password `pass_good`) and is free.
   Real banks need Plaid's Production approval, then `PLAID_ENV=production` with the
   production secret.
3. **An encryption key and the app's address.** `TOKEN_ENCRYPTION_KEY` (generate with
   `openssl rand -base64 32`) and `APP_URL` (where the app is hosted, so Plaid can reach
   `/api/plaid/webhook`).

`.env.example` lists every variable with notes. Copy it to `.env.local`.

Once live, people create an account, link a bank through Plaid Link, and the first sync pulls
up to two years of transactions plus balances, holdings and card or loan details.

### How "real time" works

Banks don't push individual transactions to anyone. Plaid checks each bank several times a day
(card charges often show up as pending within minutes) and calls our webhook when there is
something new. The webhook verifies Plaid's signature and syncs immediately, and every open
screen re-checks our own database every five seconds, so new transactions appear without a
refresh. "Refresh" in the top bar forces a sync on demand.

## How it's built

- **Next.js 16** (App Router), React 19, TypeScript, Tailwind CSS 4.
- **Postgres via Drizzle ORM.** In demo mode and in tests the same SQL runs on PGlite (Postgres
  compiled to WebAssembly, in-process), so the demo exercises the queries production uses.
  Demo mode never writes to `DATABASE_URL`.
- **Plaid** for bank connections: Link, `/transactions/sync` with cursors, holdings,
  liabilities, and signed webhooks.
- **Charts are hand-drawn SVG** (`src/components/charts.tsx`): no chart library.
- **Type:** Archivo, the same family as the YouTube Dashboard and HOH Hub.

```
src/
  app/(app)/         the screens
  app/(auth)/        sign in, create account
  app/api/           route handlers (one folder per resource)
  components/        shell, charts, transaction list, dialogs, UI primitives
  db/                schema, connection, demo seed
  lib/finance/       recurring detection and the month plan (pure functions)
  lib/               money, dates, categories, shared API types
  server/            queries, mutations, auth, Plaid, crypto
drizzle/             SQL migrations
tests/               unit and integration tests
```

Conventions worth knowing before changing things:

- Money is integer cents. Transaction amounts are signed: positive is money in.
- Debts are stored negative, so net worth is a plain sum of account balances.
- Dates are `YYYY-MM-DD` strings in the person's own time zone.
- Transfers between your own accounts (including paying off a card) are their own category
  and are excluded from income and spending.
- Recurring charges are detected on read from transaction history; only the person's
  overrides ("cancelled", "this is a bill") are stored.

### Security

- Bank access tokens are encrypted with AES-256-GCM before they touch the database.
- Passwords are hashed with scrypt. Sessions are random tokens stored hashed, in an
  HttpOnly, SameSite=Lax cookie (Secure in production).
- Every query is scoped to the signed-in user. Writes are rejected when the request's
  Origin isn't this app.
- Plaid webhooks are rejected unless their signature and body hash verify.
- Access to banks is read-only. The app has no ability to move money.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Start the app locally |
| `npm run check` | Type-check, lint and run all tests |
| `npm test` | Tests only (in-memory database) |
| `npm run db:generate` | After editing `src/db/schema.ts`: write a migration and refresh the embedded copy the demo uses |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run build` | Production build |

To run the tests against real Postgres instead of the in-memory database:
`DEMO_MODE=0 DATABASE_URL=postgres://... npm test`.

## Not built yet

- Password reset and email verification (needs an email provider).
- Bank sign-ins that redirect on phones (Plaid OAuth redirect). Desktop linking works without it.
- Investment transaction history (holdings and balances are synced; individual trades are not).
- Rules that auto-categorize by merchant, shared households, exports, and push notifications.
- The sign-in rate limiter is per server instance; put a shared limiter in front before a public launch.
- The Plaid integration is covered by tests against simulated Plaid responses and has not yet
  been run against Plaid's servers, which needs keys.
