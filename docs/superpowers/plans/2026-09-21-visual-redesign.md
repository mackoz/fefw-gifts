# Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unstyled default-browser presentation with a visual identity derived from the game's own key art, and reorganise each view around what the data actually contains.

**Architecture:** Design tokens land first in a new `assets/css/tokens.css`, so every later task styles against one palette. The page shell gains a always-dark masthead carrying the wordmark and a new weave-strip module. Each view module then has its `render()` half rewritten while its exported model functions stay byte-identical, so the 22 existing view tests keep passing untouched. Every new behaviour arrives as a pure function tested without a DOM.

**Tech Stack:** Vanilla HTML, CSS custom properties, ES modules. Node 22, `node --test`. No dependencies, no build step, no framework.

**Spec:** `docs/superpowers/specs/2026-09-21-visual-redesign-design.md`

## Global Constraints

Copied from the spec and `CLAUDE.md`. Every task's requirements include this section.

- **No dependency, ever.** `package.json` has no `dependencies` and no `devDependencies`. If a task seems to need a package, stop and ask.
- **No build step, ever.** Files are served exactly as committed.
- **Browser modules stay Node-importable.** Every file under `assets/js/` uses ESM `export`, has no top-level DOM access, and must be importable by `node:test`. DOM access lives inside functions that receive their elements as arguments.
- **Absence of a match is never a dislike.** Only an actual observation may produce a negative result. Any code path that renders an unmatched pair as "dislikes" is a bug.
- **Votes never reach the published site.** No view may render a tally, count, score or bar for votes, in any form.
- **A pending report is not a confirmation.** It may not flip a pair to `CONFIRMED` or `FAVORITE`, contribute a reaction, or count toward a confirmed total.
- **The site must work with the Worker unavailable or unconfigured.** `WORKER_URL` may be null; committed data must still render, and a failed `/pending` must skip the overlay silently.
- **No third-party requests.** Fonts and images are self-hosted. A font CDN link would expose every visitor's IP and contradicts the project's no-personal-data rule.
- **Run `npm test` and `npm run validate` before committing.** Both must pass cleanly with no stray warnings.
- **These exports must not change signature or semantics:** `characterRows`, `giftRows`, `matrixModel`, `favoritesModel`, `detailStatus`, `sortByConfidence`, `stateLabel`, `SYMBOL`, `badge`, `cellClasses`, `stateClasses`, `reportButton`, `el`, `emptyState`, `sourceName`.
- **Copy rules.** No ALL-CAPS eyebrow labels. No meta strings joined with middle dots (`A · B · C`). No `→` appended to link or button text. Sentence case throughout. British spelling for "favourite" in prose; the `FAVORITE` state id and `favorites` data key keep their American spelling because they are existing identifiers.

## File Structure

**Create**
- `assets/css/tokens.css` — custom properties, `@font-face`, element defaults. Nothing layout-specific.
- `assets/js/views/weave.js` — the weave strip: `weaveModel`, `weaveSummary`, `render`.
- `assets/img/fefw-logo.png` — the wordmark, 900×186, quantised.
- `test/assets.test.mjs` — guards the token set, self-hosting, and asset references.
- `test/weave.test.mjs` — the weave strip's pure functions.

**Rewrite**
- `assets/css/style.css` — layout, shell and component styles. Tokens move out to `tokens.css`.
- The `render()` half of `assets/js/views/character.js`, `gift.js`, `matrix.js`, `favorites.js`.

**Modify**
- `index.html` — masthead, tab bar, filters disclosure, footer line.
- `assets/js/app.js` — mount the weave strip.
- `assets/js/views/shared.js` — add `chip`, `partitionRows`, `categoryChips`.
- `test/views.test.mjs` — add tests for the new pure functions.

---

### Task 1: Design tokens, fonts and the logo asset

Lands the palette every later task styles against, self-hosts both typefaces, and commits the optimised wordmark. No visual change is expected yet — `style.css` still holds its own `:root` block at this point and wins by source order, which Task 2 removes.

**Files:**
- Create: `assets/css/tokens.css`
- Create: `assets/img/fefw-logo.png`
- Create: `test/assets.test.mjs`
- Already committed: `assets/fonts/fraunces-latin.woff2`, `assets/fonts/fraunces-latin-ext.woff2`, `assets/fonts/plex-sans-latin.woff2`, `assets/fonts/plex-sans-latin-ext.woff2`

**Interfaces:**
- Consumes: nothing.
- Produces: the CSS custom properties every later task uses. Names are fixed here and must not be renamed later: `--ground --raised --ink --muted --rule --edge --focus --favorite --confirmed --contested --pending --predicted --untested --warning`, each with a matching `--*-bg` tint for the six states; the always-dark set `--masthead-ground --masthead-ink --masthead-muted --masthead-rule`; the strip set `--weave-ground --weave-favorite --weave-confirmed --weave-contested --weave-pending --weave-predicted`; type tokens `--font-display --font-body --step--1 --step-0 --step-1 --step-2 --step-3 --text-table`; layout tokens `--col --measure --gutter`.

- [ ] **Step 1: Produce the logo asset**

The source file is not in the repo. Download it, downscale it, and quantise it. `pngquant` is present on this machine; if it is absent, commit the 117 KB downscaled PNG instead and note it in the commit message — do not add a dependency.

```bash
cd "$(git rev-parse --show-toplevel)"
mkdir -p assets/img
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
curl -sS -A "$UA" -e 'https://fireemblemwiki.org/' \
  -o /tmp/fefw-logo-src.png 'https://cdn.fireemblemwiki.org/8/87/FEFW_logo_white.png'
sips -Z 900 /tmp/fefw-logo-src.png --out /tmp/fefw-logo-900.png >/dev/null
pngquant --quality 70-92 --strip --force --output assets/img/fefw-logo.png /tmp/fefw-logo-900.png
file -b assets/img/fefw-logo.png
ls -lh assets/img/fefw-logo.png
```

Expected: `PNG image data, 900 x 186, 8-bit/color RGBA` and a size around 29 KB.

- [ ] **Step 2: Write the failing test**

Create `test/assets.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

// Every confidence state the site can render. A missing token is a state that
// falls back to inherited colour and silently stops being distinguishable.
const STATES = ['favorite', 'confirmed', 'contested', 'pending', 'predicted', 'untested'];

test('every confidence state has a colour and a tint in both colour modes', () => {
  const css = read('../assets/css/tokens.css');
  const split = css.indexOf('prefers-color-scheme: dark');
  assert.ok(split > 0, 'tokens.css must declare a dark-mode block');
  const light = css.slice(0, split);
  const dark = css.slice(split);
  for (const state of STATES) {
    assert.match(light, new RegExp(`--${state}:\\s*#[0-9a-f]{6}`, 'i'), `light --${state}`);
    assert.match(dark, new RegExp(`--${state}:\\s*#[0-9a-f]{6}`, 'i'), `dark --${state}`);
    assert.match(light, new RegExp(`--${state}-bg:\\s*#[0-9a-f]{6}`, 'i'), `light --${state}-bg`);
    assert.match(dark, new RegExp(`--${state}-bg:\\s*#[0-9a-f]{6}`, 'i'), `dark --${state}-bg`);
  }
});

test('the masthead palette does not depend on the colour mode', () => {
  const css = read('../assets/css/tokens.css');
  const dark = css.slice(css.indexOf('prefers-color-scheme: dark'));
  // The masthead is dark in both modes, so redefining it under the dark-mode
  // query would make light mode render an ivory wordmark on a pale band.
  for (const token of ['--masthead-ground', '--masthead-ink', '--weave-ground']) {
    assert.doesNotMatch(dark, new RegExp(`${token}:`), `${token} must not be redefined for dark mode`);
  }
});

