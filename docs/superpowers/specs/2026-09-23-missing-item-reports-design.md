# Missing-item reports — design

**Date:** 2026-09-23
**Status:** Approved in conversation; awaiting written-spec review
**Extends:** `2026-09-20-fefw-gifts-design.md` ("Contributions", "Worker endpoints",
"Review page", "Anonymity and abuse", "Structural changes")

## Problem

The gift list is not datamined — the Switch 2 cannot be — so `data/gifts.json` is
assembled from guides and the maintainer's own play, and it is known to be
incomplete (the maintainer found eight unlisted items in one session). Today a
player holding an unlisted item cannot report it at all: the report form's gift
field is a closed `<select>`, the Worker has no free-text field, and the only other
path is a GitHub issue, which needs an account.

This adds a second kind of anonymous report: **"this item is missing"**, optionally
with the result of giving it to someone. It travels its own pipeline, parallel to
result reports, so none of the existing guarantees about `/pending`, votes or the
public overlay are touched.

## Decisions (from the design conversation)

1. A report carries **item facts plus an optional result**: name, category (via the
   in-game "Primarily enjoyed by …" line), rarity, and optionally a character and
   reaction.
2. If the player's in-game line is not in our list, they pick **"Not listed — type
   it"** and type the line (≤ 40 chars). New categories arrive this way.
3. Item reports are **hidden until approved**. Nothing typed by a player is ever
   shown on the public site before the maintainer has read it.
4. The maintainer **fixes names and categories on the review page** before
   approving; the sync writes exactly what was approved.
5. **Approach: a separate pipeline** — new D1 table, new endpoints — rather than
   widening `reports` or using a GitHub issue form.

This supersedes the base spec's "Structural changes" line that new items "are not
worth a web form" — for items only. Category edits, rarity corrections to existing
items, and trait fixes still go through the issue forms.

## Shared rules

Used identically by the form, the Worker, the review page and the sync. They live
in one Node-importable module, `assets/js/item-rules.js` (the Worker imports it by
relative path, as it already can import browser modules — confirm during planning;
if it cannot, the Worker keeps a copy and a test asserts the two stay identical).

- **Text fields** (`name`, `categoryLine`, `newCategory.label`,
  `newCategory.inGameDescriptor`): trimmed, inner whitespace collapsed to one space,
  then must match `^[A-Za-z0-9 '\-’“”.]{2,40}$`.
- **Ids** (`category`, `character`, `newCategory.id`, `giftId`): the existing
  `ID_PATTERN` `^[a-z0-9][a-z0-9-]{0,63}$`.
- **Rarity:** `common | uncommon | rare | null` (`null` = not sure / unknown).
- **Reaction:** the existing five tiers.
- **`normalizeName(s)`** — for duplicate detection and grouping: lowercase, `’`→`'`,
  then drop every character that is not `[a-z0-9]`. "Horse-Grooming Kit" and
  "horse grooming kit" normalise equal.
- **`slugify(s)`** — for new gift ids: lowercase, drop `'’“”"`, replace each run of
  non-`[a-z0-9]` with `-`, trim leading/trailing `-`. "Special “Medicine”" →
  `special-medicine`. (Matches the slugs already in `gifts.json`.)
