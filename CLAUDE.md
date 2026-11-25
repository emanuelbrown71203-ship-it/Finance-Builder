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
  **Home & rent, Utilities, Insurance and Loan payments are necessity categories** (`isNecessity` in
  `src/lib/categories.ts`): everything spent in them is a bill, repeating or not (unless it's an Extra),
  so they're never offered a budget; moving a charge to another category makes it everyday spending. A $0
  budget is allowed ("nothing on this"). A bounced payment ("RETURNED … PAYMENT") is a transfer.
  Worked out on read (`src/lib/finance/budget.ts`); only limits and rollover are stored. The budget's plan must always add up to Home's "left to spend" (what rollover
  carried in from earlier months is shown separately). Removed budgets stay as rows with `removed_at`:
  read them through `loadLimits` / `budgetState`, never straight from the table.
- **A month is planned on the money expected that month, not only what's arrived** (the owner's rule):
  paychecks still to come count (projected from the recognised paycheck), and with no regular paycheck
  recognised the plan expects the usual (middle of the last three months' income) by month's end
  (`usualIncome`, `buildMonthPlan`). The owner is paid every two weeks ("TEAM MEMBERS" is always pay; a
  remember rule files it as Income).
- **A lighter paycheck re-plans the month.** On Budget, "Expected in this month" opens the month's
  paychecks; a coming one can be set to an amount or "1/2/3 days short" (`income_adjustments`, keyed by
  the paycheck's series and date), and the plan uses it (`buildMonthPlan`'s `incomeAdjust`), with Undo.
- **Interest & fees** are totalled on Debt payoff (this month, 90 days, this year, by account:
  `feesAndInterest`); Nickel answers "how much interest have I paid?".
- **Round-ups read as round-ups.** SoFi moves each purchase's spare change from checking into a vault,
  named after the store, on both sides. A transfer under a dollar between bank accounts (or "Roundup …")
  is shown as "Round-up from/for <store>" (`isRoundUp`, `roundUpName`), a day's are grouped into one line,
  and they're kept off Home's latest. **A goal can follow a savings account** (`goals.account_id`): its
  balance is what's saved and the money moving in and out is its track; nothing is added by hand.
- **Month ahead** (Budget, this month and later): the month split at each payday, with money in, bills
  and everyday spending, spent so far then forecast from the last three months' pattern by thirds of the
  month (front-loaded months forecast heavier early), nothing in the no-spend week, down to "about $X
  left at the end of the month" (`src/lib/finance/forecast.ts`).
- **Weekly review** (`/recap`, modelled on Tasks for Two's): last week, the week ahead (bills, paychecks,
  left to spend, budgets to watch, the no-spend week) and a check-in list; "Finish my review" is a win
  once a week (`review`, keyed by the week's Monday).
- **Categories of the owner's own** ("Car", "Tools": `user_categories`, keys "c_…", a name and a pixel
  icon) are everyday spending: budgetable, rememberable for a store, made from the category picker
  ("+ New category") or the Categories page on You, renamed, or removed with Undo (its charges go back to
  Everything else). `category()` knows them everywhere: in the browser once `/api/me` loads, and on the
  server because `withUser` runs each request inside the person's own (`src/server/category-scope.ts`).
  Saving a category checks it's built in or the person's own (`isUsableCategory`).
- **The app has five places** (`src/components/nav.tsx`): Home, Spending, Bills, Wealth, You. No "More"
  menu. Spending switches Budget / Transactions with tabs under the title. **Wealth's four screens (Net
  worth, Savings, Investing, Debt payoff) each stand on their own**, with their own title and no tabs, as
  the owner prefers: on a phone the Wealth button opens a sheet to pick one, and the side menu on a wide
  screen lists them separately. A new screen joins a place (as a tab, a screen in Wealth's sheet, or a
  row on You), and Home stays short.
