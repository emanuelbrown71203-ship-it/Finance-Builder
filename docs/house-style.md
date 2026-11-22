# House style: how our apps look, feel and behave

These are the habits shared by the owner's apps (Tasks for Two, Roux, the YouTube Dashboard, the HOH
Operations Hub, and now Passbook). They were written down by reading all four and keeping what they
have in common. **Read this before building any screen, in this app or a new one.** When a new app is
started, copy this file into it.

If a rule here and an app's own existing look disagree, the app's existing look wins.

## 1. Who we build for

- The owner is not a developer. Explain changes in plain words, describe what changed on screen, and
  never ask them to edit code or run commands.
- The apps are used mostly on an **iPhone, opened from the home screen**, and sometimes on an iPad or a
  laptop. Design the phone screen first, then let it widen.
- The owner prefers a **bright, colourful look**. Dark mode exists, but it is a choice, not the default mood.

## 2. Phone-first rules (never skip these)

| Rule | Why |
| --- | --- |
| Anything tappable is at least **44px** tall | Fingers, not mouse pointers |
| Text boxes are **16px** or larger on touch screens | An iPhone zooms into anything smaller |
| Respect the notch and home bar (`env(safe-area-inset-*)`, `viewport-fit=cover`) | Home-screen apps draw edge to edge |
| **Nothing scrolls sideways** | Check every screen at 390px wide |
| No tap flash, no double-tap zoom (`-webkit-tap-highlight-color: transparent`, `touch-action: manipulation`) | Feels like an app, not a web page |
| Honour "reduce motion" | Some people get dizzy |
| A visible outline on keyboard focus | Works without a touch screen too |

## 3. Getting around

- **Phone and upright tablet: a bar along the bottom with every place in it, at most five.** No "More"
  menu: when an app grows, group its screens into places instead of hiding them. Icon above a short
  label. The active one is tinted with its section's colour. A count badge when something is waiting.
- **A place with several screens switches between them with tabs under its title** (like Budget /
  Transactions), one tap each. Never more than four tabs.
- **Wide screens: a menu down the left side** (about 230–260px) with the same places.
- **The last place is "You"**: the person's level and badges up top (in apps with the game layer), then
  one-tap rows to the recap, accounts, history and Settings. Its tab shows the level instead of an icon.
- **Settings is not a tab.** It opens from You (or a gear) and holds Appearance, the account and the
  version number, with a Back button.
- **Home is short:** the one number, what needs a look, a few things coming up, the latest few. Everything
  else lives in its place, a tap away. Don't grow Home with every new feature.
- Every screen has a **big bold title pinned to the top** on a phone, with at most one action beside it.
- A label must say what the thing does ("Equipment Issues", not "Notes"). If the owner has to guess
  what a button does, rename it.

## 4. Pop-ups

- On a phone a pop-up is a **sheet that slides up from the bottom**: rounded top corners, a small handle
  you can drag down, an X, and tapping outside or pressing Escape closes it. On a wide screen the same
  thing is a centred card.
- It stays above the on-screen keyboard.
- Use a sheet for picking from a list or a quick edit. Big content gets its own screen with a Back button.
- **Show details one tap away** rather than all at once. Long or occasional detail goes in a fold: a
  closed heading with a one-line summary.

## 5. Touch and gestures

- **Pull down to refresh at the top of every screen.** A home-screen app has no browser refresh
  button. The pull reloads the data and, if a newer version of the app is out, loads it. Switch the
  browser's own pull off so there is only one. A pull inside an open sheet or a text box does nothing.
- Things press in slightly when tapped (`active:scale-[0.98]`).
- Slide a row left for its most common action (remove it in Roux, change category in Passbook) and
  press-and-hold to drag (Tasks) are available patterns: use them only where they save real effort,
  and always give another way to do the same thing.
- A small celebration (confetti and a card, a few seconds, tap to close) for the moments that earn
  one: a goal reached, a list cleared. It can be switched off, and "reduce motion" hides the confetti.
