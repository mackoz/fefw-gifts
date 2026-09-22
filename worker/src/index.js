import { handle } from './router.js';

// Cloudflare's third argument is its own ExecutionContext, which this Worker
// does not use. The router's injectable dependencies are a separate thing and
// are left at their defaults here.
export default {
  fetch: (request, env) => handle(request, env),
};
