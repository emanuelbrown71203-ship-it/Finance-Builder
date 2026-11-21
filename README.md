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
| Transactions | Everything from every account, live. Search and filter. Tap one to rename it, change its category or add a note. |
| Names | Bank code that could be clearer, with a suggested name to keep or change, and every name you've given. Reached from Transactions and Settings. |
| Bills | Recurring bills, subscriptions and income, found from history, plus any you add by hand (repeating or a one-off coming up). Upcoming due dates, price-increase alerts, rename, "I cancelled this". |
| Budget | Spending by category against monthly limits, month over month, and six months of money in vs money out. |
| Net worth | What you own minus what you owe over time, by account. Add things no bank reports (a car, a house) by hand. |
| Savings | Savings balance, monthly saving history, and goals. Each goal with a date gets a **track**: what to put away a month, a week and each payday to make it, whether you're ahead or behind, month-end checkpoints, 25/50/75/100% milestones, and ideas for where the money could come from. |
| Investing | Total, trend, split by type, and holdings with gain or loss. |
| Debt payoff | When the loans will be paid off at today's payments, and what a little extra each month changes. |
| Weekly recap | Last week in money: spent against the week before, money in, bills paid, no-spend days. |
| Accounts | Linked banks, their status, and linking or removing one. |
| Settings | Light or dark, Face ID sign-in, Connect to Claude, Tasks for Two, Names, Activity, remembered categories, your account, version. |
| Activity | What Nickel and Claude changed when asked, newest first, each with Undo for 30 days. |

Smaller things that make it easier to live with:

- **Remembered categories.** Move a charge to a category and every charge from that place follows, now
  and in future. One Undo puts it all back.
- **Slide a transaction left** to change its category in one tap.
- **Names you'll recognise.** Banks send things like `SQ *TARTINE BAKERY 0423 SAN FRANCISCO CA`.
  Passbook tidies obvious bank code on its own ("Tartine Bakery") and leaves clear names alone.
  Rename any transaction or bill: "every charge like this" (past and future, and every branch of
  the same shop), "only when it's $1,200" (for Venmo, Zelle and the like), or "just this one".
  The Names screen lists what could be clearer with a one-tap "Keep". Every rename has Undo, the
  new names are searchable, and what the bank sent always stays in the charge's details. Renames
  are applied when reading (`src/lib/finance/names.ts`), never written over the bank's text, so
  bills, remembered categories and the Tasks for Two link keep matching.
- **Subscription help.** A warning before a yearly charge renews, a note when a known service charges
  for the first time, and where to go to cancel.
- **A little celebration** when a savings goal is reached (it can be switched off).
- **Nickel, the robo dog.** He sits in the corner of every screen, blinks, breathes, wags, looks
  toward whatever you touch, naps when left alone, perks up at new charges and hops when money
  goes into a goal. Tap him for what he's noticed in your numbers (bills due, price rises, budgets,
  goals behind or ahead, payday, streaks); hold him for options; drag him to the other side.
  He points things out and is clear he isn't a financial advisor. His "brain" is rules over your
  own numbers (`src/lib/nickel/brain.ts`), so nothing leaves the app. Hold him for options:
  - **Tell me what to do**: type it the way you'd say it ("add Netflix $15.99 on the 5th",
    "upcoming vet bill $250 next friday", "new goal Japan $4,500 by June", "add $200 to the
    emergency fund", "student loan rate 4.5%", "rename SQ *TARTINE to Tartine"). He understands it
    on the phone with plain rules (`src/lib/nickel/commands.ts`, no AI service), does it, and reports
    back with Undo. If something's missing he asks for just that, or opens the bill form filled in.
  - **Chat with Claude** opens a chat in your own Claude app (on your own Claude plan) with a question
    ready; Claude reads your numbers through the connector below.
  Settings: show him, quiet mode, rename him.

## Connections

- **Sign in with Face ID** (a passkey). Set a device up in Settings, then sign in with your face or
  fingerprint and no password.
