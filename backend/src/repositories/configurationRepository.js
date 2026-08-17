'use strict';

// Query mechanics for `configurations` only — no business logic (see
// services/configurationService.js for that). RLS-scoped tenant
// table; every query here runs through req.dbClient, so results are
// implicitly filtered to whatever tenant tenantMiddleware resolved.
// collegeId is still passed explicitly into every query anyway —
// defense in depth, same reasoning as authRepository.js: RLS is the
// backstop, not the only filter a reader of this file should have to
// trust.
//
// category is never validated or enumerated here or in the service —
// it's an opaque string, and configuration is opaque JSONB. Which
// category names exist and what shape their JSON should have is a
// decision for whichever module owns that category (Attendance,
// Finance, Notifications, ...), not Module 0.

async function getConfiguration(client, { collegeId, category }) {
  const result = await client.query(
    `SELECT id, college_id, category, configuration, version, updated_at
     FROM configurations WHERE college_id = $1 AND category = $2`,
    [collegeId, category],
  );
  return result.rows[0] || null;
}

// Single upsert statement — not a structural port of the deleted
// Python version's two-function create_configuration/
// update_configuration split, but a faithful port of the OBSERVABLE
// behavior it implemented: real optimistic concurrency (checked
// against Python's actual code before building this, not assumed —
// see configurationService.js's module comment), never a blind
// increment-on-every-write.
//
// Postgres's own `ON CONFLICT ... DO UPDATE ... WHERE <condition>`
// natively covers every case Python needed exception-handling for, in
// one atomic statement:
//   - No existing row: no conflict, the INSERT branch fires
//     unconditionally at version 1, regardless of what
//     expectedVersion was passed (the service layer validates that
//     shape *before* calling this, same as Python's pre-check).
//   - Existing row, version matches expectedVersion: conflict fires,
//     the WHERE passes, UPDATE proceeds, version increments by 1.
//   - Existing row, version does NOT match (a stale write, or two
//     callers racing to create the same category — the second one to
//     reach this statement always sees a real row by the time it
//     runs, so it always takes the conflict branch): the WHERE fails,
//     nothing is modified, RETURNING yields zero rows.
// That last case — WHERE-fails-on-DO-UPDATE returns no row rather
// than raising or silently keeping the old row — is exactly the
// semantic optimistic concurrency needs, and it was proven with a
// real stale-version test (tests/configurations.test.js), not assumed
// from reading Postgres's documentation.
async function upsertConfiguration(client, { collegeId, category, configuration, expectedVersion }) {
  const result = await client.query(
    `INSERT INTO configurations (college_id, category, configuration, version)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (college_id, category) DO UPDATE
       SET configuration = EXCLUDED.configuration,
           version = configurations.version + 1,
           updated_at = now()
       WHERE configurations.version = $4
     RETURNING id, college_id, category, configuration, version, updated_at`,
    [collegeId, category, JSON.stringify(configuration), expectedVersion],
  );
  return result.rows[0] || null;
}

module.exports = { getConfiguration, upsertConfiguration };