- **`suggestName(s)`** — the review page's pre-fill: every word capitalised
  (the project's naming rule), editable because in-game names are the exception
  ("History of a Master").

## 1. The player's form

**Entry points** (both only when `WORKER_URL` is configured; with it null the site
is unchanged):
- The report dialog's gift `<select>` gains a last option **"My item isn't
  listed…"**. Choosing it switches the same dialog into missing-item mode.
- On the Gifts tab, a search with no matches offers **"Report ‘<query>’ as a missing
  item"**, opening the dialog in that mode with the name pre-filled.

**Fields**
| Field | Rule |
|---|---|
| Item name | required; text rule. Checked live against `gifts.json` with `normalizeName`; a match blocks sending with "That's already listed as *X*" and a link to that gift. |
| In-game line | required; a `<select>` of our categories shown by their `inGameDescriptor` (fallback: label), sorted, ending with **"Not listed — type it"**, which reveals a text input (text rule). Exactly one of `category` / `categoryLine` is sent. |
| Rarity | required choice: common / uncommon / rare / **not sure** (pre-selected → `null`). |
| Gave it to / They… | optional pair. Character list is `reportCharacterOptions` (giftable, respects Hide spoilers). Reaction uses the five in-game prompts. Both or neither — one alone is an error. |
| "I'm human" | the existing Turnstile wrapper, reset after every attempt. |

Copy adds: "Only the site maintainer sees this until it's approved." The existing
"nothing about you is stored" statement applies unchanged.

**Payload:** `{ name, category|null, categoryLine|null, rarity|null,
character|null, reaction|null, turnstileToken }`.
**Success:** "Thanks — it'll appear on the site once it's reviewed." Nothing public
changes.

## 2. Worker and database

**Schema** (`worker/schema.sql`, appended; `CREATE … IF NOT EXISTS`, so re-running
the file is safe and leaves `reports` untouched):

```sql
CREATE TABLE IF NOT EXISTS item_reports (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT,
  category_line TEXT,
  rarity        TEXT,
  "character"   TEXT,
  reaction      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|ingested
  approved      TEXT,                            -- JSON: the values the maintainer approved
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS item_reports_status_idx ON item_reports(status);
```

No vote columns, no identifying columns — the same rule as `reports`.

**Endpoints** (added to `ROUTES`; existing routes unchanged):

| Route | Auth | Behaviour |
|---|---|---|
| `POST /item-report` | Turnstile via `guard()` (checked before the body) | Validates with the shared rules (exactly one of category/categoryLine; character and reaction both or neither). Inserts `pending`. `201 {id, status:'pending'}` — never echoes text. Invalid → 400. |
| `GET /item-review` | admin | Pending item reports, oldest first, LIMIT 200, all columns except `approved`. `no-store`. |
| `POST /item-review/:id` | admin | `{decision:'reject'}` or `{decision:'approve', name, giftId?, category?, newCategory?, rarity, includeResult}`. At most one of `giftId` / `category` / `newCategory`; all may be absent (category unknown). Validated with the shared rules; stored as JSON in `approved`; `UPDATE … WHERE id=? AND status='pending'` (idempotent; a second decision → 404). |
| `POST /ingest-items` | admin | Selects `approved` rows (LIMIT 200) and marks them `ingested` in the same call, as `takeApproved` does. Returns `{items:[{id, approved, character, reaction, created_at}]}`. `no-store`. |

Route names avoid `/review/items` (would be captured by `/review/:id`) and a new
field on `/ingest` (the deployed sync script would mark item rows ingested and drop
them).

**Unchanged guarantees:** `/pending` never touches `item_reports`. No IP, no
`remoteip`, no identifier. The 8 KB body cap applies. Turnstile fails closed.

## 3. Review page

`review/index.html` gains a section **"Missing items (N)"** under the results queue,
same token, usable on a phone. It fetches `/item-review` plus the site's own
`data/gifts.json` and `data/categories.json`.

- **Grouping:** reports with equal `normalizeName(name)` form one card: "reported N
  times", each report listed with its category or typed line, rarity, optional
  result, and age.
- **Edit form per card**, pre-filled:
  - Name — `suggestName` of the most frequent spelling.
  - Category — our list, pre-selected when every report on the card agrees;
    or **"Create new category…"** revealing Label (pre-filled `suggestName` of the
    typed line), Id (derived with `slugify`, editable) and In-game line (pre-filled
    with the typed line). A clashing id is blocked.
  - Rarity — the most frequent non-null value, else unknown.
  - Per report with a result: **"include result"**, ticked by default.
- **Existing-gift check:** if the edited name normalises equal to a gift already
  listed, the card shows "Already listed as *X* — approving adds only the results",
  and approval sends `giftId` instead of creating a gift.
- **Actions:** **Approve** sends one `POST /item-review/:id` per report on the card
  with the same edited values and that report's own `includeResult`. **Reject card**
  rejects all; a per-report **Reject** removes one. Results queue and votes are
  untouched; item reports have no votes.

## 4. Nightly sync

`scripts/ingest.mjs` keeps calling `/ingest` and additionally calls
`/ingest-items`. A 404 from `/ingest-items` (Worker not yet redeployed) is a
`::warning`, not a failure, so result syncing never depends on this feature.

Both batches are logged raw **before** anything can fail (they are already marked
ingested). Then, in memory:

1. **New categories** — for each `approved.newCategory` not already present by id:
   append `{id, label, inGameDescriptor, aliases: []}` to `categories.json`.
2. **New gifts** — for each approved item without `giftId`: id `slugify(name)`;
   if that id already exists, the item is treated as that existing gift (no
   duplicate); otherwise append `{id, name, category: newCategory?.id ?? category ?? null,
   rarity, description: "", sources: []}`. Several reports of one item in a batch
   yield one gift.
3. **Results** — for each item report with `includeResult` and a character and
   reaction: an observation `{id: <report id>, gift, character, reaction,
   date: created_at[0..10]}` via the existing `toObservation`, merged with the
   night's result reports through `mergeObservations` (dedupe by id).

The whole merged dataset is validated with `validate()`; any error writes nothing
and exits 1. Only approved values reach `data/`: the player's raw name and typed
line never do. `sources: []` — anonymous player finds cite no source, as with the
maintainer's own finds.

**Workflow** (`sync-reports.yml`): the job runs if either batch added anything,
commits whichever of `gifts.json` / `categories.json` / `observations.json` changed,
and the PR body lists every new item and category for the maintainer to check.
Nothing auto-merges.

## Anonymity and abuse

- Free text is new to this project. It is confined to four ≤ 40-char fields with a
  restrictive character set, is never public before approval, and only the
  maintainer's edited values ever reach the repository.
- Turnstile on submission; the maintainer's review is the real backstop, as for
  results. No rate limiting beyond Turnstile (same as today).
- No voting on item reports (they are never public, so there is nothing to vote on).

## Deployment

Additive and backward-compatible; order matters. From the PR branch, **before
merging**:

```sh
npx --yes wrangler d1 execute fefw-gifts --remote --file worker/schema.sql --config worker/wrangler.toml
npm run worker:deploy
```

No Cloudflare dashboard change: the Turnstile widget already covers
`mackoz.github.io`, and no secret changes. Recorded in `worker/README.md`.

## Testing

Mirrors the existing suites (`node:test`, fake D1, injected deps):
- shared rules: text rule, `normalizeName`, `slugify`, `suggestName`, plus two
  real-data tests: every gift in `gifts.json` passes the text rule, and every gift's
  id equals `slugify(name)` (all 110 do today, checked while writing this spec).
- Worker: Turnstile before body; each validation branch; INSERT params exact; the
  new admin routes refuse missing/wrong tokens and join the "every admin route"
  test; approve/reject idempotency; `/ingest-items` marks rows; `/pending` SQL still
  never mentions `item_reports`; no `remoteip`.
- Form: payload building and every error; the duplicate check; mode switching;
  behavioural test with the stub DOM pattern from `test/report-form.test.mjs`.
- Review: grouping, pre-fill (most frequent spelling/rarity), existing-gift
  detection, clashing new-category id.
- Ingest: conversion order (category → gift → observation), dedupe within a batch,
  existing-gift path, `includeResult: false`, 404 tolerance, validation failure
  writes nothing, raw text never reaches output — plus an end-to-end run of the real
  `scripts/ingest.mjs` against a stub `node:http` Worker on a scratch copy of `data/`.
- Mutation checks on each guard, as for every change in this repo.

## Out of scope

Public display or voting of pending items; editing existing items' facts through the
site; descriptions (free-text in-game description); images; rate limiting beyond
Turnstile; any change to result reports, `/pending`, votes or the overlay.
