# Fortune's Weave Gift Guide — Visual Redesign Design

**Date:** 2026-09-21
**Status:** Approved
**Supersedes:** nothing. This extends
`docs/superpowers/specs/2026-09-20-fefw-gifts-design.md`, which remains the
binding authority on data, confidence semantics, submissions and voting.
Nothing here may weaken a rule stated there.

## Goal

Replace the unstyled default-browser presentation with a deliberate visual
identity derived from *Fire Emblem: Fortune's Weave*, and reorganise each
view so its content is legible and actionable rather than dumped as a list.

## Why now

The site renders correctly and says true things, but it says them as bare
`<ul>` lists of 53 and 80 links running the full width of the viewport. The
data underneath is sparse in ways the current presentation hides rather than
communicates.

Measured from `data/` on 2026-09-21:

| fact | value |
|---|---|
| giftable characters | 53 (of 70 total) |
| gifts | 80 |
| pairs | 4,240 |
| pairs in a non-`UNTESTED` state | 349 (8.2%) |
| confirmed observations | 0 |
| gifts with no category recorded | 26 of 80 |
| gifts with no rarity recorded | **80 of 80** |
| characters with no traits recorded | **53 of 53** |

Two consequences bind the design:

1. The "Rarity" column and the "Profile" section currently render placeholder
   text on every page they appear on. They must render **only when the
   underlying data exists**.
2. 75 of every character's 80 gift rows are `UNTESTED`. A flat 80-row table
   buries the five rows that carry information.

## Product intent

The page has two jobs of equal weight: let a player look something up, and
let a player contribute what they know. In this dataset those are the same
act one step apart — a lookup that returns nothing identifies the person
holding the answer. The design therefore does not split into a reference
half and a recruitment half. Every lookup terminates in a report affordance,
and the state of knowledge is shown honestly rather than dressed up.

## Approach

The persistent header carries both jobs on every view. No new route, no new
landing page, no change to search semantics. The four tabs keep their roles.

Rejected alternatives:

- **Command bar replacing tab navigation**, searching both axes at once with
  the weave as a clickable map. One strong idea, but it rewrites navigation
  and search semantics together, and a 4,240-cell tappable map is not
  usable on a phone. More risk than the brief needs.
- **A two-door landing route** splitting "look something up" from "add what
  you know". Literally equal weighting, but it reads as undecided, adds a
  click before every lookup, and two-door landings are the first thing users
  learn to skip.

## Visual language

### Colour

Derived by reading the game's North American key art and wordmark, not
invented: a golden-haze sky, deep violet-indigo hair, magenta-rose cloaks, a
teal garment panel, gold trim, and a pure-ivory central figure. The Japanese
title, *banshisenkō* ("a scene of blooming multicoloured flowers"), supports
a polychrome set rather than a single accent — which is what six confidence
states require.

**Semantic rule:** predictions sit in the ground's own hue so guesses recede;
player evidence is the only thing that glows. This is the epistemic rule of
the parent spec expressed as colour.

Ground: `#17122A` dark / `#F6F3FA` light. Raised surface: `#201A38` dark /
`#FFFFFF` light. Contrast ratios are against the ground.

| role | dark | ratio | light | ratio |
|---|---|---|---|---|
| ink | `#EDE6F5` | 14.9 | `#241C38` | 14.7 |
| muted | `#A99CC4` | 7.1 | `#5A5076` | 6.7 |
| favourite (★) | `#EFC15A` | 10.8 | `#7A5600` | 6.1 |
| confirmed (✔) | `#45C9B0` | 8.9 | `#0B6C5E` | 5.8 |
| contested (?) | `#E3628F` | 5.5 | `#A82453` | 6.3 |
| pending (•) | `#E8E0F2` | 14.2 | `#2E2545` | 13.0 |
| predicted (~) | `#8B7AD9` | 5.1 | `#54449E` | 7.1 |
| untested (—) | `#9488B2` | 5.6 | `#645A80` | 5.8 |
| warning | `#FF8A6B` | 7.9 | `#B3341F` | 5.6 |
| control edge | `#7768AB` | 3.8 | `#7E6EA4` | 4.1 |
| focus ring | `#EFC15A` | 10.8 | `#54449E` | 7.1 |

