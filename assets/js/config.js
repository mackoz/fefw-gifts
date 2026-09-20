// Public configuration, committed on purpose. The Worker URL and the Turnstile
// site key are both meant to be readable in the page source; the secrets that
// matter (TURNSTILE_SECRET, ADMIN_TOKEN) live in Cloudflare and never appear
// here.
//
// Null means "submissions are not set up". The site then renders the committed
// data exactly as it did before this feature existed, which is the graceful
// degradation the spec requires -- so this file is safe to leave as it is until
// the Worker is actually deployed. See worker/README.md.
export const WORKER_URL = null;
export const TURNSTILE_SITE_KEY = null;
