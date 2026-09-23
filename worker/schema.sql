-- D1 schema for the report queue.
--
-- "character" is quoted everywhere it appears: SQLite tolerates it bare, but it
-- is a reserved word in standard SQL and quoting keeps every statement
-- greppable and portable.
--
-- There is deliberately no voter column, no submitter column and no IP column.
-- Reports and votes are anonymous by design -- see the spec's "Anonymity and
-- abuse" section. Adding an identifying column here is a design change, not an
-- implementation detail.
CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  "character" TEXT NOT NULL,
  gift        TEXT NOT NULL,
  reaction    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  upvotes     INTEGER NOT NULL DEFAULT 0,
  downvotes   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status);

-- Missing-item reports: a separate queue with its own lifecycle, so nothing
-- here can reach GET /pending, the votes or the public overlay. Free text lives
-- only in `name` and `category_line`, both at most 40 characters of a small
-- character set (assets/js/item-rules.js), and none of it is public before the
-- maintainer approves it. `approved` holds the maintainer's edited values as
-- JSON; the nightly sync writes those, never the raw text.
--
-- The same rule as `reports`: no vote columns, no identifying columns.
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

CREATE INDEX IF NOT EXISTS item_reports_status_idx ON item_reports (status);
