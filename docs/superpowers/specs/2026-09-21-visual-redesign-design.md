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

**"Ember and sepia."** Taken from the warm brown-sepia ground the figures
stand on in the game's key art, lit by the gold of its wordmark and trim.

An earlier draft built the page on the violet-indigo of the characters' hair
and robes. It was implemented, reviewed and rejected at local review as too
cold for the subject. Two other Fortune's Weave fan projects had independently
landed on gold-and-vellum schemes — a pine-green Astro wiki and a parchment
companion — which is the genre's own heraldic language. This set stays in that
family without copying either, and the wordmark's ivory-to-gold gradient was
drawn for exactly this kind of ground.

**Semantic rule, unchanged:** predictions sit in the ground's own hue so
guesses recede; player evidence is the only thing that glows. Here that makes
`predicted` a warm tan rather than a colour of its own.

Ground: `#1a1310` dark / `#f7f2ea` light. Raised: `#241a16` / `#fffdf8`.

**The ratios below are as rendered** — each state's text against the tint it
actually paints on, not against the page ground. That distinction matters: an
earlier version of this table quoted ground ratios while the components
painted on tints and multiplied by an `opacity: 0.65`, and three WCAG AA
failures hid behind the difference. Quote what the component paints.

| role | dark | on | ratio | light | on | ratio |
|---|---|---|---|---|---|---|
| ink | `#f2e7d8` | ground | 15.03 | `#241a14` | ground | 15.28 |
| muted | `#b3a08c` | ground | 7.27 | `#5f5145` | ground | 6.85 |
| favourite (★) | `#e8b75c` | `#3a2a12` | 7.47 | `#8a5a00` | `#f8eed6` | 5.13 |
| confirmed (✔) | `#5fc9a0` | `#0e3228` | 6.87 | `#0d6a52` | `#dcf0e8` | 5.52 |
| contested (?) | `#e8889c` | `#3a1a22` | 6.24 | `#a83a50` | `#fae4e8` | 5.12 |
| pending (•) | `#fbf2e4` | `#2e2620` | 13.38 | `#241a14` | `#efe7da` | 13.88 |
| predicted (~) | `#bd9a78` | `#2a1f18` | 6.16 | `#6b5540` | `#f0e9de` | 5.81 |
| untested (—) | `#a08d79` | `#231a15` | 5.35 | `#6b5f52` | `#efeae2` | 5.18 |
| warning | `#ff8a6b` | ground | 7.95 | `#a8391f` | ground | 5.76 |
| control edge | `#8c6e58` | ground | 3.92 | `#8c7259` | ground | 4.04 |
| focus ring | `#e8b75c` | ground | 9.92 | `#8a5a00` | ground | 5.32 |

Every text token clears 4.5:1 and every control border and focus ring clears
3:1, in both modes, as rendered. Decorative hairlines are a separate token
(`--rule`) and deliberately sub-3:1 — they divide content and are not control
boundaries. No component may reintroduce an `opacity` multiplier on text.

`pending` is the highest-contrast token in both modes by intent: a fresh
unreviewed player report is the most alive item on the site.

The masthead carries its own always-dark set (`--masthead-*`, including
`--masthead-focus`), never redefined under the dark-mode query, so the band
and the wordmark render correctly in light mode.

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

The masthead is a **dark band in both colour modes** — `--masthead-ground`,
`#120d0a`, the deepest tone in the ember-and-sepia set. This lets one logo
asset serve both modes and echoes the game's own dark translucent UI panels.

Because the band is dark in light mode too, the masthead resolves its colours
from a **dedicated `--masthead-*` set that is never redefined under the
dark-mode query** — including `--masthead-focus`, whose omission was itself a
contrast bug. Scoping those values to the masthead rather than relying on the
mode is what keeps the wordmark legible in light mode; a guard in
`test/assets.test.mjs` asserts none of them appears inside the dark block.

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

## The masthead's state-of-knowledge line

A new view module, `assets/js/views/weave.js`, following the same shape as
every other view: a pure model plus a DOM render, Node-importable, no
top-level DOM access.

- `weaveModel(index, filters)` returns
  `{ pairs, confirmed, favouritesFound, favouritesTotal, marks }`.
- `weaveSummary(model)` turns that into two sentences, not a `·`-joined
  string. With today's data: `No pair confirmed yet, out of 4,240. 53
  favourites still unfound.`
- All counts are computed from the index. No count is hardcoded.
- `render()` appends the sentence to the masthead and nothing else.

**What this section used to specify, and why it changed.** The original design
drew the whole 80x53 grid beside this sentence as an inline SVG strip, one
`<rect>` per signal-bearing cell on a single background rect — 349 elements
rather than 4,240 — so that the emptiness of the dataset was visible at a
glance. It was built, shipped to local review, and cut there.

The failure was geometric and should have been caught at design time. Stretched
across the full content column with `preserveAspectRatio="none"`, each cell
rendered at roughly 21px by 1.3px. At that 16:1 distortion the image stops
reading as a grid and reads as scan lines or a corrupted texture, and it sat
above every view rather than only where a grid has context. The sentence
already carries the fact, legibly, in one line.

`marks` remains on the model — it is honest about the data and costs nothing —
but nothing renders it. The `--weave-*` token set and the `weave-in` animation
were removed with the graphic, so the page now has **no non-user-triggered
motion at all**.

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
- `assets/js/views/weave.js` — the masthead's counts model and its one line
- `assets/fonts/{fraunces,plex-sans}-{latin,latin-ext}.woff2` + OFL licences
- `assets/img/fefw-logo.png`

**Rewritten**
- `assets/css/style.css`
- the `render()` half of `views/{character,gift,matrix,favorites}.js`

**Modified**
- `index.html` — masthead, tab bar, filters disclosure, footer line
- `assets/js/app.js` — mount the counts line
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
- `weaveSummary(model)` — the counts sentence
- `partitionRows(rows)` — `{ signal, untested }`, preserving confidence order
- `giftIndexModel(index, search)` — category grouping, uncategorised last
- `characterIndexModel(index, filters, search)` — name, chips, summary
- `characterSummary(index, character)` — the strongest true statement
- `categoryChips(index, character)` — liked categories, refuted excluded

`deriveConfidence` never returns `FAVORITE` for a gift listed in
`character.favorites` unless a player observed it, so any favourite count
outside `favoritesModel` must mirror its declared-union-observed rule.
`weaveModel` and `characterSummary` both do, or the masthead and the
Favourites tab will report different totals from the same data.

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
