# Fire Emblem: Fortune's Weave — Gift Guide

A community gift guide for Fire Emblem: Fortune's Weave. Live at
**https://mackoz.github.io/fefw-gifts/**.

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

See `CONTRIBUTING.md` for how to report a gift result and how to propose
structural changes (a new category, a corrected rarity, a fixed trait).

## Sources

- Josh Broadwell, *Best gifts for each character in Fire Emblem: Fortune's
  Weave*, Polygon.
- *List of All Items*, Game8.

Full citations, including URLs and retrieval dates, are recorded in
`data/sources.json`. Guide-derived category predictions always carry their
source so they can be audited or removed wholesale.

## License

MIT. See `LICENSE`.
