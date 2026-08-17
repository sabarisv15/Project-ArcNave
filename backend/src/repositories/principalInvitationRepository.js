'use strict';

// Query mechanics for `principal_invitations` only — no business
// logic (see services/platformService.js for creation,
// routes/invitations.js for acceptance).
//
// Unlike every other repository in this codebase, functions here are
// called from both sides of the platform/tenant split: createInvitation
// runs against platformPool (arcnave_platform), getInvitationByTokenHash/
// markInvitationAccepted run against a tenant-role connection
// (arcnave_app — either the short-lived lookup client
// routes/invitations.js opens before it knows a collegeId, or
// req.dbClient afterward). That's safe because a pg client/pool here
// is just a connection handle — which role's permissions actually
// apply is enforced by Postgres GRANT on the connection itself (see
// the ported 0002 migration), not by anything in this file.
// arcnave_app has no INSERT grant on this table, so createInvitation
// would fail at the DB level if ever called with a tenant-role
// connection; that's a feature, not a gap this file needs to guard
// against itself.

// fullName/designation/phone/address (all optional): the Onboarding
// Wizard's L1 Head profile fields, carried here so acceptInvitation
// can auto-populate the Principal's real users row instead of asking
// them to re-type what the admin already entered. Null for every
// invitation created via Organizations' Invite-L1 dialog (email only).
async function createInvitation(pool, {
  collegeId, email, tokenHash, createdBy, expiresAt, fullName, designation, phone, address,
}) {
  const result = await pool.query(
    `INSERT INTO principal_invitations (college_id, email, token_hash, created_by, expires_at, full_name, designation, phone, address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, college_id, email, expires_at, created_at, full_name, designation, phone, address`,
    [collegeId, email, tokenHash, createdBy, expiresAt, fullName || null, designation || null, phone || null, address || null],
  );
  return result.rows[0];
}

async function getInvitationByTokenHash(client, tokenHash) {
  const result = await client.query(
    `SELECT id, college_id, email, expires_at, accepted_at, revoked_at, full_name, designation, phone, address
     FROM principal_invitations WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

async function getInvitationById(pool, invitationId) {
  const result = await pool.query(
    `SELECT id, college_id, email, expires_at, accepted_at, revoked_at, created_at
     FROM principal_invitations WHERE id = $1`,
    [invitationId],
  );
  return result.rows[0] || null;
}

async function markInvitationAccepted(client, invitationId) {
  const result = await client.query(
    'UPDATE principal_invitations SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL',
    [invitationId],
  );
  return result.rowCount > 0;
}

// Rotates token_hash/expires_at on an existing invitation — resend
// reuses the SAME row rather than creating a second one, so there is
// never more than one live invitation per original invite action. Only
// accepted_at blocks this now (NOT revoked_at): a revoked invitation is
// explicitly revivable by resending it — clears revoked_at back to
// NULL in the same statement, matching the Invitations screen's own
// "SEND INVITATION" action on a revoked row (the same row un-revoked
// and re-sent, not a fresh invite). The WHERE guard is the real
// backstop (same "let the DB be the actual backstop" discipline as
// everywhere else in this codebase): a concurrent accept racing this
// call means zero rows come back, not a silently-wrong token issued
// for an invitation that's no longer resendable.
// `email` is optional — omitted, this rotates token/expiry only for
// the SAME stored address (the original behavior); passed, it also
// redirects the resend to a different inbox in the same statement
// (typo-correction case), same WHERE guard either way. `coalesce`
// keeps the column untouched rather than requiring every caller to
// pass the existing value back.
async function resendInvitation(pool, invitationId, { tokenHash, expiresAt, email }) {
  const result = await pool.query(
    `UPDATE principal_invitations SET token_hash = $2, expires_at = $3, email = coalesce($4, email), revoked_at = NULL
     WHERE id = $1 AND accepted_at IS NULL
     RETURNING id, college_id, email, expires_at, created_at`,
    [invitationId, tokenHash, expiresAt, email || null],
  );
  return result.rows[0] || null;
}

// Same WHERE-guard reasoning as resendInvitation: an already-accepted
// or already-revoked invitation is simply not touched (null returned),
// never silently re-revoked or revoked-after-accepted.
async function revokeInvitation(pool, invitationId) {
  const result = await pool.query(
    `UPDATE principal_invitations SET revoked_at = now()
     WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
     RETURNING id, college_id, email, revoked_at`,
    [invitationId],
  );
  return result.rows[0] || null;
}

// Platform Admin module build, Phase C (plans/tingly-marinating-
// whistle.md) — the Invitations screen's list/search/status-filter
// read path. `status` is derived, not a stored column: pending/
// accepted/expired/revoked all fall out of accepted_at/revoked_at/
// expires_at, the same three columns every other function in this
// file already reads — no new column, no denormalized status to keep
// in sync.
//
// Joins colleges for college_name (the Invitations screen's redesign
// needs the college's display name, not just its id — the id alone
// isn't what a human recognizes an org by) and folds it into the
// search predicate alongside email/college_id.
async function listInvitations(pool, {
  limit = 20, offset = 0, status, search,
} = {}) {
  const conditions = [];
  const params = [limit, offset];

  if (status === 'pending') {
    conditions.push('pi.accepted_at IS NULL AND pi.revoked_at IS NULL AND pi.expires_at > now()');
  } else if (status === 'accepted') {
    conditions.push('pi.accepted_at IS NOT NULL');
  } else if (status === 'expired') {
    conditions.push('pi.accepted_at IS NULL AND pi.revoked_at IS NULL AND pi.expires_at <= now()');
  } else if (status === 'revoked') {
    conditions.push('pi.revoked_at IS NOT NULL');
  }

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(pi.email ILIKE $${params.length} OR pi.college_id ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT pi.id, pi.college_id, c.name AS college_name, pi.email, pi.expires_at, pi.accepted_at, pi.revoked_at, pi.created_at
     FROM principal_invitations pi
     LEFT JOIN colleges c ON c.college_id = pi.college_id
     ${where}
     ORDER BY pi.created_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );
  return result.rows;
}

// Dashboard summary building block (Phase C) — same pending definition
// listInvitations' status filter above already uses.
async function countPending(pool) {
  const result = await pool.query(
    'SELECT count(*)::int AS count FROM principal_invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()',
  );
  return result.rows[0].count;
}

// Invitations page stat row — same four derived states listInvitations'
// status filter branches on, counted in one pass instead of four
// separate queries.
async function getInvitationsSummary(pool) {
  const result = await pool.query(
    `SELECT
       count(*) FILTER (WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())::int AS pending,
       count(*) FILTER (WHERE accepted_at IS NOT NULL)::int AS accepted,
       count(*) FILTER (WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now())::int AS expired,
       count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked
     FROM principal_invitations`,
  );
  return result.rows[0];
}

// Dashboard stat card sub-line — "N expiring in 24h" under Pending
// Invitations.
async function countExpiringSoon(pool) {
  const result = await pool.query(
    "SELECT count(*)::int AS count FROM principal_invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() AND expires_at <= now() + interval '24 hours'",
  );
  return result.rows[0].count;
}

module.exports = {
  createInvitation,
  getInvitationByTokenHash,
  getInvitationById,
  markInvitationAccepted,
  resendInvitation,
  revokeInvitation,
  listInvitations,
  countPending,
  countExpiringSoon,
  getInvitationsSummary,
};