- Bank access tokens are stored encrypted. The app can read accounts and can never move money.
- **Pull to refresh asks the banks to check now** (Plaid `/transactions/refresh`, `refreshItem`), at most
  once every five minutes per bank (`items.refreshed_at`, claimed atomically), only on a pull or the
  refresh button. Plaid otherwise checks 1 to 4 times a day. The owner agreed to it: it's included on the
  Plaid Trial plan but billed per call on paid plans, so never call it on a schedule or in a loop. New data
  arrives through the webhook; the app looks again 30 and 90 seconds after a pull (`syncNow`).
- **Card payments vary and needn't be in full** (the owner pays big balances down over time, and not
  the same amount every month). Paying a card is a transfer, so the amount never changes spending or
  "left to spend" (purchases count when they're made). "Coming up", its total and Nickel's purchase
  check set aside only a card's **minimum** due (shown with the balance beside it), never the whole
  balance. A card's payoff plan starts from how fast it has actually gone down lately
  (`recentMonthlyPaydown`: payments less new charges, the last three whole months, averaged), unless the
  person sets their own amount. Paying back rent or the month's spending put on a card is not paying down
  debt (the owner charges rent to a card and pays it back through the month), and a payment the bank
  sent back (same amount back out within ten days, filed as a transfer or a "fee") never counts. A card
  that charged interest or fees in the last 90 days is never "paid as you go". Each card says how much
  of this month's bills went on it, since that's part of its balance until it's paid back.
- **Shared bills count only the owner's part.** The owner pays half the rent and their partner sends the
  other half (it arrives as a transfer, not income). A bill's share (`recurring_overrides.share_bp`, 5000 =
  half, set on the bill's sheet: All mine / I pay half / Other %) scales that bill everywhere it's planned or
  totalled: its amounts, Coming up, Paid lately, Home's plan, the budget and Nickel (`loadRecurring` scales
  the bundle's history). The bank's own transaction is never changed, and a card's balance still has the
  whole charge.
- **Everything that asks for attention opens the thing itself.** "Needs a look" links straight to the bill
  (`/bills?open=<key>`), the budget category, or the flagged first charge (`/bills?possible=<key>`, with
  "It's not a subscription"); Coming up rows open their bill (a card's minimum opens Debt payoff); a budget
  category's charges open the transaction editor. The category picker groups Bills (necessities) apart
  from Everyday spending.
- **The no-spend week** is the last seven days of every month, the owner's own goal: nothing spent but
  bills (Extras count as spending), so what's left of the month goes to savings (`src/lib/finance/nospend.ts`,
  worked out from the month plan's days). Home shows a card from three days before (one block per day,
  green when clear) and for a week after, with "Put $X in savings" (a goal deposit; it can't move money).
  A whole clean week is a win (`nospendweek`, 75 XP, the Clean Week badge); Nickel cheers it on.
- **Savings is the budget's first line**: the goals' monthly amounts (set aside before everyday budgets),
  what's gone toward them this month, and a sheet to change a goal's monthly amount, add money, or start one.
- **Bills seen twice count.** Rent, utilities, insurance or a loan charged two months running at about
  the same amount is a bill (banks send only a few months at first); other charges need three. Interest
  and fees are never bills. The Bills screen lists what bills and Extras charged this month and last
  ("Paid lately"); card payments never appear there.
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
- **Phone notifications** (web push from the home-screen app; `src/server/notifications.ts`, wording in
  `src/lib/notifications.ts`): a bill the person follows is paid ("Tell me when it's paid" on the bill, or the
  list in Settings: `recurring_overrides.notify_paid`, settled payments only, after each bank sync),
  checking is short for bills it pays in the next 3 days (card-paid bills don't count, a card's minimum
  does), money in (paychecks, refunds, money sent; never a move between the person's own accounts or a
  round-up; a pending deposit is told about once, since its row survives settling), a budget at 80% and
  again over, bills due tomorrow (one note), Monday's weekly review, and the no-spend week's first day.
  All but bills paid can be switched off (`user_settings.notify_*`). **Never between 9 p.m. and 8 a.m.**:
  what came in overnight goes out with the first bank update after 8 (`afterSync`). The morning ones also
  come from a daily Vercel cron when `CRON_SECRET` is set (`vercel.json`, `/api/cron/notify`, GET only
  because the scheduler can't POST; 404 until the secret exists). Each note goes
  out once (`notifications_sent`). Push is written out by hand in `src/server/webpush.ts` (RFC 8291/8292,
  tested against the RFC's worked example): the site's push key is derived from `TOKEN_ENCRYPTION_KEY`
  (`derivedKey`), device addresses are stored encrypted (`push:<user>`), and notes only ever go to the
  browsers' own push services (`isPushEndpoint`). **A device's notes end with the sign-in it was turned on
  from** (`push_subscriptions.session_id`, cascades; an expired or idle sign-in's device is dropped when
  sending, after one last "Notifications are paused" note): signing out, sign out everywhere, a new password
  (other devices) or two weeks unused. Signing in again quietly puts a device back (`PushKeeper`, `auto`),
  except one removed from the list on another device (`push_removed`, kept across sign-ins; a renewed push
  address sends the one it `replaces`). "Show amounts" off leaves every dollar figure out (notes show on the lock screen).
  Notes are worked out after a sync (webhook, or `after()` on refresh), never inside `syncItem`.
  `public/sw.js` only shows notes and opens a screen on this site (`safeUrl`): it never caches. On an
  iPhone, notifications need Passbook on the home screen. The sample household (shared by every visitor)
  lists no devices, and "Send a test" there reaches only the device that pressed it.
- **Asking Nickel is one tap**: every bubble has "Ask me something". Anything worded as a question
  ("how much is my rent?", "rent") is answered, never taken for an instruction (`parseCommand` only acts
  on "add…", "new…", "can you add…" and the like), and what's typed survives the panel closing. He answers what's left, what's due,
  spending by category, store, today, this week, last week or last month, what's owed (cards, loans, one
  card), what's in the bank, where the money goes, which budgets are over, what's saved, income and
  Extras.
- **Nickel (the robo dog) points things out** from the person's own numbers, and never gives
  investment advice (no stock, fund or crypto picks); he says he isn't a financial advisor. His wording
  lives in `src/lib/nickel/brain.ts` and tests check for advice-like phrasing.
- **Asked about a purchase ("can I afford…?", "should I buy…?"), Nickel is headstrong**, at the owner's
  request: a straight yes / not yet / no from the household's numbers (`judgePurchase` in
  `src/lib/nickel/answers.ts`), with the reason in numbers, and a plain warning when bills would be at
  risk. Pleading or asking again never changes it; only new numbers (a different price) do. **On a
  payment plan** ("pay in 4", "over 6 months", "with Affirm": `planIn`, `judgePlan`) he judges the
  payments, not the price: the first today, the rest every two weeks (or month), bills before payday
  first, then this month's share, and says to take it only at 0% and paid from checking when cards are
  costing interest. **In the no-spend week any purchase is "not yet"** (the owner's own goal), unless
  bills are at risk ("no").
- **The month is explained the same way everywhere, in the owner's words** (`src/components/month-money.tsx`,
  on Home and Budget): Came in (so far, and still coming) − Already spent (bills, everyday) − Spoken for
  (bills still to pay, savings: promised, not spent yet) = **Free to spend**, or **Over by $X** in red.
  "Free to spend" is the one number (Home's and Budget's are the same; "Left in your budgets" is only the
  budgets' own total). Budgets say "Over by $X" plainly with "$Y spent of $Z" under it. Nickel answers
  "what's spoken for?", "how much am I over?" and "what's free to spend?" the same way.
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
  hangs on the driver's pipelined queries, which takes the whole live site down. The session pooler
  allows 15 connections in all, and frozen server copies keep theirs, so each copy gets **one**
  (`max: 1` in `src/db/index.ts`); more ran it out ("max clients reached") after deploys. Tests against a
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
