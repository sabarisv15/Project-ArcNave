'use strict';

// Platform Admin module build, Phase C (plans/tingly-marinating-
// whistle.md) — the single entry point every platform mutation routes
// through to write an audit entry, rather than calling
// platformAuditLogRepository directly. Today this just forwards to the
// repository, but keeping it as its own service (not inlined into
// platformService.js) is deliberate: it's the integration point for
// events/notifications if that's ever needed later, without every
// call site having to change when it grows one.
//
// record() never throws past its own boundary — a failure to write an
// audit entry must never fail the mutation it's describing (creating a
// college still succeeds even if the audit write itself hits a
// transient DB error); it logs and moves on instead.

const platformAuditLogRepository = require('../repositories/platformAuditLogRepository');
const { logError } = require('../logging/logger');

async function record(pool, {
  actorAdminId, action, entity, entityId, ipAddress, metadata,
}) {
  try {
    await platformAuditLogRepository.createEntry(pool, {
      actorAdminId, action, entity, entityId, ipAddress, metadata,
    });
  } catch (err) {
    logError('platform_audit_write_failed', {
      action, entity, entityId, error: err.message,
    });
  }
}

module.exports = { record };
