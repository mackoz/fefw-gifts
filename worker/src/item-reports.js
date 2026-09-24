// The missing-item queue. Deliberately a separate module and a separate table
// from reports.js: nothing here is reachable from GET /pending, and nothing in
// reports.js reads item_reports. A test pins both halves.

export async function insertItemReport(db, { id, name, category, categoryLine, rarity, character, reaction, createdAt }) {
  await db.prepare(
    `INSERT INTO item_reports (id, name, category, category_line, rarity, "character", reaction, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).bind(id, name, category, categoryLine, rarity, character, reaction, createdAt).run();
}

// The maintainer's view. Every column except `approved`, which a pending row
// never has anyway.
export async function listItemReviews(db, limit = 200) {
  const { results } = await db.prepare(
    `SELECT id, name, category, category_line, rarity, "character" AS character,
            reaction, status, created_at
       FROM item_reports
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?`,
  ).bind(limit).all();
  return results ?? [];
}

// `AND status = 'pending'` makes every decision idempotent, as setStatus does
// for results: a second click changes nothing and reports false. `value` has
// already passed validateItemApproval; the decision itself is not stored.
export async function decideItemReport(db, id, value) {
  if (value?.decision === 'reject') {
    const { meta } = await db.prepare(
      `UPDATE item_reports SET status = 'rejected' WHERE id = ? AND status = 'pending'`,
    ).bind(id).run();
    return (meta?.changes ?? 0) > 0;
  }
  if (value?.decision === 'approve') {
    const { decision, ...approved } = value;
    const { meta } = await db.prepare(
      `UPDATE item_reports SET status = 'approved', approved = ? WHERE id = ? AND status = 'pending'`,
    ).bind(JSON.stringify(approved), id).run();
    return (meta?.changes ?? 0) > 0;
  }
  throw new Error(`unknown item decision: ${value?.decision}`);
}

// A row whose JSON will not parse is still handed over (as null) and still
// marked ingested. If it were left `approved`, it would come back and fail
// every night. The sync logs it and sets it aside instead.
function parseApproved(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The same trade as takeApproved: the rows are marked ingested in the same
// call, so scripts/ingest.mjs logs them before it does anything that can fail.
export async function takeApprovedItems(db, limit = 200) {
  const { results } = await db.prepare(
    `SELECT id, approved, "character" AS character, reaction, created_at
       FROM item_reports
      WHERE status = 'approved'
      ORDER BY created_at ASC
      LIMIT ?`,
  ).bind(limit).all();

  const rows = results ?? [];
  if (rows.length === 0) return [];

  const placeholders = rows.map(() => '?').join(', ');
  await db.prepare(
    `UPDATE item_reports SET status = 'ingested' WHERE id IN (${placeholders})`,
  ).bind(...rows.map((row) => row.id)).run();

  return rows.map((row) => ({ ...row, approved: parseApproved(row.approved) }));
}
