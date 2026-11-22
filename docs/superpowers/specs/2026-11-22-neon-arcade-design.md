# Neon Arcade: Passbook's new look (design)

**Why.** The owner found the app bland. They picked a blend of two mockups (Arcade and Neon Night) on
the "Passbook looks" design page, preferred the sleek neon Nickel over the pixel one, and asked for the
home-screen icon to be Nickel. Separately: bills are necessities only; subscriptions you could live
without (Netflix) are "Extras" and come out of the budget.

## Goals
- One look across every screen, light and dark (the phone's setting picks; Settings can force one).
- **Dark:** navy `#0B0D26` with a faint 24px grid; neon mint `#3DFFB5`, yellow `#FFE45E`, pink `#FF5FD2`,
  blue `#5A8CFF`, violet `#9B8CFF`; cards `#15183D` with a 2px edge `#2E3375` and a hard 5px offset
  shadow `#04050F`; glows only on what matters (the main number, active tab, level, progress).
- **Light:** lavender `#F1EEFF` with the same grid; white cards with a 3px ink `#1A1530` outline and a hard
  ink shadow; violet `#5B3DF5` as the brand; the Home number in yellow on violet.
- **Type:** Bungee for titles and money figures, Rubik for everything else, Press Start 2P for level/XP.
- **Icons:** pixel icons for the five places and every category; small control icons stay line icons.
- **Charts:** step lines instead of smooth ones, bars made of blocks, glowing in dark mode.
- **Nickel:** the neon robo pup (dark visor face with glowing eyes, pink antenna light, angular blue ears,
  glowing coin) in both modes; every existing animation hook kept.
- **App icon / logo:** neon Nickel on navy with a mint edge.
- **Extras:** subscription-kind charges count against their category's budget and aren't reserved as
  bills on Home; the Bills screen shows "Bills" and "Extras", one tap moves between them.

## Non-goals
No new screens or features beyond Extras; no change to how numbers are worked out otherwise.

## Anti-goals
Unreadable text (contrast below 4.5:1), sideways scrolling, glow everywhere, a childish look,
anything that breaks sample-data mode or the existing walkthroughs' behaviour.

## Approaches considered
1. **Re-theme by tokens plus restyled shared pieces (chosen).** Colour tokens in `globals.css` already
   drive every screen; changing their values, the shared components (cards, buttons, bars, tabs) and the
   few hand-drawn pieces (charts, Nickel, icons) restyles the whole app with low risk.
2. Rewrite each screen's markup: most control, far more risk and time, little gain.
3. A component library swap: fights the house style and the existing pieces.
