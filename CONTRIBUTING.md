# Contributing

## Reporting a gift result

The quickest way is the **Report a result** button on the site. It needs no
account and no sign-up. Pick the character and the gift, say what the game
showed you, and submit.

Your report is anonymous. Nothing about you is stored — not a name, not an
email, not an IP address, not a session identifier. There is no credit
mechanism, by choice.

A report appears on the site straight away marked **awaiting review**, which is
not the same as confirmed: it contributes no reaction and settles nothing until
a maintainer approves it and it is merged into `data/observations.json`.

While it is waiting, other visitors can say whether it matches what they have
seen. Those responses are private: they help the maintainer decide what to check
first and never change anything the site shows.

If the site's form is unavailable, the GitHub issue form below still works.

**Report one now:** open a
[gift result issue](https://github.com/mackoz/fefw-gifts/issues/new?template=report-result.yml).
The form asks for the character, the item, and the reaction the game showed,
plus any notes worth keeping if you have them. Please don't add your name or
anything else identifying — reports are anonymous by design, and the
validator rejects identifying fields in `data/observations.json`.

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
