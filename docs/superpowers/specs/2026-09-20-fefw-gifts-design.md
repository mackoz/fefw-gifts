# Fire Emblem: Fortune's Weave — Gift Guide

**Date:** 2026-09-20
**Status:** Approved design (rev 2)

## Problem

Fire Emblem: Fortune's Weave uses gift-giving to raise support levels, similar to
Three Houses. Three Houses had a complete, reliable gift chart because the Switch
was hacked and the game could be datamined. Fortune's Weave runs on Switch 2,
which cannot currently be datamined, so no complete chart exists.

Published guides stop at the **category** level — "Dietrich likes sweets." No
guide confirms results for **individual gift items**, because doing so requires
many players each spending an in-game week and a lot of gold.

That gap is this project. The site publishes category-level predictions so it is
useful immediately, and collects item-level confirmations so it becomes something
no existing guide is.

## How gifts work in this game

**Gifts carry exactly one category.** Every gift item's description names one
category. Roughly 68 gift items exist. Readable directly off the item.

**The category vocabulary is small and already known.** Roughly twenty
categories: fashion, beauty, flowers, cooking, fermented drinks, beverages,
coffee, training, weapons, military, horses, books, board games, vegetables,
crafting, fishing, archery, plus a few with only one or two items (agriculture,
travel, spicy foods). Categories surface in item text as descriptor phrases —
"for those who appreciate beauty", "for people who love to cook".

**Gifts have three rarities:** common, uncommon, rare, distinguished in-game by
icon shading and a sparkle marker.

**Rarity is a character preference, not a gift multiplier.** Some characters
prefer uncommon or rare items regardless of category. This is a trait of the
character, not a property of the gift.

**Reactions come in five objective tiers.** The game displays a banner and the
support points gained:

| Tier | Banner | Effect |
|---|---|---|
| `none` | they don't like it | no support gain |
| `slight` | they kind of like it | small gain |
| `liked` | they liked it | moderate gain |
| `loved` | they really liked it | big gain |
| `favorite` | they really liked it, two yellow arrows | **double points** |

Because the game names the tier, reporting it is objective rather than a
judgment call. Reporters can also read the exact points gained.

**Every character has at least one favorite item.** The double-points tier is
reserved for it. No published guide has found them all — rare gifts are
expensive and the search space is large.

**Category matching has item-level exceptions.** Nydine likes horse grooming kits
but not mane ornaments: she rides orniuses, which have no manes. Exceptions are
item-specific and usually have an in-game reason worth recording.

**Gifts are limited to one per character per week.** Planning matters, and this
is why data collection is inherently slow.

**Character profiles under-report.** Profiles list Likes and Interests. Some
traits map to a category ("books"), some are pure flavor and map to nothing
("his little sister", "looks of fear"). And a character can like a category their
profile never lists. Profile absence is not evidence of dislike.

**Not every character is giftable.** Roughly 52 of the roughly 70 characters can
receive gifts. At least one has an act-specific restriction: in Act 1, Bertrand
can only be given gifts as Cai.

## Core design decision

The unit of confirmation is the **(character, gift item) pair** — roughly 52 x 68
cells. Confirming those one at a time from scratch would never finish.

So the site does both halves:

1. **Predict** every cell from the character-to-category map. Roughly 140 facts
   (each gift's category, each character's category preferences) fill most of the
   grid for free. This makes the site useful on day one.
2. **Confirm** cells individually from player reports. Every predicted cell
   carries a visible "predicted, not confirmed" state and a one-click way to
   report having tried it.

A contributor is never asked to fill in a grid. They are asked to confirm or
refute one cell that already has a prediction in it — which is a far smaller ask
than an empty form, and produces exactly the data no other guide has.

### Category link provenance

Each link between a character and a category records where it came from:

| State | Meaning |
|---|---|
| `guide` | Taken from a published guide. **Unconfirmed.** Seeds predictions, never asserted as fact. |
| `profile` | Listed on the character's in-game profile. |
| `discovered` | Not on the profile, but confirmed by observation. |
| `refuted` | Tested, no bonus. |
| `untested` | Default. Not a negative. |

### Pair confidence

For any (character, gift item) pair the site derives one of:

- **FAVORITE** — an observation reported the double-points tier
- **CONFIRMED** — an observation exists for this exact item, showing its tier and
  points
