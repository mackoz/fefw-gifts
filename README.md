# Fire Emblem: Fortune's Weave — Gift Guide

A community gift guide for Fire Emblem: Fortune's Weave. Deploys to
**https://mackoz.github.io/fefw-gifts/** once GitHub Pages is enabled for this
repository, with **Source** set to **GitHub Actions** (not "Deploy from a
branch").

Publishing runs from `.github/workflows/ci.yml` on every push to `master`. Its
`deploy` job declares `needs: test`, so the site cannot be published unless
`npm run validate` and `npm test` passed on that same commit — invalid data
cannot reach the live site.

## Why this exists

Fortune's Weave uses gift-giving to raise support levels. Published guides stop
at the category level — "Dietrich likes sweets." None of them confirm results
for individual gift items, because that takes many players each spending an
in-game week and real gold to test one item on one character.

This site does both:

- **Predicted** — derived from a character's known category preferences. A
  guess, not a confirmed fact, and always shown as one.
- **Confirmed** — backed by an actual anonymous player report of giving that
  exact item to that exact character.

Predictions seed the site so it's useful immediately. Confirmations are the
thing no other guide has, and they only come from players reporting results.

**Absence of a match is never treated as a dislike.** A character with no
known link to a gift's category is simply untested, not disliked. Only an
observed reaction can mark a pair negative.

## Data layout

Everything lives under `data/` as hand-edited, validated JSON:

- `data/categories.json` — the closed vocabulary of gift categories (fashion,
  cooking, fermented drinks, etc.). This list does not grow casually; adding a
  category is a deliberate, separate change.
- `data/gifts.json` — every gift item: name, category, rarity, description,
  sources.
- `data/characters.json` — the character roster: traits, category links (with
  provenance — guide, profile, discovered, or refuted), rarity preference,
  known favorites.
- `data/observations.json` — anonymous player reports. Append-only, ships
  empty, and carries no reporter, name, email, IP, or other identifying field.
  This is enforced by the validator, not just a convention.
- `data/sources.json` — the published guides and references this project
  credits and cites.

## Running locally

No dependencies, no build step. Requires Node 22+.

```bash
npm test        # runs the test suite (node:test)
npm run validate  # validates data/ against the schema and cross-references
```

Both must pass before any change is merged.

## Contributing

The in-site **Report a result** form is the primary way to submit a gift
result; GitHub issues are for structural changes (a new category, a corrected
rarity, a fixed trait) and as a fallback when the form is unavailable. See
`CONTRIBUTING.md` for the details.

### How a report becomes data

1. A player submits a result on the site. It is stored as **pending** in a
   Cloudflare Worker, never in this repository.
2. The site shows it as *awaiting review*. It is not a confirmation: it
   contributes no points and produces no verdict.
3. Other visitors can privately agree or disagree, which orders the
   maintainer's queue and nothing else.
4. The maintainer approves it on a private review page.
5. A nightly job opens a pull request adding it to `data/observations.json`.
6. On merge it becomes canonical and drops out of the pending overlay.

The repository is the source of truth at every step. The Worker is a
convenience layer over it, and the site works completely without it.

## Sources

- Josh Broadwell, *Best gifts for each character in Fire Emblem: Fortune's
  Weave*, Polygon (retrieved 2026-09-20).
- *List of All Items*, Game8 (retrieved 2026-09-20).

Full citations, including URLs and retrieval dates, are recorded in
`data/sources.json`. Guide-derived category predictions always carry their
source so they can be audited or removed wholesale.

## License

MIT. See `LICENSE`.