- **Ask Claude about your money.** Settings gives you a private link to add to Claude as a custom
  connector. Claude can then answer questions from your real numbers, and, when you ask, add a bill or
  a one-off bill, add or change a savings goal (and note money put toward it), change a loan's rate or
  payment, and rename charges. Each change is logged under Settings, Activity, with Undo, and limited to
  40 an hour. It can't delete anything, move money, or touch bank connections or sign-in. In sample-data
  mode there is a try-it link that works on the sample household.
- **Tasks for Two bills tick themselves off.** Paste your Tasks for Two connector link into Settings
  and say which merchant pays each bill. When the bank shows a settled payment to that merchant near
  the due date, the bill is ticked off in Tasks for Two. It never runs on sample data.

## Going live with real bank data

Demo mode ends when Plaid keys are present. You need three things:

1. **A Postgres database.** Put its connection string in `DATABASE_URL`.
   - **On Supabase (the intended home), always install with `scripts/install-sql.ts`**, described
     under "On Supabase" below. Never run `npm run db:migrate` against a Supabase project: it
     creates the tables in `public`, which Supabase serves to browsers, with no row security.
   - On a plain Postgres database of Passbook's own, `npm run db:migrate` creates the tables.
2. **Plaid keys.** Sign up at https://dashboard.plaid.com, copy the client ID and the
   Sandbox secret into `PLAID_CLIENT_ID` and `PLAID_SECRET`, and leave `PLAID_ENV=sandbox`.
   Sandbox uses practice banks (username `user_good`, password `pass_good`) and is free.
   Real banks need Plaid's Production approval, then `PLAID_ENV=production` with the
   production secret.
3. **An encryption key and the app's address.** `TOKEN_ENCRYPTION_KEY` (generate with
   `openssl rand -base64 32`) and `APP_URL` (where the app is hosted: sign-in, passkeys and
   the same-site check are tied to it, and Plaid calls `/api/plaid/webhook` on it).
4. **An invite code.** `SIGNUP_CODE`: new accounts need it. With none set, sign-up is closed.
   Make it long, and remove it once everyone in the household has an account.

A deployed site with Plaid keys refuses to answer until the database, the address and the
encryption key are all in place, so real data can never land in the in-memory database.

`.env.example` lists every variable with notes. Copy it to `.env.local`.

Once live, people create an account with the invite code, link a bank through Plaid Link, and
the first sync pulls up to two years of transactions plus balances, holdings and card or loan
details.

### On Supabase (alone or sharing a project with other apps)

`npx tsx scripts/install-sql.ts` prints the SQL to install Passbook walled off from
everything else in the project:

- every table goes in its own `passbook` schema, never `public`, which Supabase serves to
  browsers. Every statement names that schema and the whole thing is one transaction, so it
  lands in the right place however it is run;
- the app signs in as its own `passbook_app` role, which can read and write Passbook's tables
  and no other app's tables, and cannot change the database's structure. (Like every role, it
  can still use what Supabase leaves open to all roles: functions in `public` granted to
  everyone, and the `pg_net` extension's request queue in the `net` schema. Closing those
  means changing grants the other apps rely on, so it is a separate, deliberate step.);
- row level security is on for every table, with access for that role only.

Create the role first (`create role passbook_app login password '…'`), run the SQL as the
database owner, and point `DATABASE_URL` at the **session** pooler (port 5432) as
`passbook_app.<project ref>`. Not the transaction pooler (port 6543): the database driver
sends several queries down one connection at once, and the transaction pooler hangs on that. The password can be left out of the address and put in
`DATABASE_PASSWORD` instead. `GET /api/health` then says whether the database answers
(`database`) and whether the app's own connections answer several questions at once (`pool`).
For later schema changes: `npx tsx scripts/install-sql.ts --from <n>`.

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
- Names work the same way: `transactions.name` is always the bank's text. A one-off name is
  `custom_name`; "every charge like this" is a row in `name_rules`, matched on the tidied bank text.
  Keys for bills, categories and the Tasks link come from the bank's text, never the shown name.

### Security

