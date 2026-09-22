import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTurnstile } from '../worker/src/turnstile.js';

function fakeFetch(result) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify(result.body ?? {}), { status: result.status ?? 200 });
  };
  impl.calls = calls;
  return impl;
}

test('a missing secret is reported rather than treated as a pass', async () => {
  assert.deepEqual(await verifyTurnstile('tok', '', fakeFetch({ body: { success: true } })), { ok: false, reason: 'not-configured' });
});

test('a missing or oversized token never reaches Cloudflare', async () => {
  const impl = fakeFetch({ body: { success: true } });
  assert.deepEqual(await verifyTurnstile(undefined, 's', impl), { ok: false, reason: 'missing-token' });
  assert.deepEqual(await verifyTurnstile('x'.repeat(3000), 's', impl), { ok: false, reason: 'missing-token' });
  assert.equal(impl.calls.length, 0);
});

test('success true passes', async () => {
  assert.deepEqual(await verifyTurnstile('tok', 's', fakeFetch({ body: { success: true } })), { ok: true, reason: null });
});

test('success false is rejected', async () => {
  assert.deepEqual(await verifyTurnstile('tok', 's', fakeFetch({ body: { success: false } })), { ok: false, reason: 'rejected' });
});

test('a network failure or a bad status is unreachable, never a pass', async () => {
  assert.deepEqual(await verifyTurnstile('tok', 's', fakeFetch(new Error('down'))), { ok: false, reason: 'unreachable' });
  assert.deepEqual(await verifyTurnstile('tok', 's', fakeFetch({ status: 502, body: {} })), { ok: false, reason: 'unreachable' });
});

test('the verification request carries no IP address', async () => {
  const impl = fakeFetch({ body: { success: true } });
  await verifyTurnstile('tok', 'secret-value', impl);
  const sent = [...impl.calls[0].init.body].map(([key]) => key);
  assert.deepEqual(sent.sort(), ['response', 'secret']);
  assert.ok(!sent.includes('remoteip'));
});
