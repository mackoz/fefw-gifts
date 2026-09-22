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
