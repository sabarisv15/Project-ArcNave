'use strict';

// Query mechanics for the tenant-editable profile columns on
// `colleges` (name, level1_position_title, level3_position_title,
// affiliating_university, year_established, address) — not the whole
// table. Distinct from platformRepository.js,
// which owns `colleges` for the Platform layer (college creation,
// ADR-010); this file is the tenant-side counterpart, read through
// `arcnave_app`/`req.dbClient`, for a College Admin viewing/editing
// their own college's profile. No business logic here (that's a
// future collegeProfileService's job) -- no service/API/UI in this
// slice, per this pass's own build brief.
//
// `colleges` has no RLS (see the migration's own comment for why it
// structurally can't: Tenant Middleware reads it before
// app.current_tenant is ever set, to resolve the tenant in the first
// place). That means the `WHERE college_id = $1` filter below is NOT
// defense-in-depth the way an equivalent filter is on every other
// tenant table in this codebase (staffRepository.findByStaffCode,
// etc.) -- it is the *only* thing scoping which row updateProfile
// touches. The column-level GRANT (arcnave_app can UPDATE only these
// six columns, never subscription_status/subdomain/storage_tier/
// created_by/college_id) is the other half of the mitigation, enforced
// at the DB level regardless of what this file does.

// Stage 8a / D13 / RS-GOV-013: name/level1PositionTitle/
// level3PositionTitle joined this allow-list — Organization Name and
// position-title editing move here from the platform-admin side
// (platformRepository.js's own EDITABLE_COLUMNS narrowed in the same
// stage). The matching column-level GRANT is
// 1759200000000_college-profile-tenant-editable-identity-fields.js —
// without it these three UPDATEs fail at the DB level exactly the way
// subscription_status/subdomain/etc. already do for this role.
// Stage 8b / RS-IDN-012: level4PositionTitle joins the allow-list — see
// 1759300000000_college-level4-position-title.js for its own GRANT.
const COLUMNS = [
  ['name', 'name'],
  ['level1PositionTitle', 'level1_position_title'],
  ['level3PositionTitle', 'level3_position_title'],
  ['level4PositionTitle', 'level4_position_title'],
  ['affiliatingUniversity', 'affiliating_university'],
  ['yearEstablished', 'year_established'],
  ['address', 'address'],
];

const RETURNING =
  'college_id, name, level1_position_title, level3_position_title, ' +
  'level4_position_title, affiliating_university, year_established, address';

async function getByCollegeId(client, collegeId) {
  const result = await client.query(`SELECT ${RETURNING} FROM colleges WHERE college_id = $1`, [collegeId]);
  return result.rows[0] || null;
}

// ADR-021 — the Level 1 position title a Platform Admin chose at
// createCollege time
// (platformService.createCollege / platformRepository.createCollege),
// read back from the tenant side at invite-accept time
// (authService.provisionLevel1PositionForNewPrincipal). Same
// SELECT-only, no-RLS access shape getByCollegeId above already relies
// on; a dedicated single-column function rather than folding this into
// getByCollegeId's three College-Admin-editable profile columns, since
// this one is Platform-Admin-owned and read-only from the tenant side —
// deliberately not exposed through collegeProfileService/
// routes/collegeProfile.js at all.
async function getLevel1PositionTitle(client, collegeId) {
  const result = await client.query('SELECT level1_position_title FROM colleges WHERE college_id = $1', [collegeId]);
  return result.rows[0] ? result.rows[0].level1_position_title : null;
}

// Same shape as getLevel1PositionTitle above, one level down —
// staffService.ensureHodPosition's own Platform-Admin-chosen title for
// this college's Level 3 (HOD-equivalent) position, falling back to
// DEFAULT_LEVEL3_POSITION_TITLE ('HOD') there when null.
async function getLevel3PositionTitle(client, collegeId) {
  const result = await client.query('SELECT level3_position_title FROM colleges WHERE college_id = $1', [collegeId]);
  return result.rows[0] ? result.rows[0].level3_position_title : null;
}

// Stage 8b — same shape as getLevel1PositionTitle/getLevel3PositionTitle
// above, one level down again. classTutorService.ensureClassTutorPosition
// / positionAccountInvitationService.ensureClassTutorPositionForInvite
// fall back to 'Class Tutor' when null.
async function getLevel4PositionTitle(client, collegeId) {
  const result = await client.query('SELECT level4_position_title FROM colleges WHERE college_id = $1', [collegeId]);
  return result.rows[0] ? result.rows[0].level4_position_title : null;
}

// Same shape as getLevel1/3/4PositionTitle above — documentService's
// storage-quota enforcement (assertWithinStorageQuota) reading the
// Platform-Admin-set tier from the tenant side, read-only.
async function getStorageTier(client, collegeId) {
  const result = await client.query('SELECT storage_tier FROM colleges WHERE college_id = $1', [collegeId]);
  return result.rows[0] ? result.rows[0].storage_tier : null;
}

async function updateProfile(client, collegeId, fields) {
  const entries = COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return getByCollegeId(client, collegeId);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE colleges SET ${setClauses.join(', ')}
     WHERE college_id = $1
     RETURNING ${RETURNING}`,
    [collegeId, ...values],
  );
  return result.rows[0] || null;
}

module.exports = {
  getByCollegeId,
  updateProfile,
  getLevel1PositionTitle,
  getLevel3PositionTitle,
  getLevel4PositionTitle,
  getStorageTier,
};
