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

- Five places, all in the bar along the bottom on a phone (a menu down the side on a wide screen):
  **Home**, **Spending** (Budget and Transactions, switched with tabs under the title), **Bills**,
  **Wealth** and **You** (your level and badges, the weekly recap, accounts, names, activity and
  Settings). No "More" menu. Wealth's four screens (Net worth, Savings, Investing, Debt payoff) each
  stand on their own: on a phone the Wealth button opens a sheet to pick one; on a wide screen the side
  menu lists them separately.
- **Pull down at the top of any screen to refresh.** It checks the banks, reloads every number and
  loads a newer version of the app if one is out.
- Pop-ups slide up from the bottom and can be dragged down to close.
- Everyday changes show a short message with **Undo**. Only permanent things ask "are you sure?".
- Settings has Automatic / Light / Dark and the version number.
- It can be added to an iPhone or Android home screen and opens full screen like an app.

## The screens

| Place | Screen | What it does |
| --- | --- | --- |
| Home | Home | What's left to spend this month after bills and savings, what needs a look (bills due, price rises, budgets over or on pace to go over, the weekly recap), your budgets that need a look most, what's coming up and the latest activity. Your level sits at the top. |
| Spending | Budget | The plan for the month's money (money in, bills, saving for goals, everyday budgets, and what has no job yet) and each everyday category: what's left, what that is a day, where it's heading at the usual pace, and On track / Heads up / Over. Tap a category for its charges, six months, its budget and rollover. "Suggest a budget" fills in amounts from the last three months, sized to fit ($0 is allowed). Home & rent, Utilities, Insurance and Loan payments are necessities: everything spent there counts as a bill, never against a budget. The month's spending pace chart and six months of money in and out. |
| Spending | Transactions | Everything from every account, live. Search and filter. Tap one to rename it, change its category or add a note. |
| Spending | Names | Bank code that could be clearer, with a suggested name to keep or change, and every name you've given. Reached from Transactions and You. |
| Bills | Bills | Two lists, found from history plus any you add by hand (repeating or a one-off coming up): **Bills**, what you must pay (rent, utilities, insurance, loans, phone), set aside each month; and **Extras**, subscriptions you could live without, which count against your budget. One tap moves a charge between them. Upcoming due dates, what bills and Extras charged this month and last ("Paid lately"; card payments never count), price-increase alerts, rename, "I cancelled this". Rent, utilities, insurance and loans count as bills from their second month. |
| Wealth | Net worth | What you own minus what you owe over time, by account. Add things no bank reports (a car, a house) by hand. |
| Wealth | Savings | Savings balance, monthly saving history, and goals. Each goal with a date gets a **track**: what to put away a month, a week and each payday to make it, whether you're ahead or behind, month-end checkpoints, 25/50/75/100% milestones, and ideas for where the money could come from. |
| Wealth | Investing | Total, trend, split by type, and holdings with gain or loss. |
| Wealth | Debt | When the loans will be paid off at today's payments, and what a little extra each month changes. |
| You | You | Your level, XP, streak and badges, then one tap to the weekly recap, accounts, names, activity and Settings. |
| You | Badges | Every badge (won ones in colour, the rest with how to win them), what earns XP and where to go to do it, and the latest wins. |
| You | Weekly recap | Last week in money: spent against the week before, money in, bills paid, no-spend days. |
| You | Accounts | Linked banks, their status, and linking or removing one. |
| You | Activity | What Nickel and Claude changed when asked, newest first, each with Undo for 30 days. |
| You | Settings | Light or dark, celebrations, game sounds, Nickel, Face ID sign-in, Connect to Claude, Tasks for Two, remembered categories, your account, version. |

