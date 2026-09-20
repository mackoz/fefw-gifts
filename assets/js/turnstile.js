const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function defaultLoadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('turnstile failed to load'));
    document.head.append(script);
  });
}

// Wraps Cloudflare's widget so nothing else in the site touches the global, and
// so the plumbing can be driven by a test without a network or a DOM.
//
// The widget is rendered once and reset between submissions: a Turnstile token
// is single use, so reusing one would be rejected by the Worker.
export function createTurnstile({
  siteKey,
  container,
  loadScript = defaultLoadScript,
  getGlobal = () => globalThis.turnstile,
} = {}) {
  const configured = typeof siteKey === 'string' && siteKey !== '';
  let loading = null;
  let widgetId = null;
  let token = null;

  async function ready() {
    if (!configured) throw new Error('turnstile is not configured');
    if (!loading) loading = loadScript(SCRIPT_URL);
    await loading;
    const global = getGlobal();
    if (!global) throw new Error('turnstile failed to load');
    return global;
  }

  return {
    configured,

    // Safe to call every time the dialog opens.
    async mount() {
      const global = await ready();
      if (widgetId !== null) {
        token = null;
        global.reset(widgetId);
        return;
      }
      widgetId = global.render(container, {
        sitekey: siteKey,
        callback: (value) => { token = value; },
        // A token that has expired or errored must never be submitted: the
        // Worker would reject it and the contributor would see a confusing
        // failure on a form they filled in correctly.
        'expired-callback': () => { token = null; },
        'error-callback': () => { token = null; },
      });
    },

    token: () => token,

    reset() {
      token = null;
      if (widgetId === null) return;
      try {
        getGlobal()?.reset(widgetId);
      } catch {
        // A widget that will not reset is a spent one; the next mount replaces it.
      }
    },
  };
}
