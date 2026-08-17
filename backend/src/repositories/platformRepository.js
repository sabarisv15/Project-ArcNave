'use strict';

// Query mechanics for `platform_admins` and `colleges` only — the
// Platform layer's two tables (ADR-010). Never
// users/refresh_tokens/audit_log/configurations; arcnave_platform has
// no GRANT on those regardless (see the ported migrations), so a
// query against them here would fail at the DB level even if someone
// tried. No business logic in this file — see
// services/platformService.js for that.
//
// No principal_invitations here — that repository/table is a later
// slice, not this pass's scope (login + college creation only).

async function getPlatformAdminByUsername(client, username) {
  const result = await client.query(
    'SELECT id, username, email, password_hash FROM platform_admins WHERE username = $1',
    [username],
  );
  return result.rows[0] || null;
}

// The first-run bootstrap this session's own task asks for: creates
// the very first platform_admins row, but ONLY if none exists yet —
// expressed as a single atomic statement (INSERT ... SELECT ... WHERE
// NOT EXISTS), not a check-then-insert, so a race between two
// concurrent bootstrap calls can never both succeed. RETURNING zero
// rows (an empty result, not an error) means a platform admin already
// exists; the service layer maps that to a real, typed error.
async function bootstrapPlatformAdmin(client, { username, email, passwordHash }) {
  const result = await client.query(
    `INSERT INTO platform_admins (username, email, password_hash)
     SELECT $1, $2, $3
     WHERE NOT EXISTS (SELECT 1 FROM platform_admins)
     RETURNING id, username, email, created_at`,
    [username, email, passwordHash],
  );
  return result.rows[0] || null;
}

const COLLEGE_RETURNING = `id, college_id, name, subdomain, subscription_status, trial_ends_at, created_at,
     level1_position_title, level3_position_title, level4_position_title, storage_tier, provisioning_status, version,
     aicte_id, college_type, institution_type, disclosure_link, aishe_code, nba_points,
     nba_valid_till, women_institution, naac_accredited, naac_cgpa, inst_mobile, inst_email,
     inst_website, logo_file_name, level2_position_title, l2_enabled, l3_reports_via_l2, l2_duty_module,
     year_established, address`;

// Onboarding-profile columns (RS-GOV-014 / OnboardingWizard.jsx Step
// 0 + Step 3): plain optional fields, same "null when omitted" shape
// as level1/level3PositionTitle above — see 1759400000000's own
// comment for why none of them get a GRANT or a tenant-side edit
// surface in this pass.
const PROFILE_COLUMNS = [
  ['aicteId', 'aicte_id'],
  ['collegeType', 'college_type'],
  ['institutionType', 'institution_type'],
  ['disclosureLink', 'disclosure_link'],
  ['aisheCode', 'aishe_code'],
  ['nbaPoints', 'nba_points'],
  ['nbaValidTill', 'nba_valid_till'],
  ['womenInstitution', 'women_institution'],
  ['naacAccredited', 'naac_accredited'],
  ['naacCgpa', 'naac_cgpa'],
  ['instMobile', 'inst_mobile'],
  ['instEmail', 'inst_email'],
  ['instWebsite', 'inst_website'],
  ['logoFileName', 'logo_file_name'],
  ['level4PositionTitle', 'level4_position_title'],
  ['level2PositionTitle', 'level2_position_title'],
  ['l2Enabled', 'l2_enabled'],
  ['l3ReportsViaL2', 'l3_reports_via_l2'],
  ['l2DutyModule', 'l2_duty_module'],
  // Pre-existing tenant-editable columns (1753000000000) — onboarding
  // may seed them, Institution Settings owns them afterward (RS-GOV-013).
  ['yearEstablished', 'year_established'],
  ['address', 'address'],
];

async function createCollege(client, {
  collegeId, name, subdomain, createdBy, level1PositionTitle, level3PositionTitle, storageTier, subscriptionStatus,
  ...profileFields
}) {
  const profileEntries = PROFILE_COLUMNS.filter(([key]) => profileFields[key] !== undefined);
  const columnNames = ['college_id', 'name', 'subdomain', 'created_by', 'level1_position_title',
    'level3_position_title', 'storage_tier', 'subscription_status', ...profileEntries.map(([, column]) => column)];
  const values = [collegeId, name, subdomain, createdBy, level1PositionTitle || null,
    level3PositionTitle || null, storageTier || null, subscriptionStatus || 'trial',
    ...profileEntries.map(([key]) => profileFields[key])];
  const placeholders = values.map((_, i) => `$${i + 1}`);

  // trial_ends_at (30-day fixed window, this session's decision) is
  // derived from subscription_status's own placeholder ($8) rather
  // than passed as a separate value — never out of sync with whichever
  // license this INSERT actually lands.
  columnNames.push('trial_ends_at');
  placeholders.push("(CASE WHEN $8 = 'trial' THEN now() + interval '30 days' ELSE NULL END)");

  const result = await client.query(
    `INSERT INTO colleges (${columnNames.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING ${COLLEGE_RETURNING}`,
    values,
  );
  return result.rows[0];
}

async function findCollegeById(client, collegeId) {
  const result = await client.query(
    `SELECT ${COLLEGE_RETURNING} FROM colleges WHERE college_id = $1`,
    [collegeId],
  );
  return result.rows[0] || null;
}

