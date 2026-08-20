'use strict';

// Query mechanics for `class_logs` only — no business logic
// (classLogService's job). RLS handles tenant scoping; filtering to
// "classes this staff member may see" happens in the service via
// visibilityService, not here.

const COLUMNS = [
  ['collegeId', 'college_id'],
  ['classId', 'class_id'],
  ['timetablePeriodId', 'timetable_period_id'],
  ['subject', 'subject'],
  ['sessionDate', 'session_date'],
  ['topic', 'topic'],
  ['notes', 'notes'],
  ['createdByUserId', 'created_by_user_id'],
];

async function create(client, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  const columnNames = entries.map(([, column]) => column);
  const values = entries.map(([key]) => fields[key]);
  const placeholders = entries.map((_, i) => `$${i + 1}`);

  const result = await client.query(
    `INSERT INTO class_logs (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM class_logs WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function update(client, id, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findById(client, id);
  }
  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE class_logs SET ${setClauses.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, ...values],
  );
  return result.rows[0] || null;
}

async function remove(client, id) {
  const result = await client.query('DELETE FROM class_logs WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

// list: searchable by class/subject/date-range — the real query shapes
// a "Teaching Journal" screen and a class-history lookup both need.
// classId omitted means "every class the caller's own scope already
// resolved" — the service passes an explicit IN-list via classIds
// instead when the caller isn't scoped to a single class.
// limit is optional and undefined by default — every existing caller
// (the human-facing GET /class-logs Teaching Journal route included)
// keeps its exact current unbounded behavior; only an explicit opt-in
// caller (the class_log_list AI tool) gets a capped, most-recent-first
// result — already the query's own ORDER BY, so a LIMIT here is a
// genuine "recent entries" view, not an arbitrary truncation.
async function list(client, {
  classId, classIds, subject, fromDate, toDate, limit,
} = {}) {
  const conditions = [];
  const values = [];

  if (classId !== undefined) {
    values.push(classId);
    conditions.push(`class_id = $${values.length}`);
  } else if (classIds !== undefined) {
    values.push(classIds);
    conditions.push(`class_id = ANY($${values.length}::uuid[])`);
  }
  if (subject !== undefined) {
    values.push(subject);
    conditions.push(`subject = $${values.length}`);
  }
  if (fromDate !== undefined) {
    values.push(fromDate);
    conditions.push(`session_date >= $${values.length}`);
  }
  if (toDate !== undefined) {
    values.push(toDate);
    conditions.push(`session_date <= $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  let limitClause = '';
  if (limit !== undefined) {
    values.push(limit);
    limitClause = ` LIMIT $${values.length}`;
  }
  const result = await client.query(
    `SELECT * FROM class_logs ${whereClause} ORDER BY session_date DESC, created_at DESC${limitClause}`,
    values,
  );
  return result.rows;
}

module.exports = {
  create, findById, update, remove, list,
};
