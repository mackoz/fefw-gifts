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
  enforced by `scripts/validate.mjs`. The file ships empty; item-level results
  come only from real player reports, never from guides.
- **Guide-derived links always carry provenance.** Any character-category
  link imported from a published guide has `state: "guide"` and a non-null
  `source` that exists in `data/sources.json`, so it can be audited or removed
  wholesale.
- **Run `npm test` and `npm run validate` before committing.** Both must pass
  cleanly (no stray warnings) before any change lands.

See `docs/superpowers/specs/2026-09-20-fefw-gifts-design.md` for the full
design and `docs/superpowers/plans/2026-09-20-data-and-site.md` for the task
breakdown.
