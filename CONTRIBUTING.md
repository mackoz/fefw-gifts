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

## Reporting a missing item

The item list is put together from guides and our own play, and it is not
complete. If you have an item the site does not list, report it from the site.
You can choose **My item isn’t listed…** at the bottom of the report form's
gift list, or search for it on the Gifts tab and press
**Report ‘…’ as a missing item**.

The form asks for:

- the item's name, exactly as the game shows it
- its "Primarily enjoyed by …" line (type it if it isn't in our list)
- its rarity, if you know it
- optionally, who you gave it to and how they reacted

It is anonymous, like a result report: nothing about you is stored. Unlike a
result report, **nothing you type appears on the site until the maintainer has
read it**. The maintainer corrects the name and category if needed and approves
it, and it reaches `data/gifts.json` in the next nightly sync's pull request.

## Structural changes

Anything that changes the shape or vocabulary of the data goes through a plain
GitHub issue or pull request — except a missing item, which is reported from
the site itself, the same as a result:

- **Adding an item the site does not list.** Use the site's missing-item form
  (above) rather than an issue. It needs no account.
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
