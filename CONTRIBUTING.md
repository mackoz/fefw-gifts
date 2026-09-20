# Contributing

## Reporting a gift result

**Report one now:** open a
[gift result issue](https://github.com/mackoz/fefw-gifts/issues/new?template=report-result.yml).
The form asks for the character, the item, and the reaction the game showed,
plus the exact support points and any notes if you have them. Please don't add
your name or anything else identifying — reports are anonymous by design, and
the validator rejects identifying fields in `data/observations.json`.

The in-page "Report a result" form is the intended way to submit a result once
it ships. Until then, the issue form above is the route, and a maintainer
transcribes each report into `data/observations.json`.

When the in-page form is live: pick the character and gift item (both are often
pre-filled from the page you reported from), choose the reaction tier the
game displayed, and optionally enter the exact support points gained. No
account or personal information will be requested or stored.

## Structural changes

Anything that changes the shape or vocabulary of the data — rather than
reporting a single gift result — goes through a plain GitHub issue or pull
request:

- **Tagging an item with a category.** Use the
  [category issue form](https://github.com/mackoz/fefw-gifts/issues/new?template=add-category.yml).
  Its dropdown is the whole category list on purpose: free-typed names drift,
  and a drifted name silently breaks every prediction that depends on it.
- **Adding a *new* category.** Categories are a closed, deliberately small
  vocabulary (see `data/categories.json`). Open a blank issue proposing the new
  category id, label, and any known in-game descriptor phrase, with the
  reasoning for why an existing category or alias doesn't already cover it.
- **Correcting a gift's rarity or category.** Open an issue or PR citing where
  you saw it in-game (rarity is an icon distinction that can't be guessed from
  a name).
- **Fixing a character's traits or category links.** Open an issue or PR with
  the correction and, where possible, whether it comes from the in-game
  profile or a published guide.

For any PR, run `npm test` and `npm run validate` locally first — both must
pass before review.