Every text token clears 4.5:1 and every control border and focus ring clears
3:1, in both modes. Decorative hairlines are a **separate token** (`--rule`,
`#332B52` dark / `#DED6EC` light) and are deliberately below 3:1: they divide
content, they are not control boundaries, and a 3:1 grid in the matrix would
be deafening.

`pending` is the highest-contrast token in both modes by intent. A fresh
unreviewed player report is the most alive item on the site and must pull the
eye harder than a confirmed result.

Links do not get their own colour. Character and gift names are the most
repeated element on the page; colouring them would collide with six state
colours. They are `ink` with a muted underline, taking the accent on hover
and focus only.

### Typography

Two self-hosted families, both SIL OFL, latin and latin-ext subsets, ~188 KB
total. No CDN: a third-party font request would expose every visitor's IP,
which contradicts the parent spec's rule that the site collects no personal
data.

- **Fraunces** (variable, `opsz` 9–144, `wght` 300–900) for headings. `opsz`
  is driven to 144 on the masthead title so the serifs flare into something
  inscriptional, and back to ~24 at small sizes so they do not go spindly.
- **IBM Plex Sans** (variable, `wght` 400–600) for body, tables and UI.

Scale, 1.25 ratio on a 16px base: display `clamp(2rem, 1.4rem + 2.6vw,
3.25rem)` / view title 1.75rem / section 1.15rem / body 1rem at line-height
1.55 / table 0.9375rem / meta 0.8125rem. Prose measure capped at 66ch.

A system fallback stack must be declared so the page remains fully usable if
the font files fail to load.

## Masthead

The masthead is a **dark violet band in both colour modes**. This lets one
logo asset serve both, gives the weave strip a single treatment, and echoes
the game's own dark translucent UI panels.

Because the band is dark in light mode too, the masthead and the weave strip
resolve their colours from the **dark token set regardless of
`prefers-color-scheme`**. The stylesheet must scope the dark values to the
masthead rather than relying on the mode, or the wordmark and strip become
unreadable in light mode.

The wordmark is `assets/img/fefw-logo.png` — the white variant, downscaled to
900×186 and quantised to 29 KB, its ivory-to-gold gradient intact. It is
Nintendo / Intelligent Systems property used as a fan project; the footer
carries an unaffiliated-fan-project line beside the existing citations.

Because the wordmark already reads "Fire Emblem / Fortune's Weave", the `h1`
stops repeating it:

```html
<h1 class="masthead-title">
  <img src="assets/img/fefw-logo.png" alt="Fire Emblem: Fortune's Weave"
       width="900" height="186">
  <span>Gift Guide</span>
</h1>
```

The accessible name resolves to "Fire Emblem: Fortune's Weave Gift Guide",
identical to the current heading. `<title>` is unchanged. If the image fails
to load the alt text renders and the heading still reads correctly.

## The weave strip

A new view module, `assets/js/views/weave.js`, following the same shape as
every other view: a pure model plus a DOM render, Node-importable, no
top-level DOM access.

- `weaveModel(index, filters)` returns
  `{ pairs, confirmed, favouritesFound, favouritesTotal, marks }` where
  `marks` contains only non-`UNTESTED` cells as `{ x, y, state }`.
- `render()` emits one inline `<svg viewBox="0 0 80 53"
  preserveAspectRatio="none">`: a ground rect plus one `<rect>` per mark.
  That is 349 elements today. The bare warp is a background fill, never
  4,240 elements.
- All counts are computed from the index. No count is hardcoded.
- The strip is a single link to `#/matrix`, with an accessible label carrying
  the counts. Individual marks are **not** interactive: at 80×53 in a
  full-width strip a cell is roughly 4px × 0.8px, and a control that cannot
  be hit must not be presented as one.
- Marks fade in once on first load. `prefers-reduced-motion: reduce` disables
  it. This is the page's only non-user-triggered motion.
- The counts line is a sentence, not a `·`-joined string.

## View structure

### Shell

Content column `max-width: 72rem`, gutter 16px (24px at ≥640px). Prose capped
at 66ch within it. The matrix escapes the column to full bleed. The masthead
band is full bleed with its contents in the column. The tab bar scrolls
horizontally on narrow screens.

