'use strict';

// jobType/payload are optional (both default to NULL at the DB level) —
// routes/backgroundJobs.js's own generic POST /background-jobs still
// calls this with neither, unchanged.
async function create(client, { collegeId, name, createdByUserId, jobType, payload }) {
  const result = await client.query(
    `INSERT INTO background_jobs (college_id, name, status, created_by_user_id, job_type, payload)
     VALUES ($1, $2, 'queued', $3, $4, $5)
     RETURNING *`,
    [collegeId, name, createdByUserId, jobType || null, payload ? JSON.stringify(payload) : null],
  );
  return result.rows[0];
}

// The admission-extraction handler's own progress ticks — a plain
// 0-100 write, no status change (that's markRunning/markCompleted/
// markFailed's job, not this one's).
async function updateProgress(client, id, progress) {
  const result = await client.query('UPDATE background_jobs SET progress = $2 WHERE id = $1 RETURNING *', [
    id,
    progress,
  ]);
  return result.rows[0] || null;
}

async function markRunning(client, id) {
  const result = await client.query(
    `UPDATE background_jobs
     SET status = 'running', started_at = now()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

// result is optional (routes/backgroundJobs.js's own generic job never
// passes one) — JSON-stringified the same way payload is above.
async function markCompleted(client, id, result) {
  const queryResult = await client.query(
    `UPDATE background_jobs
     SET status = 'completed', progress = 100, finished_at = now(), result = $2
     WHERE id = $1
     RETURNING *`,
    [id, result ? JSON.stringify(result) : null],
  );
  return queryResult.rows[0] || null;
}

async function markFailed(client, id, error) {
  const result = await client.query(
    `UPDATE background_jobs
     SET status = 'failed', error = $2, finished_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, error],
  );
  return result.rows[0] || null;
}

// ARCNAVE modernization P2 (4.5 / clash C8) — atomic claim for the
// worker loop (jobs/backgroundJobWorker.js): flips status queued ->
// running for up to `limit` rows in one statement, so two overlapping
// poll ticks (or, if this deployment ever moves to multiple worker
// processes) can never both pick up the same row. FOR UPDATE SKIP
// LOCKED is the real guarantee, not just ordering — a row another
// claim already has locked is silently skipped, not waited on.
async function claimQueuedJobs(client, jobTypes, limit) {
  if (!Array.isArray(jobTypes) || jobTypes.length === 0) return [];
  const result = await client.query(
    `UPDATE background_jobs
     SET status = 'running', started_at = now()
     WHERE id IN (
       SELECT id FROM background_jobs
       WHERE status = 'queued' AND job_type = ANY($1)
       ORDER BY created_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [jobTypes, limit],
  );
  return result.rows;
}

async function findById(client, id) {
  const result = await client.query('SELECT * FROM background_jobs WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function list(client, { limit = 50, offset = 0 } = {}) {
  const result = await client.query(
    `SELECT * FROM background_jobs
     ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return result.rows;
}

module.exports = {
  create,
  markRunning,
  markCompleted,
  markFailed,
  updateProgress,
  claimQueuedJobs,
  findById,
  list,
};
