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

## Checking your work

1. `npm run check` (types, lint, tests). `npm run build` before deploying.
2. `npm run dev`, then screenshot every changed screen with Playwright at iPhone size in light and dark,
   and look at them. Check for sideways scrolling.
3. Touch features (pull to refresh, sheets) can be driven in Playwright with a phone device and
   `Input.dispatchTouchEvent` over a CDP session.
4. After changing `src/db/schema.ts`: `npm run db:generate`.

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
