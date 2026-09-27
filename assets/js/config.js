// Public configuration, committed on purpose. The Worker URL and the Turnstile
// site key are both meant to be readable in the page source; the secrets that
// matter (TURNSTILE_SECRET, ADMIN_TOKEN) live in Cloudflare and never appear
// here.
//
// Null means "submissions are not set up". The site then renders the committed
// data exactly as it did before this feature existed, which is the graceful
// degradation the spec requires -- so this file is safe to leave as it is until
// the Worker is actually deployed. See worker/README.md.
export const WORKER_URL = 'https://fefw-gifts-api.willyumlu.workers.dev';
export const TURNSTILE_SITE_KEY = '0x4AAAAAAE9t1-uGQr2v9sjz';

// Anonymous usage counts (docs/superpowers/specs/2026-09-27-telemetry-design.md).
// The key is PostHog's write-only project token, public by design, for the
// fefw-gifts project (631311, US Cloud). Null switches telemetry off and is a
// supported state, like WORKER_URL. The host is the PostHog proxy shared with
// uma-tools; it routes by the key, not by site.
export const POSTHOG_KEY = 'phc_qp9gwfJwRJRPrqZq7bQDwEr5ARv9rPGBAi6ntwWija9T';
export const POSTHOG_HOST = 'https://t.mackoz.net';
