import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigins, corsHeaders, json } from '../worker/src/http.js';
import { handle, exact, oneParam } from '../worker/src/router.js';

const ENV = { ALLOWED_ORIGINS: 'https://mackoz.github.io, https://example.test' };

const req = (method, url, headers = {}) => new Request(url, { method, headers });

test('allowedOrigins splits and trims the configured list', () => {
  assert.deepEqual(allowedOrigins(ENV), ['https://mackoz.github.io', 'https://example.test']);
  assert.deepEqual(allowedOrigins({}), []);
});

test('an allowed origin is echoed back', () => {
  const headers = corsHeaders(req('GET', 'https://api.test/pending', { Origin: 'https://mackoz.github.io' }), ENV);
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://mackoz.github.io');
  assert.equal(headers.Vary, 'Origin');
});

test('an unknown origin gets no allow header but still varies on Origin', () => {
  const headers = corsHeaders(req('GET', 'https://api.test/pending', { Origin: 'https://evil.test' }), ENV);
  assert.equal(headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(headers.Vary, 'Origin');
});

test('preflight is answered without reaching a handler', async () => {
  const res = await handle(req('OPTIONS', 'https://api.test/report', { Origin: 'https://mackoz.github.io' }), ENV, undefined, []);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://mackoz.github.io');
});

test('an unknown path is a JSON 404', async () => {
  const res = await handle(req('GET', 'https://api.test/nope'), ENV, undefined, []);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not found' });
});

test('a known path with the wrong method is a 405 that names the allowed ones', async () => {
  const routes = [{ method: 'POST', match: exact('/report'), handler: () => json({ ok: true }) }];
  const res = await handle(req('GET', 'https://api.test/report'), ENV, undefined, routes);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'POST');
});

test('a handler receives the path parameters it matched', async () => {
  const routes = [{
    method: 'POST',
    match: oneParam('/review', 'id'),
    handler: (request, env, deps, params) => json({ id: params.id }),
  }];
  const res = await handle(req('POST', 'https://api.test/review/abc-123'), ENV, undefined, routes);
  assert.deepEqual(await res.json(), { id: 'abc-123' });
});

test('oneParam rejects a missing or nested id', () => {
  const match = oneParam('/review', 'id');
  assert.equal(match('/review'), null);
  assert.equal(match('/review/'), null);
  assert.equal(match('/review/a/b'), null);
});

test('a thrown handler becomes a 500 that leaks nothing', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const routes = [{ method: 'GET', match: exact('/boom'), handler: () => { throw new Error('secret detail'); } }];
    const res = await handle(req('GET', 'https://api.test/boom'), ENV, undefined, routes);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'internal error' });
  } finally {
    console.error = original;
  }
});