- The owner likes a **companion with life** in an app (Passbook's robo dog, Nickel): drawn by hand,
  always on screen but small and draggable out of the way, with many small unscheduled movements
  (blinks, breathing, ear twitches, looking at what you touch, dozing off when left alone) and
  reactions to what happens in the app. It points things out rather than giving orders, and can
  be hidden, quietened or renamed in Settings.
- **It should feel like a real pet on the screen.** Now and then it gets up and wanders to a new spot
  (trotting legs, looking where it's going) and does something doggy when it arrives (sniffs, stretches,
  chases its tail). Never while you're touching the screen, while it's talking, asleep or being
  dragged, and not at all with "reduce motion" on; a Settings switch keeps it still. It moves out of
  the way of messages instead of hiding behind them.
- **It can be talked to**, using only what the phone already has (its own speech recognition and
  voice), and answers out loud. No AI service or keys unless the owner asks for one.
- **On money decisions it's headstrong.** Asked "can I afford this?", it gives a straight yes / not yet /
  no from the household's real numbers, warns plainly when bills would be at risk, and doesn't cave to
  pleading. Only new numbers change its answer.
- **It celebrates the small stuff.** Every small task (sorting or renaming something, adding a bill,
  cancelling a subscription, making a goal, putting money toward it, setting a limit) gets a quick
  cheer, and bigger moments (milestones, a cancelled subscription, a few chores in one day) get a
  little party.

## 6. Feedback

- **Undo, not "are you sure?"** After an everyday change (moved, cancelled, removed from a list) show a
  short message with an **Undo** button. Ask "are you sure?" only for things that are truly permanent,
  and name the action on the button ("Delete goal", not "OK").
- Messages sit at the **bottom, just above the tab bar**, dark with light text, about 4 seconds (7 with Undo).
- While numbers reload, **keep showing the old ones**, slightly dimmed. No flashing placeholders.
- An empty screen says what it is for and what to do next ("Your list is empty. Plan dinners and
  their ingredients land here."). A good empty state is a green "All clear."
- Errors say what happened and what to do. They don't apologise and they aren't vague.
- **Small wins feel like a game.** Everyday tasks earn points (XP) toward levels, with a daily streak
  and badges. Say so the moment it happens: a small "+15 XP" note at the top with what it was for, a
  coin sound, and a party with a fanfare for a level up. The game belongs to the look (a pixel font
  for levels and XP, a block-by-block XP bar, little pixel badge pictures), not a box bolted on top. Points are decided on the server, each thing counts once, there's a daily limit per
  kind, and Undo takes them back. Sounds are quiet, follow the phone's silent switch, and can be
  switched off in Settings.
- Up or down is always **an arrow and a number**, never colour alone.
- **Anything named by someone else can be renamed.** When names come from outside (a bank, a store, an
  import), let the owner rename them in place: "every one like this" (now and in future) or "just this
  one", with Undo. Tidy obvious codes on your own, leave clear names alone, and always keep the original
  visible one tap away ("Bank says: …").

## 7. The first screen

Home is for **what the person acts on**, not for charts:

1. A big, colourful band at the top with the one number that matters and a plain sentence about it.
2. "Needs a look": the short list of things waiting, each one a tap away from where you fix it.
3. A few of the latest things, with a link to the rest ("All bills", "All").
4. A block with nothing in it is left out, or says "All clear".

Charts and breakdowns live on their own screens.

## 8. The look

The owner found the old clean-and-quiet look **bland** and picked an arcade one ("Neon Arcade", November
2026, in Passbook). It's the starting point for a new app; an existing app keeps its own look unless the
owner asks.

- **Two moods, one app.** Light mode is a *daytime arcade*: pale lavender page with a faint grid, white
  cards with thick ink outlines and a hard offset shadow (like a sticker), a violet hero band with a
  yellow number. Dark mode is a *night arcade*: deep navy with the same grid, neon colours (mint,
  pink, yellow, electric blue) and a soft glow on lit things.
- **Type:** Bungee for titles and big numbers (chunky, arcade-sign letters), Rubik for everything you
  read (16px body), Press Start 2P only for short game numbers (level, +XP) at 8, 10, 12, 16 or 24px.
  Long titles wrap to two lines rather than cut off.
- **Shape:** cards have 18px corners and the thick edge; buttons and boxes 10px with a hard shadow
  that presses in when tapped. Tags are small rounded rectangles. Switches and tabs are chunky
  rounded squares, the selected one filled with the brand colour.
- **Bars are blocks.** Progress, budgets and XP fill block by block like a power bar, with a tick for
  where you'd be at an even pace. Lit blocks glow at night.
- **Charts** are hand-drawn SVG: step lines and square markers, columns built from blocks, dotted grid
  lines. They follow the dataviz skill, have a scrub readout, and never rely on colour alone.
- **Icons:** pixel icons on a 10×10 grid for the menu and every category (`pixel-icons.tsx`), in a
  small outlined tile. Simple line icons (lucide) for actions inside a screen. Emoji only for the
  person's own content or a little personality in a message.
- **Colour:** one brand colour for main buttons (violet by day, mint at night) and one colour per
  section. Soft tints carry meaning and are used the same way everywhere. Text never takes a chart
  colour. Every colour is a token in `globals.css`; nothing is hard-coded on a screen.
- **The companion and the app icon share one drawing.** Nickel is a neon robot pup (navy shell, a
  dark visor where his eyes glow mint, pointed ears, a coin on his chest, an antenna light for his
  mood), the same in light and dark. The home-screen icon is his face on a navy tile with a mint edge.
- Badges are 12×12 pixel pictures drawn in the app's own colour tokens; ones not won yet are grey.
- **Light, dark or automatic**, chosen in Settings with a three-way switch, remembered on that device
  only. Automatic is the default.

## 9. Words

- Plain words, sentence case, short. "Tap one to change its category." not "Select a transaction to
  modify its categorisation."
- Write amounts and dates the way people say them: "$81 a day through Nov 30", "Due tomorrow", "2 hours ago".
- Curly quotes and apostrophes in everything a person reads.

## 10. Home-screen app setup

Every app ships with: a web app manifest (`display: standalone`), `apple-mobile-web-app-capable`, an
apple-touch-icon (180px, square, no rounded corners: the phone rounds them), 192 and 512 icons plus a
maskable 512, and a status-bar colour that matches the page in light and dark. When the icon changes,
give the files new names: phones keep the old picture for an address they've seen.

## 11. How to work on a change

1. Say in simple terms what is about to change.
2. Make the change, one feature at a time.
3. Build it and fix every error.
4. Run it and **screenshot every changed screen at iPhone size (390 wide), in light and dark.** Look at
   the screenshots. Fix anything cut off, cramped or scrolling sideways.
5. Make sure it also works with sample data (demo mode).
6. Bump the version shown in Settings: small fix 1.2 → 1.2.1, new feature 1.2 → 1.3.
7. Commit, push, deploy, and confirm the deploy worked.
8. Give a short, simple summary of what changed and how to try it on a phone.

Ask before anything that changes or deletes real data.

## 12. Where to find each pattern

| Pattern | In Passbook | First built in |
| --- | --- | --- |
| Pull to refresh | `src/components/pull-to-refresh.tsx` | Tasks for Two, YouTube Dashboard |
| Bottom bar, side menu | `src/components/shell.tsx` | all four |
| The five places and the tabs under a title | `src/components/nav.tsx` | Passbook |
| Sheet pop-up with drag handle | `Dialog` in `src/components/ui.tsx` | Roux |
| Undo messages | `toast()` in `src/components/ui.tsx` | Tasks for Two, Roux, YouTube Dashboard |
| "Are you sure?" for permanent things | `confirm()` in `src/components/ui.tsx` | Tasks for Two, HOH Hub |
| Fold (closed, with a summary) | `Fold` in `src/components/ui.tsx` | YouTube Dashboard |
| Pinned big title | `PageHeader` in `src/components/ui.tsx` | Roux |
| Light / dark / automatic | `useTheme` in `src/components/use-api.ts`, Settings screen | all four |
| Section colours | `--c-*` and `.sec-*` in `src/app/globals.css` | HOH Hub |
| Neon Arcade tokens (edge, glow, hero, blocks) | `src/app/globals.css`, `Blocks` in `src/components/ui.tsx` | Passbook |
| Pixel icons | `src/components/pixel-icons.tsx` | Passbook |
| Sample-data mode | `src/server/demo.ts`, `src/db/seed.ts` | Roux, HOH Hub |
| Slide a row left | `SwipeRow` in `src/components/transactions.tsx` | Roux |
| Celebrations | `src/components/celebrate.tsx` | Tasks for Two |
| On/off switch, copy-a-link field | `src/components/settings-sections.tsx` | Roux, Tasks for Two |
| "Connect to Claude" private link | `src/server/connector.ts`, Settings | Tasks for Two |
| Sign in with Face ID (passkey) | `src/server/passkeys.ts`, Settings, sign-in page | HOH Hub, Tasks for Two |
| Weekly recap | `src/app/(app)/recap/page.tsx`, `src/components/recap.tsx` | Tasks for Two |
| A companion character (Nickel) | `src/components/nickel/`, `src/lib/nickel/brain.ts` | Passbook |
| Goal with a date and a track | `src/lib/finance/goalplan.ts`, `src/app/(app)/savings/goal/` | Passbook |

## 13. Keeping it secure

Every app that holds real data follows the same rules: sign-in is rate limited, sessions are private
cookies that expire, every lookup is limited to the person signed in, anything secret is stored
encrypted or as a hash, links that give access (like a Claude connector link) are shown once and can
be switched off, and nothing that connects two apps runs on sample data. Passbook's CLAUDE.md lists
them in detail.
