# Neon Arcade Implementation Plan

> Executed in-session (the owner said "build it"). Spec: `docs/superpowers/specs/2026-11-22-neon-arcade-design.md`.

**Goal:** Restyle the whole app as Neon Arcade, redraw Nickel and the app icon, and make subscriptions "Extras".
**Architecture:** Token values + shared components + hand-drawn pieces; Extras is a classification change in the plan and budget inputs.
**Tech stack:** Next.js 16, Tailwind 4 tokens in `globals.css`, inline SVG, fontsource.

## Global constraints
- Only colour tokens from `globals.css` (new values allowed; no stray hex in components except Nickel/icon art).
- Text contrast ≥ 4.5:1 in both modes; tap targets ≥ 44px; no sideways scrolling at 390px.
- Sample-data mode and every existing walkthrough keep working.

## Review focus
1. Dark and light both readable on every screen (tags, muted text, tinted tiles).
2. Nickel's moods and animations still work (eyes, mouth, antenna colour, walking legs, sleeping).
3. Extras: a subscription moved to Bills is reserved again; a bill moved to Extras counts in its budget.
4. Charts still have readouts and labels; nothing relies on colour alone.
5. The installed app picks up the new icon (new file names so phones don't keep the old one).

## Tasks
1. **Extras** — `buildMonthPlan` and the budget's bill ids take only `kind === "bill"` series; Bills screen
   says "Extras"; tests in `tests/app.test.ts` (Netflix counts in Entertainment; moving it to Bills
   reserves it again).
2. **Tokens, fonts, base CSS** — new light/dark values, grid background, hard shadows, radii, `.display`
   and `.figure` in Bungee, `.pixel`, glow variables; fontsource Bungee + Rubik.
3. **Shared components** — `Sheet`, `Button`, `Meter` (blocks), `Segmented`, `SectionTabs`, inputs, tags.
4. **Pixel icons** — `src/components/pixel-icons.tsx`; used by the tab bar, side menu and `CategoryIcon`.
5. **Frame and game pieces** — shell, Logo (Nickel head), `LevelBlock`/`LevelChip`/`XpBar`, Home hero,
   `BudgetBar` in blocks.
6. **Charts** — step lines, block bars, glow in dark (`src/components/charts.tsx`).
7. **Nickel** — redraw `robo-dog.tsx` as the neon pup, same props and class hooks.
8. **App icon** — new SVG + PNGs (new names), manifest and status-bar colours.
9. **Sweep** — screenshot every screen light/dark at 390px, fix leftovers; docs (house style, README,
   CLAUDE.md); version 1.1.0; checks; publish.
