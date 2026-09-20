# Fire Emblem: Fortune's Weave — Gift Guide

**Date:** 2026-09-20
**Status:** Approved design

## Problem

Fire Emblem: Fortune's Weave uses a gift-giving system to raise support levels,
similar to Three Houses. Three Houses had a complete, reliable gift chart because
the Switch was hacked and the game could be datamined. Fortune's Weave runs on
Switch 2, which cannot currently be datamined, so no complete chart exists.

The information has to be gathered by players, from in-game screens and from
trial and error. This project is a static website that publishes what is known,
makes the gaps visible, and collects new findings from players.

## How gifts work in this game

This differs from Three Houses in a way that shapes the entire design.

**Gifts carry an explicit category.** Every gift item's in-game description names
exactly one category — "primarily enjoyed by book lovers", "liked by training
enthusiasts". There are roughly 68 gift items. This half of the data is
authoritative, readable directly off the item, and finishable in a single pass
through the game's shops.

**Characters list traits, incompletely.** Each of roughly 70 characters has a
profile listing Likes and Interests. Three complications:

1. Some traits map cleanly to a gift category ("books" → the book category).
2. Some traits are flavor and map to nothing ("his little sister", "August's
   tactics", "green armor"). They exist for characterisation, not for gifting.
3. **A character may like a category that their profile does not list.** The
   profile under-reports. The only way to find these is to give the gift and
   watch the support gain.

Point 3 is the central fact of this project. Matching gift categories against
profile traits gets most of the way for free, but it produces false negatives by
design. Those hidden preferences are what no published guide has, and they are
the reason a crowdsourced site is worth building at all.

**Rarity exists, effect unknown.** Gifts are marked common or rare. Rarity
plausibly affects the size of the bond gain, but this is unconfirmed. It is
recorded as a fact and tracked as an open question; it is not asserted anywhere
in the UI.

## Core design decision

The naive model is a 68 x 70 grid of gift/character pairs — 4,760 cells, each
needing its own report. It would stay sparse forever.

Instead the site models the **character to category** relation, and derives the
grid. A contributor never fills in a grid. They report one of:

- a gift's category, read off the item description
- a character's profile traits, read off the character screen
- the result of one gift given to one character

Roughly 140 facts produce the whole matrix. Tagging one gift populates every
character page that matches it, at once.

### Category provenance

Each link between a character and a category carries where it came from:

| State | Meaning |
|---|---|
| `profile` | Listed on the character's in-game profile. Bulk-enterable, free. |
| `discovered` | Not on the profile, but a gift of this category confirmed a bonus. The valuable finding. |
| `refuted` | Suspected or profile-adjacent, but testing showed no bonus. |
| `untested` | Default. Neither confirmed nor denied. Not a negative. |

Because the category vocabulary is closed, every character has a checklist of
roughly 40 categories, most starting untested. This
converts "the data is incomplete" into a list of concrete, claimable, 30-second
tasks: "nobody has tested whether Dietrich likes fishing gear."

### Pair confidence

For any (character, gift) pair the site derives one of:

- **CONFIRMED** — a player observation reports a bonus
- **LIKELY** — the gift's category is `profile` or `discovered` for this
  character, with no direct observation yet
- **NO BONUS** — a player observation reports no bonus. A real, useful negative.
- **UNTESTED** — everything else

**Absence of a category match is never rendered as a dislike.** Only an explicit
player observation can mark a pair as a dud. This rule is load-bearing: given
that profiles under-report, treating a mismatch as a negative would publish
wrong information at scale.

**CONTESTED** is a fifth state, shown when observations for the same pair
disagree. It is surfaced for review rather than silently resolved.

## Data model

Four JSON files under `data/`, all hand-editable, all validated in CI.

```
data/characters.json
  { id, name,
    traits: [ { text, category: string | null } ],   // null = flavor, marked so
                                                     // nobody re-litigates it
    categories: { "<category-id>": "profile" | "discovered" | "refuted" },
    spoiler: boolean }

data/gifts.json
  { id, name, category: "<category-id>", rarity: "common" | "rare",
    description, sources: [string] }

data/categories.json
  { id, label, aliases: [string] }                   // closed enum

data/observations.json
  { gift, character, result: "bonus" | "none",
    points: number | null,                           // support points gained, if
                                                     // the reporter could read them
    reporter, issue, date }
```

`points` is optional and objective. It exists so the rarity question can actually
be settled: if rare gifts of a category consistently report higher points than
common gifts of the same category, that answers it. A subjective "big or small"
field was rejected — it would not survive being averaged across reporters.

`observations.json` is append-only. Confidence is derived at runtime, never
stored — there is exactly one source of truth for any fact.

`categories.json` is a closed vocabulary. This is the main failure mode of the
whole design: left open, it drifts into "sweets" and "pastries" and "desserts"
all meaning the same thing, and the matching silently degrades. Containment:
the issue form renders categories as a dropdown, the CI validator rejects any
tag not in the enum, and adding a category is a separate deliberate issue type.

## Site

Vanilla HTML, CSS and JavaScript. No build step, no dependencies, no framework.
GitHub Pages deploys straight from the branch. Filtering a few thousand rows
client-side is trivial at this scale, and a contributor can edit a JSON file
without installing anything.

No character or item artwork. Names of characters and items are facts; Nintendo's
artwork is not ours to redistribute.

Three tabs and a search box:

**By Character.** Profile traits, with flavor traits greyed and labeled as such.
Gifts sorted CONFIRMED, then LIKELY, then UNTESTED. A "help wanted" line naming
the categories nobody has tested on this character.

**By Gift.** The gift's category and rarity, and every character who wants it,
in the same three tiers.

**Full Matrix.** The Serenes-style grid, for the whole picture at once. Rows are
gifts, columns are characters, cells carry the confidence state.

Global toggles: **hide untested** and **hide spoilers**.

## Contributions

GitHub Pages is static and cannot accept writes. Contributions therefore route
through GitHub itself.

Every character and gift carries a **Submit info** button that deep-links to a
pre-filled GitHub Issue Form. Dropdowns wherever a value is constrained, never
free text. Four forms:

1. **Gift tag** — gift name, category, rarity
2. **Character profile** — character, traits as shown in-game
3. **Gift result** — character, gift, whether a bonus occurred, and the support
   points gained if visible. The valuable one.
4. **New category** — only when a gift's tag is not yet in the vocabulary

A GitHub Action parses the issue, validates it against the schema, and opens a
pull request containing the JSON change. A maintainer reviews and merges; Pages
redeploys. No hosting, no cost, and every fact carries a contributor and a date.

Spam is ordinary GitHub issues and is closed like any other.

## Validation and testing

The validator is the safety net for the whole design and runs on every pull
request, including maintainer ones. It checks:

- every `gifts.json` category exists in `categories.json`
- every `characters.json` category key exists in `categories.json`
- every observation references a real character id and a real gift id
- no duplicate ids in any file
- every trait either names a valid category or is explicitly `null`

Tests use Node's built-in test runner (`node:test`). No test dependencies. Two
suites:

- the validator, against fixture files with known-good and known-bad data
- the match/confidence logic, which is pure functions over the four data files

## Seeding

Import only the bare roster — roughly 70 character names and roughly 68 gift
item names. These are facts about the game, not anyone's compiled editorial work.

Likes, interests and category tags are left empty and filled by contributors from
their own play. This keeps the dataset unambiguously ours, avoids inheriting
errors from guides that describe themselves as works in progress, and makes the
first contributions easy and high-value.

## Milestones

**Phase 1 — complete the gift tags.** All 68 gifts tagged with category and
rarity. Bounded, finishable, and it unlocks every inference at once. This is the
milestone with a visible finish line.

**Phase 2 — profile traits.** All 70 character profiles entered, flavor traits
marked as flavor.

**Phase 3 — hidden likes.** Ongoing. Player observations fill in `discovered` and
`refuted`, and settle the rarity question.

## Open questions

Tracked in the repo, not guessed at in the UI:

- Does gift rarity affect the size of the bond gain?
- Do the game's Likes and Interests fields behave differently for gifting, or are
  they equivalent for this purpose?
- Can a character's profile traits change over the course of the game?

## Out of scope

- Character artwork or item icons
- Support conversation text, recruitment requirements, or any other wiki content
- User accounts, comments, or voting
- Localisation
