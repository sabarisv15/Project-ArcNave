'use strict';

// "Activity Timeline" (UAT Priority 2 #5) — every account's own audit
// trail (attendance marked, marks submitted, corrections requested,
// admissions performed, ...), read straight off the existing audit_log
// table every one of those actions already writes to. No new table:
// this is a presentation of data that already exists, same reasoning
// that made this one of the cheaper items in the discovery pass.
//
// Deliberately self-only for v1 (actorUserId is always the caller's
// own id, never accepted from the request) — "every account gets an
// audit timeline" was scoped as a personal feature, not a management
// view into someone else's activity; an HOD/Principal activity view
// into their staff's timelines is a different, unscoped feature, not
// assumed here.

const auditLogRepository = require('../repositories/auditLogRepository');

async function getOwnActivity(client, { actorUserId, limit, offset }) {
  return auditLogRepository.findByUser(client, actorUserId, { limit, offset });
}

module.exports = { getOwnActivity };