- **EXCEPTION** — an observation contradicts the prediction, with a `reason` where
  one is known
- **PREDICTED** — no observation for this item, but a character-to-category link
  exists. Shaded by that link's provenance, so a `guide` prediction reads as
  weaker than a `profile` one.
- **CONTESTED** — observations for this pair disagree. Surfaced for review.
- **UNTESTED** — no link, no observation

**Absence of a category match is never rendered as a dislike.** Only an
observation can mark a pair as a dud. Given that profiles under-report and seeded
guide data is unconfirmed, treating a mismatch as a negative would publish wrong
information at scale.

## Data model

Five JSON files under `data/`, hand-editable, validated in CI.

```
data/characters.json
  { id, name,
    giftable: boolean,
    spoiler: boolean,
    traits: [ { text, category: string | null } ],   // null = flavor, marked so
                                                     // nobody re-litigates it
    categories: { "<category-id>": { state: "guide" | "profile"
                                          | "discovered" | "refuted",
                                     source: "<source-id>" | null } },
    rarityPreference: "any" | "uncommon-plus" | "rare" | null,
    favorites: [ "<gift-id>" ],                      // double-points items
    notes: string | null }                           // e.g. Bertrand's Act 1 rule

data/gifts.json
  { id, name,
    category: "<category-id>" | null,                // null = not yet recorded
    rarity: "common" | "uncommon" | "rare" | null,   // null = not yet recorded
    description, sources: [ "<source-id>" ] }

data/categories.json
  { id, label, inGameDescriptor, aliases: [string] }  // closed enum

data/observations.json
  { id, gift, character,
    reaction: "none" | "slight" | "liked" | "loved" | "favorite",
    points: number | null,
    date }                                           // no reporter: anonymous

data/sources.json
  { id, title, author, publisher, url, retrieved }
```

`observations.json` is append-only. Confidence is derived at runtime, never
stored — one source of truth per fact.

`categories.json` is a closed vocabulary and can ship nearly complete, since the
category list is already known. This is the design's main failure mode: left
open, it drifts into "sweets" and "pastries" and "desserts" all meaning the same
thing and matching silently degrades. Containment: the issue form renders
categories as a dropdown, CI rejects any tag not in the enum, and adding a
category is a separate deliberate issue type.

## Site

Vanilla HTML, CSS and JavaScript. No build step, no dependencies, no framework.
GitHub Pages deploys straight from the branch. Filtering a few thousand rows
client-side is trivial at this scale, and a contributor can edit a JSON file
without installing anything.

No character or item artwork. Names of characters and items are facts; Nintendo's
artwork is not ours to redistribute.

Four views, one search box:

**By Character.** Profile traits, with flavor traits greyed and labeled as such.
Rarity preference if known. Gift items sorted FAVORITE, CONFIRMED, PREDICTED,
UNTESTED, each showing its state and, where confirmed, its reaction tier and
points. A "help wanted" line naming the untested items in categories they like.

**By Gift.** The item's category and rarity, and every character, in the same
tiers.

**Full Matrix.** The Serenes-style grid: gift items as rows, characters as
columns, cells carrying the confidence state.

**Favorites Hunt.** A dedicated page listing every character whose double-points
favorite is still unknown, with the untested items in their preferred categories
as suggestions. This is the site's headline gap and the clearest place it beats
every existing guide.

Global toggles: **hide untested**, **hide unconfirmed predictions**, and
**hide spoilers**.

Every prediction is visibly a prediction, and carries its source.

## Contributions

The audience is Fire Emblem players, not developers, and the unit of contribution
is a single item-level result. Requiring a GitHub account would filter out most
of the people who have the data. So reporting happens in a form on the site
itself, with no account and no signup.

### Submission path

A **Report a result** button on every character, gift and matrix cell opens an
in-page form, pre-filled with the character and item. The contributor picks a
reaction tier, optionally enters the points gained, and submits.

The submission posts to a small Cloudflare Worker backed by D1. The row is stored
with status `pending`. The site fetches pending rows and overlays them on the
canonical data, so the contributor sees their report appear immediately, clearly
labeled **pending review**.

A maintainer later approves pending rows. A sync script pulls approved rows,
appends them to `data/observations.json`, marks them ingested, and opens a pull
request. On merge they become canonical and drop out of the pending overlay.

### Worker endpoints