- Bank access tokens, and the Tasks for Two link, are encrypted with AES-256-GCM before they touch
  the database, each sealed to its owner so a copied value can't be opened on someone else's row.
- Passwords are hashed with scrypt at OWASP's recommended strength; common ones and ones built
  from your name or email are refused. Passkeys store only the public half of the key and
  always check it's you (face, fingerprint or PIN).
- New accounts are by invite code only.
- Sessions are random tokens stored hashed, in an HttpOnly, SameSite=Lax cookie (Secure and
  `__Host-` prefixed in production). They end after 30 days, or 14 days unused. You can change
  your password (which signs out every other device) or sign out of every device at once
  (which also switches off the Claude link).
- **Confirm it's you.** Adding a Face ID device, making a Claude link, removing a bank or
  deleting the account asks for the password or Face ID again unless you signed in within the
  last ten minutes. Face ID only counts from a device belonging to the person signed in.
- Every query is scoped to the signed-in user. A write is refused unless it came from this app's
  own address (`APP_URL`), scheme included.
- Sign-in attempts are rate limited per address and per account, in the database, so the limit
  holds across server instances, without letting a stranger lock you out of your own account.
  Connector keys are limited the same way.
- Every response carries a content security policy and the usual hardening headers.
- Plaid webhooks are rejected unless their signature and body hash verify against a current
  Plaid key.
- Nothing secret is logged: errors are reduced to a kind, a code and a place before they are
  written down (`describeError`), because the raw ones carry keys, tokens and query values.
- The Claude connector key is stored as a hash, shown once, replaced or revoked from Settings,
  and switches itself off after 90 days unused. Text from banks is flattened before Claude sees it.
- The Tasks for Two link only talks to the one server it was set up with, and only runs on real
  banks (not sample data, not Plaid's practice banks).
- Access to banks is read-only. The app has no ability to move money.
- You can delete your account and everything kept for it from Settings.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Start the app locally |
| `npm run check` | Type-check, lint and run all tests |
| `npm test` | Tests only (in-memory database) |
| `npm run db:generate` | After editing `src/db/schema.ts`: write a migration and refresh the embedded copy the demo uses |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npx tsx scripts/install-sql.ts` | Print the SQL to install Passbook in its own walled-off schema of a shared database |
| `npm run build` | Production build |

To run the tests against real Postgres instead of the in-memory database:
`DEMO_MODE=0 DATABASE_URL=postgres://... npm test`.

## Not built yet

- Password reset and email verification (needs an email provider). Face ID sign-in is the way
  around a forgotten password for now. (Changing a password you know is in Settings.)
- Password sign-in can still be slowed for everyone, the owner included, by a flood of wrong
  guesses at one email from many addresses (300 an hour is the ceiling). Face ID sign-in is
  not affected, so set it up. A "this device has signed in before" pass would close the gap.
- Checking the database server's certificate. The connection is always encrypted, but the
  server's identity is not verified unless the address says `sslmode=verify-full` and the
  database's CA certificate is supplied. On Supabase that means adding their CA certificate.
- A way to remove a bank whose saved connection can no longer be read at all (a lost encryption
  key). Today it is kept on purpose, so a live connection is never orphaned at Plaid.
- A stricter content security policy for scripts (hashes instead of `'unsafe-inline'`). The app
  has no place where outside text is turned into markup, so this is a second line of defence.
- Free-trial detection: a bank can't see a trial, only its first charge, which is flagged as
  "might be new".
- Bank sign-ins that redirect on phones (Plaid OAuth redirect). Desktop linking works without it.
- Investment transaction history (holdings and balances are synced; individual trades are not).
- Shared households, exports, and push notifications.
- A bill you add by hand isn't matched to the bank's payment for it, so if the bank later shows the
  same bill too, remove the hand-added one.
- The Tasks for Two link reuses that app's single Claude connector link, so the same link has to be
  pasted in both places. A separate key for Passbook would need a small change in Tasks for Two.
- The Plaid integration is covered by tests against simulated Plaid responses and has not yet
  been run against Plaid's servers, which needs keys.