// Create/Edit College customization — the edit half of createCollege
// above. college_id/subdomain/created_by are deliberately not
// editable here: college_id is this table's own external identifier
// (other tables FK to it, tenant resolution keys off it) and subdomain
// is what a college's users already have bookmarked/configured DNS
// against — neither is safe to change through a simple PATCH, so
// neither is even accepted as a field name below.
//
// Stage 8a / D13 / RS-GOV-013: name, level1_position_title and
// level3_position_title moved OFF this list — post-creation editing of
// those now belongs to the tenant side (collegeProfileRepository.js,
// principal-only, via Institution Settings), not Platform Admin. All
// three are still set once at createCollege time above (onboarding
// provisioning is a genuinely different act from ongoing editing).
// storage_tier is not in this PATCH list — it's now a real, enforced
// quota (documentService.assertWithinStorageQuota), but still only
// ever set once at createCollege time, same as level1/3PositionTitle
// above; changing a live college's quota isn't a Platform Admin PATCH
// concern any more than its name is. Only subscriptionStatus (license)
// remains a Platform Admin concern: an
// operational/billing fact about ARCNAVE's own relationship with the
// college, not the college's own identity or infrastructure choice.
const EDITABLE_COLUMNS = [
  ['subscriptionStatus', 'subscription_status'],
];

async function updateCollege(client, collegeId, fields) {
  const entries = EDITABLE_COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findCollegeById(client, collegeId);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  // A license change re-derives trial_ends_at from the SAME placeholder
  // as subscription_status itself ($2 here — subscriptionStatus is
  // EDITABLE_COLUMNS' only entry) — moving to 'full' clears it, moving
  // (back) to 'trial' restarts the fixed 30-day window from now.
  if (fields.subscriptionStatus !== undefined) {
    setClauses.push("trial_ends_at = (CASE WHEN $2 = 'trial' THEN now() + interval '30 days' ELSE NULL END)");
  }

  const result = await client.query(
    `UPDATE colleges SET ${setClauses.join(', ')}
     WHERE college_id = $1
     RETURNING ${COLLEGE_RETURNING}`,
    [collegeId, ...values],
  );
  return result.rows[0] || null;
}

// RS-GOV-005 structural-action wizard: columns a redeemed struct key
// can write, kept deliberately separate from EDITABLE_COLUMNS/
// updateCollege above — that path is the general PATCH route (license
// only, per RS-GOV-013); this one is reachable ONLY from
// platformService's struct-key redeem flow, never from a route a
// Platform Admin could hit without a valid key in hand.
const STRUCTURAL_COLUMNS = [
  ['l2Enabled', 'l2_enabled'],
  ['l3ReportsViaL2', 'l3_reports_via_l2'],
  ['l2DutyModule', 'l2_duty_module'],
  ['l2PermittedModules', 'l2_permitted_modules'],
  ['affiliatingUniversity', 'affiliating_university'],
  ['naacAccredited', 'naac_accredited'],
  ['naacCgpa', 'naac_cgpa'],
  ['nbaPoints', 'nba_points'],
  ['nbaValidTill', 'nba_valid_till'],
  ['l2EffectiveDate', 'l2_effective_date'],
  ['affiliationEffectiveDate', 'affiliation_effective_date'],
  ['accreditationEffectiveDate', 'accreditation_effective_date'],
];

async function updateStructuralFields(client, collegeId, fields) {
  const entries = STRUCTURAL_COLUMNS.filter(([key]) => fields[key] !== undefined);
  if (entries.length === 0) {
    return findCollegeById(client, collegeId);
  }

  const setClauses = entries.map(([, column], i) => `${column} = $${i + 2}`);
  const values = entries.map(([key]) => fields[key]);

  const result = await client.query(
    `UPDATE colleges SET ${setClauses.join(', ')}, version = version + 1
     WHERE college_id = $1
     RETURNING ${COLLEGE_RETURNING}`,
    [collegeId, ...values],
  );
  return result.rows[0] || null;
}

// Platform Admin module build, Phase B (plans/tingly-marinating-
// whistle.md) — the scheduler (jobs/platformStatsSync.js) needs the
// full set of college_ids to iterate for the tenant stats rollup.
// Plain id list, no pagination: colleges are platform-admin-created
// one at a time, nowhere near the row count that would need it.
async function listCollegeIds(client) {
  const result = await client.query('SELECT college_id FROM colleges ORDER BY college_id');
  return result.rows.map((row) => row.college_id);
}

// RS-GOV-010: the transition guard is the WHERE clause itself, not a
// pre-read-then-write check — a concurrent transition attempt (or one
// racing an already-moved status) simply returns null, never silently
// clobbers a state it didn't actually see. `fromStatuses` is always a
// fixed array literal at the call site (see platformService.js), never
// user input.
async function transitionProvisioningStatus(client, collegeId, { fromStatuses, toStatus }) {
  const result = await client.query(
    `UPDATE colleges SET provisioning_status = $2, version = version + 1
     WHERE college_id = $1 AND provisioning_status = ANY($3::text[])
     RETURNING college_id, provisioning_status, version`,
    [collegeId, toStatus, fromStatuses],
  );
  return result.rows[0] || null;
}

module.exports = {
  getPlatformAdminByUsername,
  bootstrapPlatformAdmin,
  createCollege,
  findCollegeById,
  updateCollege,
  updateStructuralFields,
  listCollegeIds,
  transitionProvisioningStatus,
};
