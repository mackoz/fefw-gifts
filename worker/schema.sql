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