The three filter checkboxes and the spoiler note move into a `<details>`
disclosure so they stop crowding the header. "Report a result" promotes to a
primary action in the tab bar.

Both the report button and the GitHub fallback continue to ship in markup
with exactly one surviving, so the page is never briefly wrong while
JavaScript boots and still works with the Worker unconfigured.

### Characters index

A hairline-ruled tessellation, `repeat(auto-fill, minmax(15rem, 1fr))`. Each
cell carries the character's name, their predicted-liked categories as chips,
and a status line. Cells are divided by rules — no shadows, no per-cell
borders, no border-radius.

The status line states the strongest thing true of that character, in this
order: favourite found, then confirmed count, then predictions, then nothing.
It never implies a negative result. With today's data every character reads
"5 worth trying".

### Character detail

Profile section and rarity column render only when the data exists.

Gift rows split in two:

- **"Worth trying"** — every non-`UNTESTED` row, as a table, with a Report
  button on each row and vote controls where a pending report exists.
- **"Not tested yet (N)"** — a `<details>` containing a dense grid of gift
  name chips, each a report trigger.

As reports land, rows migrate from the chip grid into the table. No untested
pair is ever presented as a dislike.

### Gifts index

Grouped by category, with the 26 uncategorised gifts in a final "Category not
recorded yet" group. Rarity is shown per gift only where recorded.

### Matrix

Rotated column headers so more of the 53 characters fit. The `·`-joined
legend string is replaced with a swatch-and-symbol key.

### Favourites

One row per character with the suggested gifts as clickable chips, replacing
the run-on comma-separated lines.

## File structure

**New**
- `assets/js/views/weave.js` — weave strip model and render
- `assets/fonts/{fraunces,plex-sans}-{latin,latin-ext}.woff2` + OFL licences
- `assets/img/fefw-logo.png`

**Rewritten**
- `assets/css/style.css`
- the `render()` half of `views/{character,gift,matrix,favorites}.js`

**Modified**
- `index.html` — masthead, tab bar, filters disclosure, footer line
- `assets/js/app.js` — mount the weave strip
- `assets/js/views/shared.js` — add `chip`, `groupRowsByState`,
  `categoryChips`
- `test/views.test.mjs` — tests for the new pure functions

## Interfaces that must not change

`characterRows`, `giftRows`, `matrixModel`, `favoritesModel`, `detailStatus`,
`sortByConfidence`, `stateLabel`, `SYMBOL`, `badge`, `cellClasses`,
`stateClasses`, `reportButton`, `el`, `emptyState`, `sourceName` keep their
signatures and semantics. All 22 existing view tests must stay green as
written.

## New pure functions

Each is developed test-first and is importable by `node:test` without a DOM.

- `weaveModel(index, filters)` — counts and marks
- `groupRowsByState(rows)` — partition in confidence rank order
- `giftIndexModel(index, search)` — category grouping, uncategorised last
- `characterIndexModel(index, filters, search)` — name, chips, summary

## Binding invariants

Restated from `CLAUDE.md` and the parent spec. This work may not weaken any
of them.

- No dependency and no build step. Fonts and the logo are static files served
  exactly as committed.
- Browser modules stay Node-importable: ESM exports, no top-level DOM access.
- Absence of a match is never a dislike.
- Votes never reach the published site. No new view renders a tally in any
  form.
- A pending report is not a confirmation.
- The site renders from committed data with the Worker unavailable or
  unconfigured.
- Deployment stays gated on `npm test` and `npm run validate`.

## Out of scope

- Any change to `data/`, the Worker, the D1 schema, or the review page's
  behaviour.
- Search semantics. Search continues to scope to the active tab.
- Character portraits or any per-character artwork.
- A theme toggle. The site follows `prefers-color-scheme`, as today.

## Verification

- `npm test` and `npm run validate` pass with no stray warnings.
- Contrast ratios in the table above are reproducible from the committed
  token values.
- Screenshots at desktop and phone width. If the browser in the working
  environment refuses to resize to phone width, that is reported as
  unverified rather than claimed.
