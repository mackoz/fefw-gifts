# Contributing

## Reporting a gift result

The in-page "Report a result" form is the intended way to submit a result
once it ships. Until then, results can't yet be submitted through the site.

When the form is live: pick the character and gift item (both are often
pre-filled from the page you reported from), choose the reaction tier the
game displayed, and optionally enter the exact support points gained. No
account or personal information is requested or stored — reports are
anonymous by design.

## Structural changes

Anything that changes the shape or vocabulary of the data — rather than
reporting a single gift result — goes through a plain GitHub issue or pull
request:

- **Adding a category.** Categories are a closed, deliberately small
  vocabulary (see `data/categories.json`). Open an issue proposing the new
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
