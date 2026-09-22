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
  // query would make light mode render an ivory wordmark on a pale band (or,
  // for --masthead-focus, a focus ring that fails contrast in light mode).
  // Every masthead token belongs in this list -- a token left out is exactly
  // how this bug got in. (--masthead-raised and --masthead-edge were dropped
  // when the weave strip went; their only consumers went with it.)
  const MASTHEAD_TOKENS = [
    '--masthead-ground', '--masthead-ink', '--masthead-muted',
    '--masthead-rule', '--masthead-focus',
  ];
  for (const token of MASTHEAD_TOKENS) {
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

test('every page that loads the stylesheet also loads the tokens', () => {
  // style.css declares no colour literal, so a page without tokens.css renders
  // against undefined custom properties.
  for (const page of ['../index.html', '../review/index.html']) {
    const html = read(page);
    if (!html.includes('style.css')) continue;
    assert.match(html, /tokens\.css/, `${page} loads style.css without tokens.css`);
  }
});

// Comments are stripped first: an earlier version of this matched /weave/i
// against render()'s body and passed on the explanatory comment alone, so
// deleting the call it guards would have left it green.
const sourceOf = (file) => read(`../assets/js/${file}`).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');

test('the counts line is mounted and kept in step with the filters', () => {
  const app = sourceOf('app.js');
  assert.match(app, /from '\.\/views\/weave\.js'/, 'app.js must import the weave view');
  assert.match(app, /getElementById\('weave'\)/, 'app.js must mount it into #weave');
  // The counts depend on the filters, so they must re-render with the view --
  // a stale count in the masthead is worse than no count.
  const renderBody = app.slice(app.indexOf('function render('), app.indexOf('async function refreshPending'));
  assert.match(renderBody, /weaveView\.render\(/, 'render() must call weaveView.render()');
});

test('each view gets a class so the matrix can lift the column limit', () => {
  const app = sourceOf('app.js');
  const renderBody = app.slice(app.indexOf('function render('), app.indexOf('async function refreshPending'));
  assert.match(renderBody, /className = `view-\$\{route\.view\}`/, 'render() must set a per-view class on #view');
});

// The search wiring is DOM-level and app.js has no behavioural test, so this
// source guard is the only thing standing between a refactor and a silent
// performance regression: deleting the debounce(...) wrapper leaves the
// search box re-rendering the whole view -- 4,240 matrix cells on the matrix
// route -- on every keystroke, and nothing else in the suite would notice.
test('the search input is wired through debounce', () => {
  const app = sourceOf('app.js');
  assert.match(app, /import \{ debounce \} from '\.\/debounce\.js'/, 'app.js must import debounce from debounce.js');
  assert.match(
    app,
    /getElementById\('search'\)\.addEventListener\('input',\s*debounce\(/,
    'the search input listener must be wrapped in debounce(...)',
  );
});

// A stray closing brace does not fail loudly: CSS error recovery silently
// discards the NEXT rule, so one extra `}` after a block deletion cost the
// whole .chip rule -- radius, border and background -- with no error anywhere.
// Nothing else in this suite executes CSS, so this structural check is the
// only thing standing between a bad edit and a silently broken component.
test('every stylesheet is brace-balanced', () => {
  for (const file of ['tokens.css', 'style.css']) {
    // Blank the comments but keep their newlines, or the reported line number
    // lands ~150 lines early on the very file this exists to protect.
    const css = read(`../assets/css/${file}`).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    let depth = 0;
    let line = 1;
    for (const ch of css) {
      if (ch === '\n') line += 1;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        assert.ok(depth >= 0, `${file}: stray closing brace at line ~${line}`);
      }
    }
    assert.equal(depth, 0, `${file}: ${depth} unclosed block(s)`);
  }
});