test('no stylesheet makes a third-party request', () => {
  for (const file of ['tokens.css', 'style.css']) {
    const css = read(`../assets/css/${file}`);
    assert.doesNotMatch(css, /fonts\.(googleapis|gstatic)\.com/, `${file} links a font CDN`);
    assert.doesNotMatch(css, /url\(\s*['"]?https?:/i, `${file} requests a remote asset`);
  }
});

test('every font file referenced by @font-face exists', () => {
  const css = read('../assets/css/tokens.css');
  const refs = [...css.matchAll(/url\('(\.\.\/fonts\/[^']+)'\)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 4, `expected at least four @font-face sources, found ${refs.length}`);
  for (const ref of refs) {
    assert.ok(existsSync(new URL(`../assets/css/${ref}`, import.meta.url)), `missing font file: ${ref}`);
  }
});

test('the wordmark is committed and small enough to ship in a header', () => {
  const logo = new URL('../assets/img/fefw-logo.png', import.meta.url);
  assert.ok(existsSync(logo), 'assets/img/fefw-logo.png is missing');
  const bytes = statSync(logo).size;
  assert.ok(bytes < 60_000, `wordmark is ${bytes} bytes; keep it under 60 KB`);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern='confidence state has a colour'`

Expected: FAIL with `ENOENT` for `assets/css/tokens.css`.

- [ ] **Step 4: Write `assets/css/tokens.css`**

Every hex below is contrast-checked against its ground in the spec's Colour table. Do not substitute values.

```css
/* Design tokens for the Fortune's Weave gift guide.
   Read off the game's key art: a golden-haze sky, deep violet-indigo hair,
   magenta-rose cloaks, a teal garment panel, gold trim, and an ivory focal
   figure. The Japanese title means "a scene of blooming multicoloured
   flowers", which is why this is a polychrome set rather than one accent.

   Semantic rule: predictions sit in the ground's own hue so guesses recede,
   and player evidence is the only thing that glows. Every text token clears
   4.5:1 against its ground and every control border clears 3:1 -- the ratios
   are recorded in the spec and are reproducible from these values. */

@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 300 900;
  font-display: swap;
  src: url('../fonts/fraunces-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Fraunces';
  font-style: normal;
  font-weight: 300 900;
  font-display: swap;
  src: url('../fonts/fraunces-latin-ext.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}

@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 400 600;
  font-display: swap;
  src: url('../fonts/plex-sans-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 400 600;
  font-display: swap;
  src: url('../fonts/plex-sans-latin-ext.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}

:root {
  color-scheme: light dark;

  /* Light mode is the base declaration; the dark block below overrides it. */
  --ground: #f6f3fa;
  --raised: #ffffff;
  --ink: #241c38;
  --muted: #5a5076;
  --rule: #ded6ec;
  --edge: #7e6ea4;
  --focus: #54449e;

  --favorite: #7a5600;
  --favorite-bg: #f8efd6;
  --confirmed: #0b6c5e;
  --confirmed-bg: #dcf1ed;
  --contested: #a82453;
  --contested-bg: #fbe4ec;
  --pending: #2e2545;
  --pending-bg: #e6e0f4;
  --predicted: #54449e;
  --predicted-bg: #e9e4f8;
  --untested: #645a80;
  --untested-bg: #efecf5;
  --warning: #b3341f;

  /* The masthead is a dark band in BOTH colour modes, so it carries its own
     palette and is never redefined under the dark-mode query. Redefining it
     there would put an ivory wordmark on a pale band in light mode. */
  --masthead-ground: #17122a;
  --masthead-raised: #201a38;
  --masthead-ink: #ede6f5;
  --masthead-muted: #a99cc4;
  --masthead-rule: #332b52;
  --masthead-edge: #7768ab;

  /* The weave strip lives in the masthead, so it uses the dark state colours
     whatever the page mode is. */
  --weave-ground: #221b3d;
  --weave-favorite: #efc15a;
  --weave-confirmed: #45c9b0;
  --weave-contested: #e3628f;
  --weave-pending: #e8e0f2;
  --weave-predicted: #8b7ad9;

  --font-display: 'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  --font-body: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;

  --step--1: 0.8125rem;
  --step-0: 1rem;
  --step-1: 1.15rem;
  --step-2: 1.75rem;
  --step-3: clamp(2rem, 1.4rem + 2.6vw, 3.25rem);
  --text-table: 0.9375rem;

  --col: 72rem;
  --measure: 66ch;
  --gutter: 16px;
}

@media (min-width: 640px) {
  :root {
    --gutter: 24px;
  }
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #17122a;
    --raised: #201a38;
    --ink: #ede6f5;
    --muted: #a99cc4;
    --rule: #332b52;
    --edge: #7768ab;
    --focus: #efc15a;

    --favorite: #efc15a;
    --favorite-bg: #3a2e10;
    --confirmed: #45c9b0;
    --confirmed-bg: #0e3a34;
    --contested: #e3628f;
    --contested-bg: #3d1428;
    --pending: #e8e0f2;
    --pending-bg: #2e2748;
    --predicted: #8b7ad9;
    --predicted-bg: #241e42;
    --untested: #9488b2;
    --untested-bg: #1f1a33;
    --warning: #ff8a6b;
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`

Expected: the four new asset tests pass; the `no stylesheet makes a third-party request` test also passes because the existing `style.css` contains no remote URL. All pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add assets/css/tokens.css assets/img/fefw-logo.png test/assets.test.mjs
git commit -m "Add design tokens, self-hosted faces and the wordmark

Palette read off the game's key art rather than invented. The masthead and
weave strip carry their own always-dark tokens so a dark band renders
correctly in light mode. Tests guard the token set, the absence of any
third-party request, and that every referenced font file exists."
```

---

### Task 2: Page shell — masthead, tab bar, filters disclosure

Replaces the header wall with a full-bleed dark masthead carrying the wordmark and an empty mount point for the weave strip, moves the three filter checkboxes and the spoiler paragraph into a disclosure, and promotes the report action into the tab bar. `style.css` is rewritten: its `:root` and dark-mode blocks are deleted because Task 1 owns them now.

**Files:**
- Modify: `index.html`
- Rewrite: `assets/css/style.css`
- Modify: `test/assets.test.mjs`

**Interfaces:**
- Consumes: every token from Task 1.
- Produces: `<div id="weave">` inside the masthead, which Task 9 mounts the strip into. The ids `search`, `report-open`, `report-fallback`, `view`, and every `[data-filter]` checkbox keep their current names and meanings, because `app.js` selects on them.

- [ ] **Step 1: Write the failing test**

Append to `test/assets.test.mjs`:

```js
test('the masthead carries the wordmark with an accessible name', () => {
  const html = read('../index.html');
  assert.match(html, /<img[^>]+src="assets\/img\/fefw-logo\.png"/, 'wordmark img is missing');
  assert.match(html, /alt="Fire Emblem: Fortune's Weave"/, 'wordmark needs alt text, not an empty alt');
  // Intrinsic size prevents the masthead reflowing once the image decodes.
  assert.match(html, /<img[^>]+width="900"[^>]+height="186"/, 'wordmark needs width and height');
});

test('the heading does not repeat what the wordmark already says', () => {
  const html = read('../index.html');
  const h1 = html.slice(html.indexOf('<h1'), html.indexOf('</h1>'));
  assert.doesNotMatch(h1, /Fortune's Weave Gift Guide/, 'h1 text duplicates the wordmark');
  assert.match(h1, /Gift Guide/, 'h1 must still name the site');
});

test('both report controls ship so exactly one can survive', () => {
  // The page must never be briefly wrong while JavaScript boots, and must
  // still work with the Worker unconfigured.
  const html = read('../index.html');
  assert.match(html, /id="report-open"/, 'the in-site report button is missing');
  assert.match(html, /id="report-fallback"/, 'the GitHub fallback is missing');
  assert.match(html, /id="report-open"[^>]*\shidden/, 'the in-site button must start hidden');
});

test('the page loads no remote stylesheet, script or image', () => {
  const html = read('../index.html');
  assert.doesNotMatch(html, /<link[^>]+href="https?:/i, 'remote stylesheet');
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i, 'remote script');
  assert.doesNotMatch(html, /<img[^>]+src="https?:/i, 'remote image');
});

test('the footer states the project is unaffiliated', () => {
  const html = read('../index.html');
  const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  assert.match(footer, /unaffiliated/i, 'footer must carry the fan-project line');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern='masthead carries the wordmark'`

Expected: FAIL — `wordmark img is missing`.

- [ ] **Step 3: Rewrite the header, toolbar and footer in `index.html`**

Replace everything from `<header class="site-header">` through `</footer>` with this. The `<noscript>`, both `<dialog>` elements and the `<script type="module">` tag at the end are untouched.

```html
  <header class="masthead">
    <div class="masthead-inner">
      <h1 class="masthead-title">
        <img src="assets/img/fefw-logo.png" alt="Fire Emblem: Fortune's Weave" width="900" height="186" decoding="async">
        <span>Gift Guide</span>
      </h1>

      <p class="masthead-tagline">
        Predicted likes are guesses carried over from published guides. Only a
        player reporting their actual in-game result counts as confirmed.
      </p>

      <div id="weave" class="weave-mount"></div>
    </div>
  </header>

  <div class="tabbar">
    <nav class="tabbar-inner" aria-label="Views">
      <a href="#/character">Characters</a>
      <a href="#/gift">Gifts</a>
      <a href="#/matrix">Matrix</a>
      <a href="#/favorites">Favourites</a>
      <button type="button" id="report-open" class="report-link" hidden>Report a result</button>
      <a class="report-link" id="report-fallback" href="https://github.com/mackoz/fefw-gifts/issues/new/choose">Report a result on GitHub</a>
    </nav>
  </div>

  <div class="toolbar">
    <div class="toolbar-inner">
      <input type="search" id="search" placeholder="Search names in this view…" aria-label="Search names in the current view">

      <details class="filters">
        <summary>Filters</summary>
        <div class="filters-body">
          <label class="filter-toggle">
            <input type="checkbox" data-filter="hideUntested">
            Hide untested pairs
          </label>
          <label class="filter-toggle">
            <input type="checkbox" data-filter="hideUnconfirmed">
            Hide unconfirmed predictions
          </label>
          <label class="filter-toggle">
            <input type="checkbox" data-filter="hideSpoilers" checked>
            Hide spoilers
          </label>
          <p class="toggle-note">
            No characters are marked as spoilers yet, so this hides nothing
            today. If you’ve finished the game and know which ones belong
            behind it,
            <a href="https://github.com/mackoz/fefw-gifts/issues/new/choose">open an issue</a>.
          </p>
        </div>
      </details>
    </div>
  </div>

  <main id="view"></main>

  <footer class="site-footer">
    <p>
      Predicted category preferences are drawn from
      <a href="https://www.polygon.com/fire-emblem-fortunes-weave-best-gifts-each-character/">Polygon</a>;
      the item list comes from
      <a href="https://game8.co/games/Fire-Emblem-Fortunes-Weave/archives/621281">Game8</a>.
      Confirmed results come only from player reports, which take a few seconds
      and need no account. Structural corrections go through
      <a href="https://github.com/mackoz/fefw-gifts/issues/new/choose">GitHub issues</a>,
      and full citations are in <a href="data/sources.json">data/sources.json</a>.
    </p>
    <p class="colophon">
      An unaffiliated fan project. Fire Emblem and Fortune’s Weave are
      trademarks of Nintendo and Intelligent Systems, who have nothing to do
      with this site.
    </p>
  </footer>
```

- [ ] **Step 4: Link the token stylesheet**

In `<head>`, replace the single stylesheet link with both, tokens first:

```html
  <link rel="stylesheet" href="assets/css/tokens.css">
  <link rel="stylesheet" href="assets/css/style.css">
```

Add a preload for the two latin font files immediately above them, so text does not swap after first paint:

```html
  <link rel="preload" href="assets/fonts/fraunces-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="assets/fonts/plex-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
```

- [ ] **Step 5: Rewrite `assets/css/style.css`**

Delete the file's contents entirely and write this. The `:root` and `@media (prefers-color-scheme: dark)` blocks are gone — Task 1 owns them. Confidence badge, matrix, dialog, vote and review rules are preserved verbatim from the old file except that their hard-coded colour names now resolve to the Task 1 tokens; they are reproduced in full here so no lookup is needed.

```css
/* Page shell, layout and components. Design tokens live in tokens.css and are
   loaded first. Nothing in this file declares a colour literal: every colour
   resolves to a token, so the palette has exactly one definition. */

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
}

html,
body {
  max-width: 100%;
  overflow-x: hidden;
}

body {
  margin: 0;
  padding: 0 0 48px;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: var(--step-0);
  line-height: 1.55;
}

/* One column rule, applied by every band's inner wrapper. The matrix is the
   only thing that escapes it. */
.masthead-inner,
.tabbar-inner,
.toolbar-inner,
main#view,
.site-footer {
  max-width: var(--col);
  margin-inline: auto;
  padding-inline: var(--gutter);
}

:where(a):focus-visible,
:where(button):focus-visible,
:where(input):focus-visible,
:where(summary):focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: 2px;
}

a {
  color: inherit;
  text-decoration-color: var(--edge);
  text-underline-offset: 0.16em;
}

a:hover {
  text-decoration-color: currentColor;
}

h1, h2, h3 {
  font-family: var(--font-display);
  font-weight: 600;
  line-height: 1.15;
  text-wrap: balance;
}

h2 {
  font-size: var(--step-2);
  font-variation-settings: 'opsz' 60;
  margin: 28px 0 4px;
}

h3 {
  font-size: var(--step-1);
  font-variation-settings: 'opsz' 24;
  margin: 28px 0 6px;
}

noscript {
  display: block;
  max-width: var(--col);
  margin: 16px auto 0;
  padding: 12px 16px;
  background: var(--contested-bg);
  color: var(--contested);
  border: 1px solid var(--edge);
}

/* --- Masthead ---
   A dark band in both colour modes, so it resolves from the --masthead-*
   tokens rather than from the page palette. */

.masthead {
  background: var(--masthead-ground);
  color: var(--masthead-ink);
  border-bottom: 1px solid var(--masthead-rule);
}

.masthead-inner {
  padding-block: 28px 20px;
}

.masthead-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 18px;
  margin: 0;
  font-size: var(--step-3);
  font-variation-settings: 'opsz' 144;
  font-weight: 500;
  letter-spacing: -0.015em;
}

.masthead-title img {
  display: block;
  width: clamp(13rem, 34vw, 22rem);
  height: auto;
}

.masthead-title span {
  color: var(--masthead-ink);
}

.masthead-tagline {
  max-width: var(--measure);
  margin: 14px 0 0;
  color: var(--masthead-muted);
  font-size: var(--step--1);
}

/* --- Tab bar --- */

.tabbar {
  border-bottom: 1px solid var(--rule);
  background: var(--raised);
}

.tabbar-inner {
  display: flex;
  align-items: stretch;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.tabbar-inner a:not(.report-link) {
  padding: 13px 14px;
  text-decoration: none;
  white-space: nowrap;
  color: var(--muted);
  border-bottom: 2px solid transparent;
}

.tabbar-inner a:not(.report-link):hover {
  color: var(--ink);
}

.tabbar-inner a.active {
  color: var(--ink);
  font-weight: 600;
  border-bottom-color: var(--favorite);
}

.report-link {
  align-self: center;
  margin-inline-start: auto;
  padding: 7px 14px;
  border: 1px solid var(--edge);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: var(--step--1);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}

.report-link:hover {
  border-color: var(--ink);
}

/* --- Toolbar --- */

.toolbar-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px;
  padding-block: 12px;
}

#search {
  flex: 1 1 18rem;
  min-width: 0;
  padding: 8px 11px;
  border: 1px solid var(--edge);
  background: var(--raised);
  color: var(--ink);
  font: inherit;
  font-size: var(--text-table);
}

.filters {
  flex: 0 0 auto;
}

.filters > summary {
  padding: 8px 12px;
  border: 1px solid var(--edge);
  font-size: var(--text-table);
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.filters > summary::-webkit-details-marker {
  display: none;
}

.filters > summary::after {
  content: '\0020\25BE';
}

.filters[open] > summary::after {
  content: '\0020\25B4';
}

.filters-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--rule);
  background: var(--raised);
}

.filter-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-table);
}

.toggle-note {
  max-width: var(--measure);
  margin: 0;
  color: var(--muted);
  font-size: var(--step--1);
}

main#view {
  min-height: 50vh;
}

main#view > p,
.intro,
.notes,
.provenance-note,
.rarity-pref,
.descriptor,
.help-wanted {
  max-width: var(--measure);
}

.site-footer {
  margin-top: 48px;
  padding-block: 20px 0;
  border-top: 1px solid var(--rule);
  color: var(--muted);
  font-size: var(--step--1);
}

.site-footer p {
  max-width: var(--measure);
}

.colophon {
  margin-bottom: 0;
}

/* --- Confidence states ---
   Each state pairs a colour with a text label and symbol prefix, so it never
   depends on colour perception alone. */

.state-favorite,
.state-confirmed,
.state-contested,
.state-pending,
.state-predicted,
.state-untested {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: var(--step--1);
  border: 1px solid transparent;
  white-space: nowrap;
}

.state-favorite {
  color: var(--favorite);
  background: var(--favorite-bg);
  border-color: currentColor;
}
.state-favorite::before { content: "\2605"; }

.state-confirmed {
  color: var(--confirmed);
  background: var(--confirmed-bg);
  border-color: currentColor;
}
.state-confirmed::before { content: "\2713"; }

.state-contested {
  color: var(--contested);
  background: var(--contested-bg);
  border-color: currentColor;
}
.state-contested::before { content: "\26A0"; }

.state-pending {
  color: var(--pending);
  background: var(--pending-bg);
  border-color: currentColor;
}
.state-pending::before {
  /* Matches the matrix legend's bullet. Not "~": that is a guide's guess, and
     this is a player's unreviewed result. */
  content: "\2022";
  font-weight: 700;
}

.state-predicted {
  color: var(--predicted);
  background: var(--predicted-bg);
  border: 1px dashed currentColor;
}
.state-predicted::before {
  /* "~" not "?": the matrix legend already spends "?" on reports disagreeing. */
  content: "~";
  font-weight: 700;
}

.state-untested {
  color: var(--untested);
  background: var(--untested-bg);
}
.state-untested::before { content: "\2014"; }

/* Provenance: a guide-sourced guess shows dimmer than one confirmed from the
   character's own in-game profile. */
.provenance-guide,
.provenance-refuted {
  opacity: 0.65;
  font-style: italic;
}

.provenance-profile {
  opacity: 1;
}

.provenance-discovered {
  opacity: 1;
  font-weight: 600;
}

.is-exception {
  outline: 2px dotted var(--warning);
  outline-offset: 2px;
}
.is-exception::after {
  content: " (unexpected result)";
  font-size: 0.8em;
  color: var(--warning);
}

.rarity-mismatch {
  border-bottom: 2px dashed var(--warning);
}
.rarity-mismatch::after {
  content: " (below their reported preference)";
  font-size: 0.8em;
  color: var(--warning);
}

.empty-state {
  max-width: var(--measure);
  margin: 10px 0 18px;
  color: var(--muted);
}

.trait-flavor {
  color: var(--muted);
  font-style: italic;
}

/* --- Dialogs ---
   Sized for a phone first: reports get written right after playing, on the
   device that is to hand. */

dialog {
  width: min(32rem, calc(100vw - 32px));
  padding: 22px;
  border: 1px solid var(--edge);
  background: var(--raised);
  color: var(--ink);
}

dialog::backdrop {
  background: rgb(0 0 0 / 0.6);
}

dialog h2 {
  margin-top: 0;
  font-size: var(--step-2);
}

dialog label {
  display: block;
  margin-top: 14px;
  font-weight: 600;
}

dialog select,
dialog input[type="number"],
dialog input[type="text"] {
  width: 100%;
  padding: 9px;
  border: 1px solid var(--edge);
  background: var(--ground);
  color: var(--ink);
  font: inherit;
}

#report-reactions {
  margin-top: 16px;
  padding: 10px 14px;
  border: 1px solid var(--rule);
}

.reaction-choice {
  display: block;
  font-weight: 400;
  margin: 7px 0;
}

.dialog-intro {
  max-width: var(--measure);
  color: var(--muted);
  font-size: var(--step--1);
}

/* Reserves its line so the dialog does not jump when a message appears. */
.dialog-status {
  min-height: 1.5em;
  margin: 12px 0 0;
  color: var(--warning);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin: 18px 0 0;
  padding: 0;
}

.dialog-actions button {
  padding: 8px 14px;
  border: 1px solid var(--edge);
  background: var(--ground);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}

#report-submit {
  border-color: var(--ink);
  font-weight: 600;
}

/* --- Peer voting ---
   A prompt and two buttons. There is deliberately no count, score or bar here:
   votes are a private maintainer signal, and a visible tally would read as
   confirmation -- exactly the manufactured confidence this project exists to
   eliminate. Do not add one. */

.vote-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.vote-prompt {
  max-width: 34ch;
  color: var(--muted);
  font-size: var(--step--1);
  overflow-wrap: anywhere;
}

.vote-button {
  padding: 3px 10px;
  border: 1px solid var(--edge);
  border-radius: 999px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: var(--step--1);
  cursor: pointer;
}

/* --- Review queue (maintainer only) ---
   Sized for a phone: reports get read right after a play session. */

.review-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.review-row {
  padding: 14px 0;
  border-bottom: 1px solid var(--rule);
}

.review-pair {
  margin: 0;
  font-weight: 600;
}

.review-meta {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: var(--step--1);
}

.review-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.review-actions button {
  flex: 1 1 auto;
  /* A comfortable touch target, because this page is used on a phone. */
  min-height: 44px;
  border: 1px solid currentColor;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.review-approve { color: var(--confirmed); }
.review-reject  { color: var(--warning); }
```

- [ ] **Step 6: Keep the review page working**

`review/index.html` also loads the stylesheet, so moving the tokens out would
strip every colour variable from it and leave a maintainer-only page rendering
against undefined custom properties. It also uses `.site-header` and
`.tagline`, which this task removed from the main page.

Add the token sheet above the existing link in `review/index.html`:

```html
  <link rel="stylesheet" href="../assets/css/tokens.css">
  <link rel="stylesheet" href="../assets/css/style.css">
```

And append to `assets/css/style.css`, so the review page keeps a coherent
header without pulling the masthead's always-dark treatment onto a page that
does not want it:

```css
/* --- Plain page header ---
   Used by review/index.html, which is maintainer-only and deliberately does
   not carry the masthead, the wordmark or the weave strip. */

.site-header {
  max-width: var(--col);
  margin-inline: auto;
  padding: 28px var(--gutter) 0;
}

.site-header h1 {
  margin: 0;
  font-size: var(--step-2);
  font-variation-settings: 'opsz' 60;
}

.tagline {
  max-width: var(--measure);
  margin: 10px 0 20px;
  color: var(--muted);
  font-size: var(--step--1);
}
```

Add a guard to `test/assets.test.mjs`:

```js
test('every page that loads the stylesheet also loads the tokens', () => {
  // style.css declares no colour literal, so a page without tokens.css renders
  // against undefined custom properties.
  for (const page of ['../index.html', '../review/index.html']) {
    const html = read(page);
    if (!html.includes('style.css')) continue;
    assert.match(html, /tokens\.css/, `${page} loads style.css without tokens.css`);
  }
});
```

- [ ] **Step 7: Run the tests**

Run: `npm test && npm run validate`

Expected: all asset and shell tests pass, all 22 view tests still pass, validate reports no errors.

- [ ] **Step 8: Commit**

```bash
git add index.html review/index.html assets/css/style.css test/assets.test.mjs
git commit -m "Rebuild the page shell around a dark masthead

The wordmark carries the game's name so the heading stops repeating it; the
accessible name is unchanged. Filters move into a disclosure instead of
crowding the header, and the report action promotes into the tab bar with
both controls still shipping so exactly one survives. style.css no longer
declares any colour literal."
```

---

### Task 3: The weave strip

The header's one bold element: the whole character × gift grid at a few pixels per cell, drawn so that only cells carrying a signal become elements. With today's data that is 349 marks on 4,240 cells — the bare ground is a single rect, not 3,891 of them.

**Files:**
- Create: `assets/js/views/weave.js`
- Create: `test/weave.test.mjs`
- Modify: `assets/css/style.css` (append the weave block)

**Interfaces:**
- Consumes: `index` from `buildIndex`, `state.filters` shaped like `DEFAULT_FILTERS`, and `el` from `./shared.js`.
- Produces: `weaveModel(index, filters)` → `{ columns, rows, pairs, confirmed, favouritesFound, favouritesTotal, marks }` where `marks` is `[{ x, y, state }]`; `weaveSummary(model)` → `string`; `render(container, index, state)`. Task 9 calls `render` with the `#weave` element.

- [ ] **Step 1: Write the failing test**

Create `test/weave.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../assets/js/data.js';
import { DEFAULT_FILTERS } from '../assets/js/filters.js';
import { weaveModel, weaveSummary } from '../assets/js/views/weave.js';

const dataset = {
  categories: [{ id: 'books', label: 'Books', inGameDescriptor: null, aliases: [] }],
  gifts: [
    { id: 'book', name: 'Book', category: 'books', rarity: null, description: '', sources: [] },
    { id: 'rock', name: 'Rock', category: null, rarity: null, description: '', sources: [] },
  ],
  characters: [
    { id: 'c1', name: 'C1', giftable: true, spoiler: false, traits: [], categories: { books: { state: 'guide', source: null } }, rarityPreference: null, favorites: [], notes: null },
    { id: 'c2', name: 'C2', giftable: true, spoiler: true, traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null },
    { id: 'c3', name: 'C3', giftable: false, spoiler: false, traits: [], categories: {}, rarityPreference: null, favorites: [], notes: null },
  ],
  observations: [],
  sources: [],
};

const clone = (extra) => ({ ...dataset, ...extra });

test('rows count only giftable characters the filters admit', () => {
  const model = weaveModel(buildIndex(dataset), DEFAULT_FILTERS);
  // c2 is a spoiler and hideSpoilers defaults on; c3 is not giftable.
  assert.equal(model.rows, 1);
  assert.equal(model.columns, 2);
  assert.equal(model.pairs, 2);
});

test('untested pairs produce no mark', () => {
  const model = weaveModel(buildIndex(dataset), DEFAULT_FILTERS);
  // c1 x book is PREDICTED; c1 x rock has no category link, so it is UNTESTED.
  assert.deepEqual(model.marks, [{ x: 0, y: 0, state: 'PREDICTED' }]);
});

test('a pending report is marked but never counted as confirmed', () => {
  const pending = [{ id: 'p1', character: 'c1', gift: 'rock', reaction: 'loved', created_at: '2026-09-21T00:00:00Z' }];
  const model = weaveModel(buildIndex(dataset, pending), DEFAULT_FILTERS);
  assert.equal(model.confirmed, 0, 'a pending report is not a confirmation');
  assert.ok(model.marks.some((m) => m.state === 'PENDING'), 'a pending report should still show on the weave');
});

test('an observed favourite counts as confirmed', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'favorite', date: '2026-09-21' }];
  const model = weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS);
  assert.equal(model.confirmed, 1);
  assert.equal(model.favouritesFound, 1);
});

test('a declared favourite counts even though no player observed it', () => {
  // deriveConfidence never returns FAVORITE for a declared-but-unobserved
  // gift, so counting states alone would disagree with the Favourites tab.
  const characters = dataset.characters.map((c) => (c.id === 'c1' ? { ...c, favorites: ['book'] } : c));
  const model = weaveModel(buildIndex(clone({ characters })), DEFAULT_FILTERS);
  assert.equal(model.favouritesFound, 1);
  assert.equal(model.confirmed, 0, 'declaring a favourite is not a player confirmation');
});

test('a declared favourite naming an unknown gift does not count', () => {
  const characters = dataset.characters.map((c) => (c.id === 'c1' ? { ...c, favorites: ['no-such-gift'] } : c));
  const model = weaveModel(buildIndex(clone({ characters })), DEFAULT_FILTERS);
  assert.equal(model.favouritesFound, 0);
});

test('the summary is two sentences and never a middle-dot string', () => {
  const summary = weaveSummary(weaveModel(buildIndex(dataset), DEFAULT_FILTERS));
  assert.equal(summary, 'No pair confirmed yet, out of 2. 1 favourite still unfound.');
  assert.doesNotMatch(summary, /·/);
});

test('the summary switches to counts once something is confirmed', () => {
  const observations = [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'liked', date: '2026-09-21' }];
  const summary = weaveSummary(weaveModel(buildIndex(clone({ observations })), DEFAULT_FILTERS));
  assert.match(summary, /^1 of 2 pairs confirmed\./);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern='rows count only giftable'`

Expected: FAIL — cannot resolve `../assets/js/views/weave.js`.

- [ ] **Step 3: Write `assets/js/views/weave.js`**

```js
// The weave strip: the whole character x gift grid at a few pixels per cell.
// Almost all of it is bare, and that emptiness is the point -- so the bare
// ground is one background rect rather than thousands of empty elements, and
// the DOM grows with what the community knows rather than with the dataset.
import { el } from './shared.js';

const NS = 'http://www.w3.org/2000/svg';

// Every state that carries a signal. UNTESTED is deliberately absent: it is
// the ground itself, and drawing it would cost thousands of nodes to say
// nothing.
const MARKED = new Set(['FAVORITE', 'CONFIRMED', 'CONTESTED', 'PENDING', 'PREDICTED']);

// Mirrors favoritesModel. A favourite is found when a player observed one OR
// the character declares one; deriveConfidence never returns FAVORITE for a
// declared-but-unobserved gift, so counting states alone would make the
// masthead and the Favourites tab report different totals from one dataset.
function hasFavourite(index, character, gifts) {
  const declared = (character.favorites ?? []).map((id) => index.byGiftId.get(id)).filter(Boolean);
  if (declared.length > 0) return true;
  return gifts.some((gift) => index.confidenceFor(character.id, gift.id).state === 'FAVORITE');
}

export function weaveModel(index, filters) {
  const characters = index.characters
    .filter((c) => c.giftable)
    .filter((c) => !(filters.hideSpoilers && c.spoiler));
  const gifts = index.gifts;

  const marks = [];
  let confirmed = 0;
  let favouritesFound = 0;

  characters.forEach((character, y) => {
    gifts.forEach((gift, x) => {
      const { state } = index.confidenceFor(character.id, gift.id);
      // A pending report is a real player's result but not a confirmation, so
      // it is drawn and not counted.
      if (state === 'FAVORITE' || state === 'CONFIRMED') confirmed += 1;
      if (MARKED.has(state)) marks.push({ x, y, state });
    });
    if (hasFavourite(index, character, gifts)) favouritesFound += 1;
  });

  return {
    columns: gifts.length,
    rows: characters.length,
    pairs: characters.length * gifts.length,
    confirmed,
    favouritesFound,
    favouritesTotal: characters.length,
    marks,
  };
}

// Two sentences rather than a middle-dot-joined string. It states where the
// project stands, which is also the reason to contribute.
export function weaveSummary(model) {
  const n = (value) => value.toLocaleString('en-GB');
  const pairs = model.confirmed === 0
    ? `No pair confirmed yet, out of ${n(model.pairs)}.`
    : `${n(model.confirmed)} of ${n(model.pairs)} pairs confirmed.`;
  const favourites = model.favouritesFound === 0
    ? `${n(model.favouritesTotal)} favourite${model.favouritesTotal === 1 ? '' : 's'} still unfound.`
    : `${n(model.favouritesFound)} of ${n(model.favouritesTotal)} favourites found.`;
  return `${pairs} ${favourites}`;
}

function rect(attrs) {
  const node = document.createElementNS(NS, 'rect');
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

export function render(container, index, state) {
  const model = weaveModel(index, state.filters);
  container.replaceChildren();
  // Every character filtered out. Render nothing rather than an empty box,
  // which would read as breakage.
  if (model.rows === 0 || model.columns === 0) return;

  const summary = weaveSummary(model);

  const link = el('a', 'weave');
  link.href = '#/matrix';
  link.setAttribute('aria-label', `${summary} Open the full matrix.`);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'weave-svg');
  svg.setAttribute('viewBox', `0 0 ${model.columns} ${model.rows}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  // The summary sentence beside it already carries everything the picture
  // says, so the picture itself is decorative to a screen reader.
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  svg.append(rect({ class: 'weave-ground', width: model.columns, height: model.rows }));

  const marks = document.createElementNS(NS, 'g');
  marks.setAttribute('class', 'weave-marks');
  for (const mark of model.marks) {
    marks.append(rect({
      class: `weave-mark weave-${mark.state.toLowerCase()}`,
      x: mark.x,
      y: mark.y,
      width: 1,
      height: 1,
    }));
  }
  svg.append(marks);

  link.append(svg);
  container.append(link, el('p', 'weave-summary', summary));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern='weave|summary|favourite|pending report is marked'`

Expected: all eight weave tests PASS.

- [ ] **Step 5: Append the weave styles to `assets/css/style.css`**

```css
/* --- The weave strip ---
   The whole grid at a few pixels per cell. Individual marks are NOT
   interactive: at 80x53 in a full-width strip a cell is about 4px by 0.8px,
   and a control nobody can hit must not be presented as one. The strip as a
   whole links to the matrix, where per-pair detail lives. */

.weave-mount:empty {
  display: none;
}

.weave-mount {
  margin-top: 22px;
}

.weave {
  display: block;
}

.weave-svg {
  display: block;
  width: 100%;
  height: clamp(44px, 7vw, 68px);
  border: 1px solid var(--masthead-rule);
}

.weave:hover .weave-svg {
  border-color: var(--masthead-edge);
}

.weave-ground { fill: var(--weave-ground); }

.weave-mark { shape-rendering: crispEdges; }
.weave-favorite  { fill: var(--weave-favorite); }
.weave-confirmed { fill: var(--weave-confirmed); }
.weave-contested { fill: var(--weave-contested); }
.weave-pending   { fill: var(--weave-pending); }
.weave-predicted { fill: var(--weave-predicted); }

.weave-summary {
  max-width: var(--measure);
  margin: 10px 0 0;
  color: var(--masthead-muted);
  font-size: var(--step--1);
}

/* The page's only non-user-triggered motion: the marks arrive once, together,
   as a single moment rather than a stagger of 349 separate animations. */
@media (prefers-reduced-motion: no-preference) {
  .weave-marks {
    animation: weave-in 700ms ease-out backwards;
  }
}

@keyframes weave-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
```

- [ ] **Step 6: Commit**

```bash
git add assets/js/views/weave.js test/weave.test.mjs assets/css/style.css
git commit -m "Add the weave strip

Draws the whole grid at a few pixels per cell, emitting an element only for
cells that carry a signal -- 349 marks rather than 4,240. Favourite counting
mirrors favoritesModel's declared-union-observed rule so the masthead and the
Favourites tab cannot disagree, and a pending report is drawn without being
counted as a confirmation."
```

---

### Task 4: Shared view helpers

Three helpers every later view task uses. Adding them first keeps Tasks 5–8 from each inventing their own chip markup.

**Files:**
- Modify: `assets/js/views/shared.js`
- Modify: `test/views.test.mjs`
- Modify: `assets/css/style.css` (append the chip block)

**Interfaces:**
- Consumes: `el` from the same module; `index.byCategoryId` from `buildIndex`.
- Produces: `chip(text, options)` → `HTMLElement`; `partitionRows(rows)` → `{ signal, untested }`; `categoryChips(index, character)` → `[{ id, label, state, source }]`. Tasks 5, 6 and 8 all consume these.

- [ ] **Step 1: Write the failing test**

Append to `test/views.test.mjs`. It already imports from `../assets/js/views/shared.js`; extend that import to include `partitionRows` and `categoryChips`.

```js
test('partitionRows splits signal from untested and preserves order', () => {
  const rows = [
    { gift: { id: 'a' }, confidence: { state: 'FAVORITE' } },
    { gift: { id: 'b' }, confidence: { state: 'PREDICTED' } },
    { gift: { id: 'c' }, confidence: { state: 'UNTESTED' } },
    { gift: { id: 'd' }, confidence: { state: 'PENDING' } },
    { gift: { id: 'e' }, confidence: { state: 'UNTESTED' } },
  ];
  const { signal, untested } = partitionRows(rows);
  assert.deepEqual(signal.map((r) => r.gift.id), ['a', 'b', 'd']);
  assert.deepEqual(untested.map((r) => r.gift.id), ['c', 'e']);
});

test('partitionRows on an all-untested character yields an empty signal half', () => {
  const rows = [{ gift: { id: 'a' }, confidence: { state: 'UNTESTED' } }];
  const { signal, untested } = partitionRows(rows);
  assert.deepEqual(signal, []);
  assert.equal(untested.length, 1);
});

test('categoryChips resolves labels and drops refuted links', () => {
  const idx = buildIndex(dataset);
  const character = {
    categories: {
      books: { state: 'guide', source: 'polygon' },
      coffee: { state: 'refuted', source: 'polygon' },
    },
  };
  const chips = categoryChips(idx, character);
  // A refuted link is not a like -- it must never render as one.
  assert.deepEqual(chips.map((c) => c.id), ['books']);
  assert.equal(chips[0].label, 'Books');
  assert.equal(chips[0].state, 'guide');
});

test('categoryChips falls back to the raw id rather than inventing a label', () => {
  const idx = buildIndex(dataset);
  const chips = categoryChips(idx, { categories: { unknown: { state: 'guide', source: null } } });
  assert.equal(chips[0].label, 'unknown');
});

test('categoryChips tolerates a character with no categories key', () => {
  const idx = buildIndex(dataset);
  assert.deepEqual(categoryChips(idx, {}), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern='partitionRows splits signal'`

Expected: FAIL — `partitionRows is not defined`.

- [ ] **Step 3: Append the helpers to `assets/js/views/shared.js`**

```js
// Splits confidence-sorted rows into the half that carries a signal and the
// half nobody has tried. The caller renders them differently: a table for what
// is known, a dense chip grid for what is not. Input order is preserved, so a
// list already sorted by confidence stays sorted.
export function partitionRows(rows) {
  const signal = [];
  const untested = [];
  for (const row of rows) {
    (row.confidence.state === 'UNTESTED' ? untested : signal).push(row);
  }
  return { signal, untested };
}

// A character's guide-derived category links, with refuted ones removed: a
// refuted link is not a like, and rendering it as one would invent a
// preference nobody reported.
export function categoryChips(index, character) {
  return Object.entries(character.categories ?? {})
    .filter(([, link]) => link.state !== 'refuted')
    .map(([id, link]) => ({
      id,
      label: index.byCategoryId.get(id)?.label ?? id,
      state: link.state,
      source: link.source,
    }));
}

// A small inline token: a category, a gift name, a suggestion. It renders as a
// link when it has a destination and as a plain span when it does not, so
// nothing ever looks clickable without being clickable.
export function chip(text, { href, className } = {}) {
  const classes = ['chip', className].filter(Boolean).join(' ');
  const node = el(href ? 'a' : 'span', classes, text);
  if (href) node.href = href;
  return node;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`

Expected: the five new tests PASS and all 22 pre-existing view tests still pass.

- [ ] **Step 5: Append the chip styles to `assets/css/style.css`**

```css
/* --- Chips ---
   One token style, used for categories, gift names and suggestions. A chip
   that links is underlined on hover; a chip that is only a label never is. */

.chip {
  display: inline-block;
  padding: 2px 9px;
  border: 1px solid var(--rule);
  border-radius: 999px;
  font-size: var(--step--1);
  line-height: 1.5;
  text-decoration: none;
  color: var(--ink);
  background: var(--raised);
}

a.chip:hover {
  border-color: var(--edge);
  text-decoration: underline;
  text-underline-offset: 0.16em;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

/* A category carried over from a published guide is a guess, and reads as one. */
.chip.provenance-guide,
.chip.provenance-refuted {
  border-style: dashed;
  color: var(--muted);
}
```

- [ ] **Step 6: Commit**

```bash
git add assets/js/views/shared.js test/views.test.mjs assets/css/style.css
git commit -m "Add shared chip, partition and category helpers

partitionRows splits a character's rows into what is known and what nobody has
tried, so the two can be rendered differently. categoryChips drops refuted
links, because a refuted link is not a like."
```

---

### Task 5: Characters index and detail

Turns 53 bullets into a tessellation, and turns an 80-row table with 75 identical noise rows into a table of what carries a signal plus a dense chip grid of what nobody has tried. The profile section and rarity column render only when populated.

**Note on one heading.** The spec calls the signal section "Worth trying". That is true only while every row is still a guess; once a player has reported something, the section is reporting results. This task adds `signalHeading(rows)` so the heading adapts rather than overclaiming.

**Files:**
- Modify: `assets/js/views/character.js`
- Modify: `test/views.test.mjs`
- Modify: `assets/css/style.css` (append the index and detail blocks)

**Interfaces:**
- Consumes: `partitionRows`, `categoryChips`, `chip` from Task 4; `characterRows`, `detailStatus` unchanged from this file.
- Produces: `characterIndexModel(index, filters, search)` → `[{ character, categories, summary }]`; `characterSummary(index, character)` → `string`; `signalHeading(rows)` → `string`. `characterRows` and `detailStatus` keep their exact current signatures and bodies.

- [ ] **Step 1: Write the failing test**

Append to `test/views.test.mjs`, extending its `character.js` import to include `characterIndexModel`, `characterSummary` and `signalHeading`.

```js
test('characterSummary reports the strongest true thing, never a negative', () => {
  const idx = buildIndex(dataset);
  // The fixture's c1 has one favourite observation on `brew`.
  assert.equal(characterSummary(idx, idx.byCharacterId.get('c1')), '1 favourite found');
});

test('characterSummary counts a declared favourite the Favourites tab would count', () => {
  const characters = [{ ...dataset.characters[0], favorites: ['rock'] }];
  const idx = buildIndex({ ...dataset, characters, observations: [] });
  assert.equal(characterSummary(idx, idx.byCharacterId.get('c1')), '1 favourite found');
});

test('characterSummary falls back through confirmed, predicted, then nothing', () => {
  const base = { ...dataset.characters[0], favorites: [] };

  const predictedOnly = buildIndex({ ...dataset, characters: [base], observations: [] });
  // c1 likes books, and `book` is a books item, so exactly one prediction.
  assert.equal(characterSummary(predictedOnly, predictedOnly.byCharacterId.get('c1')), '1 worth trying');

  const confirmed = buildIndex({
    ...dataset,
    characters: [base],
    observations: [{ id: 'o1', character: 'c1', gift: 'book', reaction: 'liked', date: '2026-09-21' }],
  });
  assert.equal(characterSummary(confirmed, confirmed.byCharacterId.get('c1')), '1 confirmed');

  const bare = buildIndex({ ...dataset, characters: [{ ...base, categories: {} }], observations: [] });
  assert.equal(characterSummary(bare, bare.byCharacterId.get('c1')), 'nothing tested yet');
});

test('characterIndexModel hides non-giftable characters and honours search', () => {
  const characters = [
    { ...dataset.characters[0], id: 'aa', name: 'Aada' },
    { ...dataset.characters[0], id: 'bb', name: 'Bruno' },
    { ...dataset.characters[0], id: 'cc', name: 'Cass', giftable: false },
  ];
  const idx = buildIndex({ ...dataset, characters });
  assert.deepEqual(characterIndexModel(idx, DEFAULT_FILTERS, '').map((e) => e.character.id), ['aa', 'bb']);
  assert.deepEqual(characterIndexModel(idx, DEFAULT_FILTERS, 'bru').map((e) => e.character.id), ['bb']);
});

test('characterIndexModel carries the category chips for each character', () => {
  const idx = buildIndex(dataset);
  const [entry] = characterIndexModel(idx, DEFAULT_FILTERS, '');
  assert.deepEqual(entry.categories.map((c) => c.label), ['Books']);
});

test('signalHeading only claims "worth trying" while every row is a guess', () => {
  assert.equal(signalHeading([{ confidence: { state: 'PREDICTED' } }]), 'Worth trying');
  assert.equal(
    signalHeading([{ confidence: { state: 'PREDICTED' } }, { confidence: { state: 'CONFIRMED' } }]),
    'What we know',
  );
  assert.equal(signalHeading([{ confidence: { state: 'PENDING' } }]), 'What we know');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern='characterSummary reports the strongest'`

Expected: FAIL — `characterSummary is not defined`.

- [ ] **Step 3: Rewrite `assets/js/views/character.js`**

`characterRows` and `detailStatus` are reproduced unchanged — do not edit them, the existing tests depend on their exact behaviour.

```js
import { passesFilters } from '../filters.js';
import {
  sortByConfidence, badge, el, emptyState, sourceName, reportButton,
  partitionRows, categoryChips, chip,
} from './shared.js';
import { voteControl, voteControlModel } from '../vote-control.js';

export function characterRows(index, characterId, filters) {
  const rows = index.gifts
    .map((gift) => ({ gift, confidence: index.confidenceFor(characterId, gift.id) }))
    .filter(({ confidence }) => passesFilters(confidence, filters));
  return sortByConfidence(rows);
}

// Pure so the detail route's branching is testable without a DOM. Order matters:
// the missing check runs first, because every later check dereferences character.
export function detailStatus(character, filters) {
  if (!character) return 'missing';
  if (filters.hideSpoilers && character.spoiler) return 'hidden-spoiler';
  if (!character.giftable) return 'not-giftable';
  return 'ok';
}

// The strongest true statement about a character, in a fixed order. It never
// implies a negative: a character nobody has tested reads as untested, not as
// one whose gifts fail.
export function characterSummary(index, character) {
  // Union by gift id, exactly as favoritesModel does, so this and the
  // Favourites tab can never disagree about whether a favourite is known.
  const favourites = new Set(
    (character.favorites ?? []).map((id) => index.byGiftId.get(id)).filter(Boolean).map((g) => g.id),
  );
  let confirmed = 0;
  let predicted = 0;

  for (const gift of index.gifts) {
    const { state } = index.confidenceFor(character.id, gift.id);
    if (state === 'FAVORITE') favourites.add(gift.id);
    else if (state === 'CONFIRMED') confirmed += 1;
    else if (state === 'PREDICTED') predicted += 1;
  }

  if (favourites.size > 0) return `${favourites.size} favourite${favourites.size === 1 ? '' : 's'} found`;
  if (confirmed > 0) return `${confirmed} confirmed`;
  if (predicted > 0) return `${predicted} worth trying`;
  return 'nothing tested yet';
}

export function characterIndexModel(index, filters, search) {
  return index.characters
    .filter((c) => c.giftable)
    .filter((c) => !(filters.hideSpoilers && c.spoiler))
    .filter((c) => !search || c.name.toLowerCase().includes(search))
    .map((character) => ({
      character,
      categories: categoryChips(index, character),
      summary: characterSummary(index, character),
    }));
}

// "Worth trying" is only true while every row is still a guess. Once a player
// has reported one, the section is reporting results, not making suggestions.
export function signalHeading(rows) {
  return rows.every((row) => row.confidence.state === 'PREDICTED') ? 'Worth trying' : 'What we know';
}

function chipList(entries, className) {
  const list = el('ul', ['chip-list', className].filter(Boolean).join(' '));
  for (const entry of entries) {
    const item = el('li');
    item.append(chip(entry.label, { className: `provenance-${entry.state}` }));
    list.append(item);
  }
  return list;
}

function renderPicker(container, index, state) {
  const entries = characterIndexModel(index, state.filters, state.search);
  container.append(el('h2', null, 'Characters'));

  if (entries.length === 0) {
    container.append(emptyState(state.search
      ? `No character’s name matches “${state.search}”.`
      : 'No characters to show. Untick “Hide spoilers” to see every character.'));
    return;
  }

  const grid = el('ul', 'tessera-grid');
  for (const entry of entries) {
    const item = el('li', 'tessera');
    const link = el('a', 'tessera-name', entry.character.name);
    link.href = `#/character/${entry.character.id}`;
    item.append(link);
    if (entry.categories.length) item.append(chipList(entry.categories));
    item.append(el('p', 'tessera-summary', entry.summary));
    grid.append(item);
  }
  container.append(grid);
}

// Profile and rarity render only when the data exists. Today no character has
// traits, and a heading followed by "nobody has entered this yet" on all 53
// pages is furniture, not information.
function renderProfile(container, index, character) {
  if (character.traits.length > 0) {
    const traits = el('ul', 'traits');
    for (const t of character.traits) {
      const item = el('li', t.category ? 'trait' : 'trait trait-flavor', t.text);
      if (!t.category) item.append(el('span', 'flavor-tag', ' (flavour — not a gift type)'));
      traits.append(item);
    }
    container.append(el('h3', null, 'Profile'), traits);
  }

  if (character.rarityPreference) {
    // Guide-derived and still unresolved in the spec: never stated as fact.
    container.append(el('p', 'rarity-pref', `Reported to prefer ${character.rarityPreference === 'rare' ? 'rare' : 'uncommon or rare'} items — unconfirmed.`));
  }

  const chips = categoryChips(index, character);
  if (chips.length === 0) return;

  const publishers = [...new Set(chips.map((c) => c.source).filter(Boolean).map((s) => sourceName(index, s)))];
  container.append(el('h3', null, 'Reported to like'), chipList(chips));
  container.append(el('p', 'provenance-note', publishers.length
    ? `Category preferences carried over from ${publishers.join(' and ')}. Nobody has confirmed them item by item yet.`
    : 'Category preferences are unconfirmed until a player reports an actual result.'));
}

function giftTable(index, character, rows, state) {
  // No gift has a recorded rarity today, so the column would be 100% em-dashes.
  const showRarity = rows.some(({ gift }) => gift.rarity);

  const headers = ['Gift', 'Category'];
  if (showRarity) headers.push('Rarity');
  headers.push('Status');
  if (state.submissionsEnabled) headers.push('Report');

  const headRow = el('tr');
  for (const h of headers) {
    const th = el('th', null, h);
    th.scope = 'col';
    headRow.append(th);
  }
  const head = el('thead');
  head.append(headRow);

  const body = el('tbody');
  for (const { gift, confidence } of rows) {
    // The state classes are an inline badge, never a row class -- see shared.js.
    const row = el('tr');
    const nameCell = el('td');
    const link = el('a', null, gift.name);
    link.href = `#/gift/${gift.id}`;
    nameCell.append(link);
    row.append(nameCell);
    row.append(el('td', null, gift.category ? index.byCategoryId.get(gift.category).label : '—'));
    if (showRarity) row.append(el('td', null, gift.rarity ?? '—'));

    const statusCell = el('td');
    statusCell.append(badge(confidence, index));
    if (confidence.state === 'PENDING' && state.submissionsEnabled) {
      for (const report of index.pendingFor(character.id, gift.id)) {
        statusCell.append(voteControl(voteControlModel(report, state.storage)));
      }
    }
    row.append(statusCell);

    if (state.submissionsEnabled) {
      const actionCell = el('td');
      actionCell.append(reportButton(character.id, gift.id));
      row.append(actionCell);
    }
    body.append(row);
  }

  const table = el('table', 'gift-table');
  table.append(head, body);
  return table;
}

// 75 of a character's 80 rows are untested. As a table that buries everything
// else; as chips it stays complete and one click from a report. Each chip is a
// report trigger carrying the same `.report-button` class app.js listens for,
// and degrades to a link to the gift when submissions are off.
function untestedBlock(character, rows, state) {
  const details = el('details', 'untested-block');
  details.append(el('summary', null, `Not tested yet (${rows.length})`));
  details.append(el('p', 'untested-note', 'Nobody has given any of these to this character. Any one of them is worth a report.'));

  const grid = el('ul', 'chip-list');
  for (const { gift } of rows) {
    const item = el('li');
    if (state.submissionsEnabled) {
      const button = el('button', 'chip chip-action report-button', gift.name);
      button.type = 'button';
      button.dataset.character = character.id;
      button.dataset.gift = gift.id;
      button.setAttribute('aria-label', `Report a result for ${gift.name}`);
      item.append(button);
    } else {
      item.append(chip(gift.name, { href: `#/gift/${gift.id}` }));
    }
    grid.append(item);
  }

  details.append(grid);
  return details;
}

export function render(container, index, state) {
  if (!state.id) return renderPicker(container, index, state);

  const character = index.byCharacterId.get(state.id);
  const status = detailStatus(character, state.filters);

  if (status === 'missing') {
    container.append(el('p', null, `No character called “${state.id}”.`));
    return renderPicker(container, index, state);
  }

  if (status === 'hidden-spoiler') {
    // Don't print the name: on a spoiler character the name is the spoiler.
    container.append(el('p', 'help-wanted', 'This character is hidden while “Hide spoilers” is on. Untick “Hide spoilers” to see them.'));
    return renderPicker(container, index, state);
  }

  container.append(el('h2', null, character.name));
  if (character.notes) container.append(el('p', 'notes', character.notes));

  if (status === 'not-giftable') {
    container.append(el('p', 'help-wanted', 'This character can’t be given gifts, so there is nothing to test here.'));
    return;
  }

  renderProfile(container, index, character);

  const rows = characterRows(index, character.id, state.filters);
  if (rows.length === 0) {
    container.append(el('h3', null, 'Gifts'));
    container.append(emptyState(state.filters.hideUnconfirmed
      ? 'No confirmed results yet — nobody has reported one for this character. Clear “Hide unconfirmed predictions” to see predictions.'
      : 'No gifts match the current filters. Clear “Hide untested pairs” to see the rest.'));
    return;
  }

  const { signal, untested } = partitionRows(rows);
  if (signal.length > 0) {
    container.append(el('h3', null, signalHeading(signal)));
    container.append(giftTable(index, character, signal, state));
  }
  if (untested.length > 0) container.append(untestedBlock(character, untested, state));
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`

Expected: the six new tests PASS, and the pre-existing `favorites sort above predictions`, `every gift appears when no filter is applied`, `hideUntested drops the uncategorised gift` and `detailStatus` tests still PASS untouched.

- [ ] **Step 5: Append the index and detail styles to `assets/css/style.css`**

```css
/* --- Characters index ---
   A tessellation, not a card kit: cells share hairlines instead of each
   carrying its own border, radius and shadow. */

.tessera-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 1px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
  background: var(--rule);
  border: 1px solid var(--rule);
}

.tessera {
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
  background: var(--ground);
}

.tessera-name {
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 24;
  font-size: var(--step-1);
  text-decoration: none;
}

.tessera-name:hover {
  text-decoration: underline;
  text-underline-offset: 0.16em;
}

.tessera-summary {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: var(--step--1);
}

/* --- Gift and character tables --- */

.gift-table {
  width: 100%;
  margin-top: 12px;
  border-collapse: collapse;
  font-size: var(--text-table);
}

.gift-table th,
.gift-table td {
  padding: 9px 14px 9px 0;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--rule);
}

.gift-table thead th {
  font-family: var(--font-body);
  font-weight: 600;
  font-size: var(--step--1);
  color: var(--muted);
}

.gift-table tbody tr:hover td {
  background: var(--raised);
}

/* --- The untested block --- */

.untested-block {
  margin-top: 30px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
}

.untested-block > summary {
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 24;
  font-size: var(--step-1);
  font-weight: 600;
  cursor: pointer;
}

.untested-note {
  max-width: var(--measure);
  margin: 10px 0 0;
  color: var(--muted);
  font-size: var(--step--1);
}

/* A chip that triggers a report rather than navigating. Dashed while the pair
   is untested, solid on hover, so it reads as an invitation. */
.chip-action {
  font: inherit;
  font-size: var(--step--1);
  color: var(--untested);
  border-style: dashed;
  cursor: pointer;
}

.chip-action:hover {
  color: var(--ink);
  border-style: solid;
  border-color: var(--edge);
}

.traits,
.liked-categories {
  max-width: var(--measure);
  margin: 8px 0 0;
  padding-left: 1.2em;
}

.provenance-note,
.rarity-pref,
.notes {
  max-width: var(--measure);
  color: var(--muted);
  font-size: var(--step--1);
}
```

- [ ] **Step 6: Commit**

```bash
git add assets/js/views/character.js test/views.test.mjs assets/css/style.css
git commit -m "Rebuild the characters index and detail

The index becomes a tessellation carrying each character's predicted
categories and a status line that states the strongest true thing without ever
implying a negative. Detail splits 80 rows into what carries a signal and a
chip grid of the 75 nobody has tried, each chip a report trigger. Profile and
rarity render only when the data exists."
```

---

### Task 6: Gifts index and detail

Turns 80 alphabetical bullets into category groups, and applies the same signal/untested split to the gift detail's 53 character rows. Removes the `·`-joined meta line.

**Files:**
- Modify: `assets/js/views/gift.js`
- Modify: `test/views.test.mjs`
- Modify: `assets/css/style.css` (append the group block)

**Interfaces:**
- Consumes: `partitionRows`, `chip` from Task 4; `giftRows` unchanged from this file.
- Produces: `giftIndexModel(index, search)` → `[{ id, label, gifts }]`, categories alphabetical with the uncategorised group last and `id === null`. `giftRows` keeps its exact current signature and body.

- [ ] **Step 1: Write the failing test**

Append to `test/views.test.mjs`, extending its `gift.js` import to include `giftIndexModel`.

```js
test('giftIndexModel groups by category, alphabetically', () => {
  const idx = buildIndex(dataset);
  const groups = giftIndexModel(idx, '');
  assert.deepEqual(groups.map((g) => g.label), ['Books', 'Coffee', 'Category not recorded yet']);
  assert.deepEqual(groups[0].gifts.map((g) => g.id), ['book']);
});

test('the uncategorised group sorts last and is identified by a null id', () => {
  const idx = buildIndex(dataset);
  const groups = giftIndexModel(idx, '');
  const last = groups.at(-1);
  assert.equal(last.id, null);
  assert.deepEqual(last.gifts.map((g) => g.id), ['rock']);
});

test('giftIndexModel filters by search and drops groups that empty out', () => {
  const idx = buildIndex(dataset);
  const groups = giftIndexModel(idx, 'roc');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, null);
});

test('giftIndexModel returns nothing when the search matches nothing', () => {
  const idx = buildIndex(dataset);
  assert.deepEqual(giftIndexModel(idx, 'zzzz'), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern='giftIndexModel groups by category'`

Expected: FAIL — `giftIndexModel is not defined`.

- [ ] **Step 3: Rewrite `assets/js/views/gift.js`**

`giftRows` is reproduced unchanged — do not edit it.

```js
import { passesFilters } from '../filters.js';
import { sortByConfidence, badge, el, emptyState, reportButton, partitionRows, chip } from './shared.js';
import { voteControl, voteControlModel } from '../vote-control.js';

export function giftRows(index, giftId, filters) {
  const rows = index.characters
    .filter((character) => character.giftable)
    .filter((character) => !(filters.hideSpoilers && character.spoiler))
    .map((character) => ({ character, confidence: index.confidenceFor(character.id, giftId) }))
    .filter(({ confidence }) => passesFilters(confidence, filters));
  return sortByConfidence(rows);
}

// Groups the index so 80 alphabetical bullets become sections a player can
// scan. The uncategorised group sorts last under its own heading: 26 items
// nobody has classified is a to-do, not an error.
export function giftIndexModel(index, search) {
  const term = (search ?? '').trim();
  const matching = index.gifts.filter((gift) => !term || gift.name.toLowerCase().includes(term));

  const groups = new Map();
  for (const gift of matching) {
    const key = gift.category ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(gift);
  }

  const named = [...groups.entries()]
    .filter(([key]) => key !== null)
    .map(([key, gifts]) => ({ id: key, label: index.byCategoryId.get(key)?.label ?? key, gifts }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));

  const uncategorised = groups.get(null);
  if (uncategorised) named.push({ id: null, label: 'Category not recorded yet', gifts: uncategorised });
  return named;
}

function renderPicker(container, index, state) {
  const groups = giftIndexModel(index, state.search);
  container.append(el('h2', null, 'Gifts'));

  if (groups.length === 0) {
    container.append(emptyState(state.search
      ? `No gift’s name matches “${state.search}”.`
      : 'No gifts have been recorded yet.'));
    return;
  }

  for (const group of groups) {
    container.append(el('h3', null, `${group.label} (${group.gifts.length})`));
    if (group.id === null) {
      container.append(el('p', 'untested-note', 'Nobody has recorded what kind of item these are, so they have no predictions yet.'));
    }
    const list = el('ul', 'chip-list');
    for (const gift of group.gifts) {
      const item = el('li');
      // Rarity rides on the chip where it is recorded. No gift has one today,
      // so today every chip is just a name.
      const label = gift.rarity ? `${gift.name} (${gift.rarity})` : gift.name;
      item.append(chip(label, { href: `#/gift/${gift.id}` }));
      list.append(item);
    }
    container.append(list);
  }
}

function characterTable(index, gift, rows, state) {
  const headers = ['Character', 'Status'];
  if (state.submissionsEnabled) headers.push('Report');

  const headRow = el('tr');
  for (const h of headers) {
    const th = el('th', null, h);
    th.scope = 'col';
    headRow.append(th);
  }
  const head = el('thead');
  head.append(headRow);

  const body = el('tbody');
  for (const { character, confidence } of rows) {
    // The state classes are an inline badge, never a row class -- see shared.js.
    const row = el('tr');
    const nameCell = el('td');
    const link = el('a', null, character.name);
    link.href = `#/character/${character.id}`;
    nameCell.append(link);

    const statusCell = el('td');
    statusCell.append(badge(confidence, index));
    if (confidence.state === 'PENDING' && state.submissionsEnabled) {
      for (const report of index.pendingFor(character.id, gift.id)) {
        statusCell.append(voteControl(voteControlModel(report, state.storage)));
      }
    }
    row.append(nameCell, statusCell);

    if (state.submissionsEnabled) {
      const actionCell = el('td');
      actionCell.append(reportButton(character.id, gift.id));
      row.append(actionCell);
    }
    body.append(row);
  }

  const table = el('table', 'gift-table');
  table.append(head, body);
  return table;
}

// The same treatment the character page gives its 75 untested gifts: a dense
// chip grid rather than 48 identical table rows, each chip a report trigger
// carrying the `.report-button` class app.js listens for.
function untestedBlock(gift, rows, state) {
  const details = el('details', 'untested-block');
  details.append(el('summary', null, `Not tested yet (${rows.length})`));
  details.append(el('p', 'untested-note', `Nobody has given ${gift.name} to any of these characters. Any one of them is worth a report.`));

  const grid = el('ul', 'chip-list');
  for (const { character } of rows) {
    const item = el('li');
    if (state.submissionsEnabled) {
      const button = el('button', 'chip chip-action report-button', character.name);
      button.type = 'button';
      button.dataset.character = character.id;
      button.dataset.gift = gift.id;
      button.setAttribute('aria-label', `Report a result for ${character.name}`);
      item.append(button);
    } else {
      item.append(chip(character.name, { href: `#/character/${character.id}` }));
    }
    grid.append(item);
  }

  details.append(grid);
  return details;
}

export function render(container, index, state) {
  if (!state.id) return renderPicker(container, index, state);

  const gift = index.byGiftId.get(state.id);
  if (!gift) {
    container.append(el('p', null, `No gift called “${state.id}”.`));
    return renderPicker(container, index, state);
  }

  container.append(el('h2', null, gift.name));

  const category = gift.category ? index.byCategoryId.get(gift.category) : null;
  // One fact per line rather than a middle-dot-joined string, and rarity only
  // when it is recorded -- no gift has one today.
  if (category) container.append(el('p', 'meta', `Category: ${category.label}`));
  if (gift.rarity) container.append(el('p', 'meta', `Rarity: ${gift.rarity}`));
  if (category?.inGameDescriptor) {
    container.append(el('p', 'descriptor', `In-game description mentions: “${category.inGameDescriptor}”`));
  }
  if (!gift.category) {
    container.append(el('p', 'help-wanted', 'Nobody has recorded this item’s category yet, so it has no predictions.'));
  }

  const rows = giftRows(index, gift.id, state.filters);
  if (rows.length === 0) {
    container.append(emptyState(state.filters.hideUnconfirmed
      ? 'No confirmed results yet — nobody has reported giving this item. Clear “Hide unconfirmed predictions” to see predictions.'
      : 'No characters match the current filters. Clear “Hide untested pairs” to see the rest.'));
    return;
  }

  const { signal, untested } = partitionRows(rows);
  if (signal.length > 0) {
    container.append(el('h3', null, 'Characters'));
    container.append(characterTable(index, gift, signal, state));
  }
  if (untested.length > 0) container.append(untestedBlock(gift, untested, state));
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`

Expected: the four new tests PASS and the pre-existing `giftRows lists giftable characters ranked by confidence` test still PASSES.

- [ ] **Step 5: Append the group styles to `assets/css/style.css`**

```css
/* --- Gift index groups --- */

.meta,
.descriptor,
.help-wanted {
  max-width: var(--measure);
  margin: 6px 0 0;
  color: var(--muted);
  font-size: var(--step--1);
}

.descriptor {
  font-style: italic;
}

main#view > .chip-list {
  margin-bottom: 4px;
}
```

- [ ] **Step 6: Commit**

```bash
git add assets/js/views/gift.js test/views.test.mjs assets/css/style.css
git commit -m "Group the gift index by category

80 alphabetical bullets become sections, with the 26 items nobody has
classified in a final group that reads as a to-do. Gift detail gets the same
signal/untested split as the character page, and the middle-dot meta line
becomes one fact per line with rarity shown only when recorded."
```

---

### Task 7: Matrix

Rotates the 53 column headers so more fit, replaces the run-on legend with a swatch key, and lets the table escape the content column.

**Files:**
- Modify: `assets/js/views/matrix.js`
- Modify: `assets/css/style.css` (replace the matrix block)

**Interfaces:**
- Consumes: `cellClasses`, `stateLabel`, `el`, `emptyState` from `shared.js`; the `view-matrix` class that Task 9 puts on `#view`.
- Produces: no new exports. `matrixModel`, `SYMBOL` and `emptyMatrixMessage` keep their exact current signatures and bodies.

- [ ] **Step 1: Replace `render` and add the legend in `assets/js/views/matrix.js`**

Keep the imports, `matrixModel`, `SYMBOL` and `emptyMatrixMessage` exactly as they are. Replace only the `render` function, and add `LEGEND` and `legend` above it:

```js
// A real key: swatch, symbol and label per state. The old run-on string joined
// six entries with middle dots, which reads as decoration rather than a key.
const LEGEND = [
  ['FAVORITE', 'favourite'],
  ['CONFIRMED', 'confirmed'],
  ['CONTESTED', 'reports disagree'],
  ['PENDING', 'reported, awaiting review'],
  ['PREDICTED', 'predicted, unconfirmed'],
  ['UNTESTED', 'not tested'],
];

function legend() {
  const list = el('ul', 'matrix-legend');
  for (const [state, label] of LEGEND) {
    const item = el('li');
    item.append(el('span', `legend-swatch cell-${state.toLowerCase()}`, SYMBOL[state]));
    item.append(el('span', 'legend-label', label));
    list.append(item);
  }
  return list;
}

export function render(container, index, state) {
  const model = matrixModel(index, state.filters, state.search);
  container.append(el('h2', null, 'Full matrix'));
  container.append(legend());

  if (model.gifts.length === 0 || model.characters.length === 0) {
    container.append(emptyState(emptyMatrixMessage(state)));
    return;
  }

  const scroller = el('div', 'matrix-scroll');
  const table = el('table', 'matrix');

  const head = el('thead');
  const headRow = el('tr');
  const corner = el('th', 'corner', 'Gift');
  corner.scope = 'col';
  headRow.append(corner);
  for (const character of model.characters) {
    const th = el('th', 'col-head');
    th.scope = 'col';
    // The label is wrapped so it can be rotated without rotating the cell,
    // which would take the header out of the table's own layout.
    th.append(el('span', null, character.name));
    headRow.append(th);
  }
  head.append(headRow);

  const body = el('tbody');
  for (const gift of model.gifts) {
    const row = el('tr');
    const rowHead = el('th', 'row-head', gift.name);
    rowHead.scope = 'row';
    row.append(rowHead);
    for (const character of model.characters) {
      const confidence = model.cellAt(gift.id, character.id);
      // cellClasses, not stateClasses: a badge's inline-flex and ::before symbol
      // would break the table grid and duplicate the symbol already set here.
      const cell = el('td', cellClasses(confidence), SYMBOL[confidence.state]);
      cell.title = `${character.name} and ${gift.name}: ${stateLabel(confidence)}`;
      row.append(cell);
    }
    body.append(row);
  }

  table.append(head, body);
  scroller.append(table);
  container.append(scroller);
}
```

- [ ] **Step 2: Replace the matrix block in `assets/css/style.css`**

Delete the old `--- Full matrix view ---` block and write:

```css
/* --- Full matrix ---
   The densest view in the site: 80 gift rows by up to 53 character columns.
   Headers stick while the body scrolls both ways, and the column labels are
   rotated so far more of them fit on one screen. */

/* Set by app.js on #view. The matrix earns the whole viewport; nothing else
   does, so the column rule is lifted only here. */
main#view.view-matrix {
  max-width: none;
}

.matrix-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin: 10px 0 18px;
  padding: 0;
  list-style: none;
  font-size: var(--step--1);
}

.matrix-legend li {
  display: flex;
  align-items: center;
  gap: 7px;
}

.legend-swatch {
  display: inline-grid;
  place-items: center;
  width: 1.6em;
  height: 1.6em;
  border: 1px solid var(--rule);
  font-weight: 700;
}

.legend-label {
  color: var(--muted);
}

.matrix-scroll {
  overflow: auto;
  overscroll-behavior-x: contain;
  max-height: 80vh;
}

.matrix {
  border-collapse: collapse;
  font-size: var(--step--1);
}

.matrix th,
.matrix td {
  border: 1px solid var(--rule);
  white-space: nowrap;
}

.matrix td {
  min-width: 1.9em;
  padding: 3px 4px;
  text-align: center;
}

.matrix th.row-head,
.matrix th.corner {
  padding: 3px 10px 3px 6px;
  text-align: left;
  font-weight: 500;
}

.matrix thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--ground);
}

.matrix th.col-head {
  height: 8.5rem;
  padding: 0;
  vertical-align: bottom;
}

.matrix th.col-head > span {
  display: inline-block;
  width: 1.8em;
  transform: rotate(-60deg);
  transform-origin: left bottom;
  transform-box: content-box;
  font-weight: 500;
  text-align: left;
}

.matrix th.row-head {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--ground);
}

.matrix th.corner {
  position: sticky;
  left: 0;
  z-index: 3;
  vertical-align: bottom;
}

/* Cell tint classes for cellClasses(confidence): colour only. The visible
   symbol is already the cell's text content (see matrix.js), so unlike the
   badge classes in shared.js these never set display or add ::before/::after
   -- either would break the table grid or duplicate the symbol. */
.matrix td.cell-favorite,
.legend-swatch.cell-favorite  { background: var(--favorite-bg);  color: var(--favorite); }
.matrix td.cell-confirmed,
.legend-swatch.cell-confirmed { background: var(--confirmed-bg); color: var(--confirmed); }
.matrix td.cell-contested,
.legend-swatch.cell-contested { background: var(--contested-bg); color: var(--contested); }
.matrix td.cell-pending,
.legend-swatch.cell-pending   { background: var(--pending-bg);   color: var(--pending); }
.matrix td.cell-predicted,
.legend-swatch.cell-predicted { background: var(--predicted-bg); color: var(--predicted); }
.matrix td.cell-untested      { background: transparent; }
.legend-swatch.cell-untested  { background: var(--untested-bg); }
.matrix td.cell-exception { outline: 2px dotted var(--warning); outline-offset: -2px; }
.matrix td.cell-rarity-mismatch { border-bottom: 2px dashed var(--warning); }
```

- [ ] **Step 3: Run the tests**

Run: `npm test && npm run validate`

Expected: every test passes. `matrixModel` and `SYMBOL` were not touched, so the three matrix tests pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add assets/js/views/matrix.js assets/css/style.css
git commit -m "Give the matrix rotated headers and a real legend

Column labels rotate so far more of the 53 characters fit on a screen, and the
middle-dot legend string becomes a swatch-and-symbol key. The matrix is the
only view that lifts the content-column limit."
```

---

### Task 8: Favourites hunt

Replaces run-on comma-separated lines with one row per character whose suggestions are report triggers, so the tab that recruits the most valuable data is directly actionable.

**Files:**
- Modify: `assets/js/views/favorites.js`
- Modify: `assets/css/style.css` (append the hunt block)

**Interfaces:**
- Consumes: `chip` from Task 4; `favoritesModel` and `suggestionsFor` unchanged from this file.
- Produces: no new exports. `favoritesModel` keeps its exact current signature and body.

- [ ] **Step 1: Replace `render` in `assets/js/views/favorites.js`**

Keep the imports, `suggestionsFor` and `favoritesModel` exactly as they are; add `chip` to the `shared.js` import. Replace only `render`:

```js
// Each suggestion is a report trigger rather than plain text: this tab exists
// to recruit the one result no other guide has, so the suggestion and the way
// to report it are the same control. It carries the `.report-button` class
// app.js listens for, and degrades to a link when submissions are off.
function suggestionChips(character, suggestions, state) {
  const list = el('ul', 'chip-list');
  for (const gift of suggestions.slice(0, 6)) {
    const item = el('li');
    if (state.submissionsEnabled) {
      const button = el('button', 'chip chip-action report-button', gift.name);
      button.type = 'button';
      button.dataset.character = character.id;
      button.dataset.gift = gift.id;
      button.setAttribute('aria-label', `Report a result for ${gift.name} on ${character.name}`);
      item.append(button);
    } else {
      item.append(chip(gift.name, { href: `#/gift/${gift.id}` }));
    }
    list.append(item);
  }
  return list;
}

export function render(container, index, state) {
  const { found, unknown } = favoritesModel(index, state.filters);
  const total = found.length + unknown.length;

  container.append(el('h2', null, 'Favourites hunt'));
  container.append(el('p', 'intro', 'Every character has at least one item that gives double support points. Most are still unknown. If you find one, report it — this is the gap no other guide fills.'));

  if (total === 0) {
    container.append(emptyState('No characters to show. Untick “Hide spoilers” to see every character.'));
    return;
  }

  container.append(el('p', 'progress', `Found ${found.length} of ${total}.`));

  container.append(el('h3', null, `Still unknown (${unknown.length})`));
  if (unknown.length === 0) {
    container.append(emptyState('Nothing left to hunt — every character here has a known favourite.'));
  } else {
    const list = el('ul', 'hunt-list');
    for (const { character, suggestions } of unknown) {
      const item = el('li', 'hunt-row');
      const link = el('a', 'hunt-name', character.name);
      link.href = `#/character/${character.id}`;
      item.append(link);
      if (suggestions.length === 0) {
        item.append(el('p', 'hunt-note', 'Nothing untested left to suggest — try anything not yet reported.'));
      } else {
        item.append(suggestionChips(character, suggestions, state));
      }
      list.append(item);
    }
    container.append(list);
  }

  if (found.length === 0) return;

  container.append(el('h3', null, `Found (${found.length})`));
  const foundList = el('ul', 'hunt-list');
  for (const { character, gifts } of found) {
    const item = el('li', 'hunt-row');
    const link = el('a', 'hunt-name', character.name);
    link.href = `#/character/${character.id}`;
    item.append(link);
    const chips = el('ul', 'chip-list');
    for (const gift of gifts) {
      const li = el('li');
      li.append(chip(gift.name, { href: `#/gift/${gift.id}`, className: 'chip-favourite' }));
      chips.append(li);
    }
    item.append(chips);
    foundList.append(item);
  }
  container.append(foundList);
}
```

- [ ] **Step 2: Append the hunt styles to `assets/css/style.css`**

```css
/* --- Favourites hunt --- */

.intro,
.progress {
  max-width: var(--measure);
}

.progress {
  margin: 14px 0 0;
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 24;
  font-size: var(--step-1);
}

.hunt-list {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--rule);
}

.hunt-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--rule);
}

.hunt-name {
  font-family: var(--font-display);
  font-variation-settings: 'opsz' 24;
  font-size: var(--step-1);
  text-decoration: none;
}

.hunt-name:hover {
  text-decoration: underline;
  text-underline-offset: 0.16em;
}

.hunt-note {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: var(--step--1);
}

.chip-favourite {
  color: var(--favorite);
  border-color: currentColor;
  background: var(--favorite-bg);
}
```

- [ ] **Step 3: Run the tests**

Run: `npm test`

Expected: every test passes. `favoritesModel` was not touched, so its three tests pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add assets/js/views/favorites.js assets/css/style.css
git commit -m "Make the favourites hunt actionable

One row per character with its suggestions as report triggers, replacing lines
of comma-separated text. This tab recruits the one result no other guide has,
so the suggestion and the way to report it are now the same control."
```

---

### Task 9: Wire the weave strip and per-view classes

Mounts the strip, re-renders it when filters change, and puts a `view-<name>` class on `#view` so the matrix can lift the column limit.

**Files:**
- Modify: `assets/js/app.js`
- Modify: `test/assets.test.mjs`

**Interfaces:**
- Consumes: `render` from `./views/weave.js` (Task 3); `#weave` from `index.html` (Task 2); `main#view.view-matrix` from Task 7's CSS.
- Produces: nothing further.

- [ ] **Step 1: Write the failing test**

Append to `test/assets.test.mjs`:

```js
test('the weave strip is mounted and kept in step with the filters', () => {
  const app = read('../assets/js/app.js');
  assert.match(app, /from '\.\/views\/weave\.js'/, 'app.js must import the weave view');
  assert.match(app, /getElementById\('weave'\)/, 'app.js must mount the strip into #weave');
  // The strip's counts depend on the filters, so it has to re-render with the
  // view -- a stale count in the masthead is worse than no count.
  const renderBody = app.slice(app.indexOf('function render('), app.indexOf('async function refreshPending'));
  assert.match(renderBody, /weave/i, 'render() must refresh the strip');
});

test('each view gets a class so the matrix can lift the column limit', () => {
  const app = read('../assets/js/app.js');
  assert.match(app, /view-\$\{route\.view\}|`view-/, 'render() must set a per-view class on #view');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern='weave strip is mounted'`

Expected: FAIL — `app.js must import the weave view`.

- [ ] **Step 3: Modify `assets/js/app.js`**

Add the import alongside the other view imports:

```js
import * as weaveView from './views/weave.js';
```

Replace the `render` function with:

```js
function render() {
  const container = document.getElementById('view');
  const route = parseRoute(location.hash);
  container.replaceChildren();
  // A per-view hook, so the matrix can lift the content-column limit that
  // every other view wants.
  container.className = `view-${route.view}`;
  VIEW_MODULES[route.view].render(container, state.index, { ...state, id: route.id });

  // The strip's counts depend on the filters, so it re-renders with the view.
  // A stale count in the masthead is worse than no count at all.
  const weave = document.getElementById('weave');
  if (weave) weaveView.render(weave, state.index, state);

  for (const a of document.querySelectorAll('nav a')) {
    a.classList.toggle('active', a.getAttribute('href').startsWith(`#/${route.view}`));
  }
}
```

Note: `document.querySelectorAll('nav a')` now also matches `#report-fallback`, which lives inside the tab bar's `<nav>`. Its `href` is an absolute GitHub URL, so `startsWith('#/…')` is false for every route and it never gains `.active`. No change is needed, but do not narrow the selector to `.tabbar-inner a` without re-checking that the active tab still highlights.

- [ ] **Step 4: Run the tests**

Run: `npm test && npm run validate`

Expected: every test passes.

- [ ] **Step 5: Verify in a browser**

Serve the site and look at all four views:

```bash
python3 -m http.server 8000 --directory "$(git rev-parse --show-toplevel)"
```

Check, and report honestly on anything that fails:

1. The masthead renders the wordmark on a dark band, and the weave strip shows a sparse scatter of violet marks on a dark ground.
2. The summary sentence reads `No pair confirmed yet, out of 4,240. 53 favourites still unfound.`
3. Ticking "Hide spoilers" off changes the strip's row count.
4. Characters index is a tessellation with category chips; every character reads "5 worth trying".
5. A character page shows a five-row table and a collapsed "Not tested yet (75)"; opening it shows 75 chips, and clicking one opens the report dialog pre-filled with that pair.
6. Gifts index is grouped by category with "Category not recorded yet (26)" last.
7. The matrix fills the viewport width with rotated column headers and a swatch key.
8. Favourites shows 53 rows with clickable suggestion chips.
9. Force light mode (`:root[data-theme="light"]` is not wired, so use the OS setting or DevTools' emulation) and confirm the masthead stays dark and the wordmark stays legible.
10. At 390px width nothing scrolls horizontally except the matrix and the tab bar.

- [ ] **Step 6: Commit**

```bash
git add assets/js/app.js test/assets.test.mjs
git commit -m "Mount the weave strip and add per-view classes

The strip re-renders with the view so its counts never go stale against the
filters, and #view carries a view-<name> class so the matrix alone can lift
the content-column limit."
```

---

## Notes for the executor

- **Do not edit any function on the do-not-change list.** Tasks 5–8 reproduce `characterRows`, `detailStatus`, `giftRows`, `matrixModel`, `SYMBOL`, `emptyMatrixMessage`, `favoritesModel` and `suggestionsFor` verbatim so the file reads whole; copy them across unchanged and let the existing tests prove it.
- **`el()` sets `className` from its second argument**, so `el('button', 'chip chip-action report-button', gift.name)` produces a button with all three classes. `app.js` finds report triggers with `event.target.closest('.report-button')`, which is why every report chip carries that class.
- **Every colour must resolve to a token.** If a value is needed that `tokens.css` does not define, stop and add it there rather than writing a literal into `style.css`.
- **`npm test` runs `node --test`**, which discovers every `test/*.test.mjs`. `npm run validate` checks `data/` only and should be unaffected by this work; run it anyway before each commit.
