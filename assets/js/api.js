import { WORKER_URL } from './config.js';

const TIMEOUT_MS = 5000;

// The only module that talks to the Worker. Every method resolves; none reject.
// A contribution service that is down must never stop the guide rendering.
export function createApi({
  baseUrl = WORKER_URL,
  token = null,
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const base = typeof baseUrl === 'string' ? baseUrl.replace(/\/+$/, '') : '';
  const enabled = base !== '';

  async function call(path, { method = 'GET', body, admin = false } = {}) {
    if (!enabled) {
      return { ok: false, status: 0, data: null, error: 'Submissions are not set up yet.' };
    }

    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (admin && token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, status: 0, data: null, error: 'Could not reach the submission service.' };
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        // The Worker's message is written for a player, so show it as-is when
        // there is one.
        error: data?.error ?? `The submission service returned ${response.status}.`,
      };
    }
    return { ok: true, status: response.status, data, error: null };
  }

  return {
    enabled,

    // Returns rows or an empty array. Never throws, never reports a failure:
    // a missing overlay is invisible by design.
    async fetchPending() {
      const { ok, data } = await call('/pending');
      return ok && Array.isArray(data?.pending) ? data.pending : [];
    },

    submitReport: (report) => call('/report', { method: 'POST', body: report }),
    sendVote: (vote) => call('/vote', { method: 'POST', body: vote }),

    // Admin. Used only by the review page; harmless here without a token.
    fetchReview: () => call('/review', { admin: true }),
    decide: (id, decision) => call(`/review/${encodeURIComponent(id)}`, {
      method: 'POST', body: { decision }, admin: true,
    }),
  };
}
