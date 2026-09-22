export const REACTIONS = ['none', 'slight', 'liked', 'loved', 'favorite'];

// The same shape the data files use. The Worker holds no copy of the dataset,
// so it cannot check that an id exists -- only that it could. An id that names
// nothing simply never matches a pair in the overlay, and `npm run validate`
// rejects it for good when the sync job tries to commit it.
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validateReport(input) {
  const errors = [];
  const character = typeof input?.character === 'string' ? input.character.trim() : '';
  const gift = typeof input?.gift === 'string' ? input.gift.trim() : '';
  const reaction = typeof input?.reaction === 'string' ? input.reaction.trim() : '';

  if (!ID_PATTERN.test(character)) errors.push('character must be a gift-guide id');
  if (!ID_PATTERN.test(gift)) errors.push('gift must be a gift-guide id');
  if (!REACTIONS.includes(reaction)) errors.push(`reaction must be one of: ${REACTIONS.join(', ')}`);

  return { errors, value: errors.length ? null : { character, gift, reaction } };
}

export async function insertReport(db, { id, character, gift, reaction, createdAt }) {
  await db.prepare(
    `INSERT INTO reports (id, "character", gift, reaction, status, upvotes, downvotes, created_at)
     VALUES (?, ?, ?, ?, 'pending', 0, 0, ?)`,
  ).bind(id, character, gift, reaction, createdAt).run();
}

// The public overlay shape. The vote columns are not merely omitted from the
// response -- they are never selected. That is what makes "votes never reach
// the published site" true at the API boundary rather than a habit the UI is
// trusted to keep.
export async function listPending(db, limit = 500) {
  const { results } = await db.prepare(
    `SELECT id, "character" AS character, gift, reaction, created_at
       FROM reports
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT ?`,
  ).bind(limit).all();
  return results ?? [];
}

// The maintainer's view, and the only place a tally is ever produced.
export async function listForReview(db, limit = 200) {
  const { results } = await db.prepare(
    `SELECT id, "character" AS character, gift, reaction,
            upvotes, downvotes, created_at
       FROM reports
      WHERE status = 'pending'
      ORDER BY (upvotes - downvotes) DESC, created_at ASC
      LIMIT ?`,
  ).bind(limit).all();
  return results ?? [];
}

export async function recordVote(db, id, direction) {
  // The column name is interpolated, so the allowlist above it is load-bearing:
  // `direction` can only ever be one of two literals by the time it is used.
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`unknown vote direction: ${direction}`);
  }
  const column = direction === 'up' ? 'upvotes' : 'downvotes';
  const { meta } = await db.prepare(
    `UPDATE reports SET ${column} = ${column} + 1 WHERE id = ? AND status = 'pending'`,
  ).bind(id).run();
  return (meta?.changes ?? 0) > 0;
}

// `AND status = 'pending'` makes approve and reject idempotent: a second click,
// or a second maintainer, changes nothing and reports false.
export async function setStatus(db, id, status) {
  const { meta } = await db.prepare(
    `UPDATE reports SET status = ? WHERE id = ? AND status = 'pending'`,
  ).bind(status, id).run();
  return (meta?.changes ?? 0) > 0;
}

// Hands the approved rows to the sync job and marks them ingested in the same
// call, as the spec specifies. The trade: if the resulting pull request is
// closed without merging, those rows are not offered again and must be
// re-entered by hand. `worker/README.md` records that.
export async function takeApproved(db, limit = 200) {
  const { results } = await db.prepare(
    `SELECT id, "character" AS character, gift, reaction, created_at
       FROM reports
      WHERE status = 'approved'
      ORDER BY created_at ASC
      LIMIT ?`,
  ).bind(limit).all();

  const rows = results ?? [];
  if (rows.length === 0) return [];

  const placeholders = rows.map(() => '?').join(', ');
  await db.prepare(
    `UPDATE reports SET status = 'ingested' WHERE id IN (${placeholders})`,
  ).bind(...rows.map((row) => row.id)).run();

  return rows;
}
