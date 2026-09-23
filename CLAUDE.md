# Notes for agent sessions working on this repo

- **No dependencies, ever.** `package.json` has no `dependencies` and no
  `devDependencies`, only scripts. If a task seems to need a package, stop and
  ask instead of adding one.
- **No build step, ever.** Files are served exactly as committed. GitHub Pages
  publishes the repository as-is from `.github/workflows/ci.yml`, which uploads
  the tree without transforming it.
- **Deployment is gated on validation.** The `deploy` job declares
  `needs: test`, so it cannot start unless `npm run validate` and `npm test`
  passed on that same commit. Never remove that dependency, and never add a
  deploy path that bypasses it — it is the only thing stopping invalid data
  from reaching the published site.
- **Browser modules must stay Node-importable.** Every file under
  `assets/js/` uses ESM `export`, has no top-level DOM access, and must be
  importable directly by `node:test`. DOM access lives inside functions that
  receive their elements as arguments.
- **Absence of a match is never a dislike.** Only an actual observation may
  produce a negative result. Any code path that renders an unmatched pair as
  "dislikes" is a bug — see the spec's "Pair confidence" section.
- **Observations are anonymous and never seeded.** `data/observations.json`
  entries carry no reporter, name, email, IP, or other identifying field —
  enforced by `scripts/validate.mjs`. Every entry is a real player's in-game
  result; item-level results never come from guides.
- **Guide-derived links always carry provenance.** Any character-category
  link imported from a published guide has `state: "guide"` and a non-null
  `source` that exists in `data/sources.json`, so it can be audited or removed
  wholesale.
- **Run `npm test` and `npm run validate` before committing.** Both must pass
  cleanly (no stray warnings) before any change lands.
- **Votes never reach the published site.** `GET /pending` must not select or
  return `upvotes`/`downvotes`, and no public view may render a tally in any
  form. It is enforced in the SQL in `worker/src/reports.js`, and tests assert
  it. A visible tally would read as confirmation and manufacture confidence out
  of guesswork — see the spec's "Peer validation by voting".
- **A pending report is not a confirmation.** It may not flip a pair to
  `CONFIRMED` or `FAVORITE`, contribute a reaction, count toward a tally, or
  produce a negative verdict. Only an approved observation merged into `data/` may.
- **The Worker collects no personal data.** No name, email, IP, hashed IP,
  session id or fingerprint, in the D1 schema, the Worker or the client.
  Turnstile is called without `remoteip`. Adding any of these is a design
  change, not a fix.
- **The site must work with the Worker unavailable or unconfigured.**
  `WORKER_URL` in `assets/js/config.js` may be null, and null is a supported
  state rather than a bug: the committed data must still render from GitHub
  Pages alone, and a failed or slow `/pending` must skip the overlay silently.
  Do not assume the file's current value -- the invariant is about degrading
  gracefully, not about what is checked in today.
- **Worker modules stay Node-importable**, like the browser modules: no
  top-level `env` access and no Cloudflare-only globals at module scope, so
  `node:test` can import them directly.
- **Wrangler is never installed.** It runs through `npx --yes wrangler …`, so
  `package.json` keeps no dependencies.

See `docs/superpowers/specs/2026-09-20-fefw-gifts-design.md` for the full
design and `docs/superpowers/plans/2026-09-20-data-and-site.md` for the task
breakdown.