**How the budget works.** A category's budget is for everyday spending, and that includes Extras: Netflix
counts in Entertainment like any other spending. Bills (necessities) come out of the month first and are
planned in Bills, so rent never eats a budget (it's shown beside its category). The plan adds up to Home's number: what's left in your budgets, plus money not planned yet,
less spending with no budget, is "left to spend" (apart from anything rollover carried in from earlier
months, which is shown on its own line). **Rollover** (per category) carries what's left, or what was
overspent, into the next month; changing the limit keeps what was carried so far at the old limit.
Removing a budget can be undone exactly (it's kept, marked removed). Each category's forecast blends its usual pace (the last three
months) with this month's. Worked out on read by `src/lib/finance/budget.ts`; only the limits and
rollover choice are stored. At the start of each month, every budget kept last month earns XP, and
keeping all of them earns more ("On Budget" and "Clean Sweep" badges).

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
- **Apple Card from its statements.** Apple shares Apple Card only with App Store apps, so it can't
  be linked through Plaid on the web. Instead, on You → Accounts, pick the statement exported from
  Wallet (Apple Card → Card Balance → a statement → Export Transactions → CSV). Passbook shows
  what's new before saving, asks what the card owes now, and brings it in as a card account with Undo.
  Bringing the same month in twice adds nothing. Purchases count in budgets; paying the card off is a
  transfer. Any date range can also be exported at card.apple.com, as often as you like.
- **Apple Card taps, live.** An iPhone Shortcuts automation (the Wallet trigger, "Transaction" before iOS 26; Apple Card only)
  sends each tap at a register to a private link, and the purchase shows up within seconds as pending.
  The next statement confirms it (same amount within three days), keeping a category you picked, and
  replaces taps that never went through (declined, or a tip changed the amount). Online purchases come
  with the statement. Set it up on You → Accounts → Apple Card; the link can only add purchases.
- **A little celebration** when a savings goal is reached (it can be switched off).
- **Small wins add up, like a game.** Sorting a charge, giving bank code a clear name, adding a bill,
  cancelling a subscription, setting a budget limit, putting money toward a goal, a goal passing
  25/50/75/100%, tuning the debt plan, opening the app each day and days with no everyday spending
  all earn XP. XP makes levels; daily check-ins make a streak; 14 badges have little pixel pictures.
  A "+XP" note pops up when something earns some, there's a level-up party, and 8-bit sounds (made by
  the browser, quiet, silent when the phone is; off in Settings). The level block, the XP bar and the
  badges are part of the arcade look. The server decides what earns XP
  (`src/server/game.ts`, rules in `src/lib/game/progress.ts`): each thing counts once, each kind has a
  daily limit, and Undo on the same day takes the XP back. Home shows the level and streak at the top.
- **Nickel, the robo dog.** He sits in the corner of every screen, blinks, breathes, wags, looks
  toward whatever you touch, naps when left alone, perks up at new charges and hops when money
  goes into a goal. Tap him for what he's noticed in your numbers (bills due, price rises, budgets,
  goals behind or ahead, payday, streaks); hold him for options; drag him to the other side.
  He points things out and is clear he isn't a financial advisor. His "brain" is rules over your
  own numbers (`src/lib/nickel/brain.ts`), so nothing leaves the app. Hold him for options:
  - **Talk to me**: tap the mic and talk (the phone's own speech recognition: Apple's on an iPhone,
    Google's in Chrome; no AI chat service, no cost)
    or type. He answers out loud in the phone's own voice. Ask everyday questions answered from your
    numbers ("what's left to spend?", "when is rent due?", "how much did I spend on dining?", "how's
    my Japan goal?"), or ask about a purchase ("can I afford a $300 jacket?") for a straight yes /
    not yet / no with the reason; he holds to it when pushed, and only new numbers change it.
    Or give an instruction the way you'd say it ("add Netflix $15.99 on the 5th",
    "upcoming vet bill $250 next friday", "new goal Japan $4,500 by June", "add $200 to the
    emergency fund", "student loan rate 4.5%", "rename SQ *TARTINE to Tartine"). He understands it
    on the phone with plain rules (`src/lib/nickel/commands.ts`, no AI service), does it, and reports
    back with Undo. If something's missing he asks for just that, or opens the bill form filled in.
  - **Chat with Claude** opens a chat in your own Claude app (on your own Claude plan) with a question
    ready; Claude reads your numbers through the connector below.
  He also wanders the whole screen: every so often he trots somewhere (along the bottom, up a side,
  out in the open) and sniffs around. He turns side-on to walk across, climbs up and down with his belly
  and paws flat on the glass (never a diagonal: `src/lib/nickel/walk.ts`), and leaves little paw prints
  that fade behind him. He heads back to his spot as soon as you scroll or tap, so
  he's never in the way. Never while you're touching the screen, while he's talking or asleep, or
  with "reduce motion" on; he hops up out of the way of messages. He cheers small money tasks (renaming,
  sorting, adding a bill, cancelling a subscription, making or adding to a goal, setting a limit,
  changing the debt plan) and throws a little party for milestones, cancelled subscriptions and
  every few chores in a day. Settings: show him, quiet mode, wandering on or off, answers out loud,
  rename him.

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
   Make it long, and remove it once everyone in the household has an account (then redeploy:
   the sign-in pages read it when the site is built).
5. **No login wall in front of the site.** Plaid's webhook (`/api/plaid/webhook`), the Apple Card
   tap link and the Claude connector must reach the app, so the host's own login protection
   (Vercel Authentication) can cover previews but not the live address.

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
- **The look: Neon Arcade.** A daytime arcade in light mode (lavender grid, white cards with thick ink
  outlines, a violet hero with a yellow number) and a night arcade in dark mode (navy, neon, soft glows).
  Bungee for titles and big numbers, Rubik to read, Press Start 2P for level and XP. Pixel icons
  (`src/components/pixel-icons.tsx`), block meters (`Blocks` in `src/components/ui.tsx`), step-line
  charts. Everything is a token in `src/app/globals.css`. Nickel is a neon robot pup, and the home-screen
  icon is his face (`public/nickel-*.png`, `public/icon-nickel.svg`). See `docs/house-style.md`, section 8.

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
- XP is written down where a change happens (`win()` in `src/server/game.ts`, in `player_wins`),
  never sent from the browser. A failed win is logged and never stops the change it was for.
- Names work the same way: `transactions.name` is always the bank's text. A one-off name is
  `custom_name`; "every charge like this" is a row in `name_rules`, matched on the tidied bank text.
  Keys for bills, categories and the Tasks link come from the bank's text, never the shown name.

### Security

- Bank access tokens, and the Tasks for Two link, are encrypted with AES-256-GCM before they touch
  the database, each sealed to its owner so a copied value can't be opened on someone else's row.
- Passwords are hashed with scrypt at OWASP's recommended strength; common ones and ones built
  from your name or email are refused. Passkeys store only the public half of the key and
  always check it's you (face, fingerprint or PIN).
- New accounts are by invite code only, and with no code set sign-up is closed.
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