```
POST /submit    Turnstile-verified, rate-limited. Inserts a pending row.
GET  /pending   Returns pending rows for the site overlay. Cached briefly.
POST /ingest    Admin-token gated. Returns approved rows and marks them ingested.
```

Secrets (`TURNSTILE_SECRET`, `ADMIN_TOKEN`) live in Worker secrets and GitHub
Actions secrets. CORS is restricted to the Pages origin.

### Graceful degradation

**The site must work completely with the Worker unavailable.** Canonical data
ships in the repo and renders from GitHub Pages alone. If `/pending` fails or
times out, the overlay is skipped and the form reports that submissions are
temporarily unavailable. Nothing else changes. The repo remains the source of
truth; the Worker is a convenience layer over it.

### Anonymity and abuse

**No personal data is collected.** Submissions carry no name, no email and no
stored identifier — only the report itself and a timestamp. There is therefore no
credit mechanism, by choice.

Without identities, repeated submissions cannot be attributed, so agreement
counts are weak evidence on their own. Three mitigations, in order of preference:

1. Cloudflare Turnstile on submit, which stops automated junk without a puzzle
2. Edge rate limiting by IP, which stores nothing
3. Maintainer review before anything becomes canonical, which is the real
   backstop

Fingerprinting contributors is deliberately out of scope. If sock-puppeting
becomes a real problem, a daily-rotated salted hash used only for same-source
dedupe can be added — never displayed, never committed to the repo.

### Structural changes

Adding a category, correcting a gift's rarity, or fixing a character's traits are
rare, structural edits rather than volume data. These go through a plain GitHub
issue or a pull request, documented in `CONTRIBUTING.md`. They are not worth a
web form.

## Validation and testing

The validator is the safety net for the whole design and runs on every pull
request, including maintainer ones. It checks:

- every gift's category exists in `categories.json`
- every character category key exists in `categories.json`
- every observation references a real character id and a real gift id
- every `favorites` entry references a real gift id
- every `source` reference exists in `sources.json`
- every `guide`-state category link has a non-null source
- no duplicate ids in any file
- every trait either names a valid category or is explicitly `null`
- observations are only recorded against giftable characters
- observations carry no reporter or other identifying field

Tests use Node's built-in test runner (`node:test`). No test dependencies.

- the validator, against fixtures with known-good and known-bad data
- the match and confidence logic, which is pure functions over the data files
- the pending-overlay merge, including the case where the Worker is unreachable

## Seeding and attribution

Seed in three layers, each with its provenance recorded:

1. **Roster and items** — character names, gift item names, categories, rarities.
   Facts about the game.
2. **Category vocabulary** — the roughly twenty known categories. The game's own
   structure.
3. **Character category preferences** — imported from published guides with state
   `guide` and a `sources.json` entry. **Unconfirmed.** These generate
   predictions and are never displayed as established fact.

Prior art is credited in `sources.json` and in a Sources section of the README,
with title, author, publisher and retrieval date. Because every seeded link
carries its source id, guide-derived data can be audited or removed wholesale.

Item-level results are **never** seeded. They are the thing being gathered, and
every one of them comes from a real player report.

## Milestones

**Phase 1 — predictions live.** All gift categories and rarities recorded,
guide-derived character preferences seeded. The full grid renders as predictions.
Bounded and finishable.

**Phase 1.5 — Favorites Hunt.** The double-points favorite found for every
giftable character. Roughly 52 slots, most open, each individually claimable. The
site's headline gap.

**Phase 2 — profile traits.** All character profiles entered from the game,
upgrading `guide` links to `profile` or `refuted` and marking flavor traits.

**Phase 3 — item-level confirmation.** Ongoing. Observations convert PREDICTED
cells to CONFIRMED, surface EXCEPTIONs, and discover off-profile likes.

## Open questions

Tracked in the repo, not guessed at in the UI:

- Which characters have a rarity preference, and does it gate reactions entirely
  or only reduce them?
- Do Likes and Interests behave differently for gifting, or are they equivalent?
- Can a character's profile traits change over the course of the game?
- Do any other characters have act-gated gifting restrictions like Bertrand's?
- Can a character have more than one double-points favorite?

## Out of scope

- Character artwork or item icons
- Support conversation text, recruitment requirements, other wiki content
- User accounts, comments, or voting
- Contributor credit or identity of any kind
- Localisation
