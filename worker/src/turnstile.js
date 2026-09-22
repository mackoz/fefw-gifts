const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Tokens are short-lived and single use. Anything longer than this is not a
// real token, so it is rejected without spending a request on it.
const MAX_TOKEN_LENGTH = 2048;

// `remoteip` is supported by Turnstile and deliberately not sent: the spec
// forbids collecting or transmitting visitor IP addresses, including for
// verification. Do not add it.
export async function verifyTurnstile(token, secret, fetchImpl = (...args) => globalThis.fetch(...args)) {
  if (typeof secret !== 'string' || secret === '') return { ok: false, reason: 'not-configured' };
  if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'missing-token' };
  }

  let response;
  try {
    response = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token }),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  // An unreachable or misbehaving verifier is never treated as a pass: the
  // failure mode of a broken check must be "nobody can submit", not "everybody
  // can".
  if (!response.ok) return { ok: false, reason: 'unreachable' };

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  return body?.success === true ? { ok: true, reason: null } : { ok: false, reason: 'rejected' };
}
