'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const configurationService = require('../services/configurationService');
const storageProviderRegistry = require('../storage/storageProviderRegistry');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// Sensitive categories (this session's own task) — finance, notifications
// and their provider config, AI provider config, approval/workflow
// policy, and per-provider vendor secrets are all Confidential-or-worse
// data (AI-Governance.md §4's own table names finance/parent-contact
// data at that level; the various provider categories hold — even if
// encrypted at rest, per notificationChannelRepository/cryptoUtil —
// vendor account identifiers no ordinary staff member has a reason to
// read). Restricted to principal, not left to "any
// authenticated tenant user" the way a category like attendance-rule
// display config still reasonably is. A static list, same reasoning
// middleware/permissions.js's own PERMISSION_ROLES table gives for
// being a static, code-level config rather than a DB table — nothing
// names a need for per-tenant customization of which categories count
// as sensitive.
const SENSITIVE_CONFIGURATION_CATEGORIES = [
  // Business rule task #19: institution MFA mode/role-scope
  // (authService.getAuthConfig) — who is forced through a second
  // factor, and which roles are exempt, is exactly the kind of
  // security-posture policy the categories below already exist to
  // protect from ordinary-staff read access.
  'auth',
  'finance',
  'notifications',
  'notification_channels',
  'ai',
  'ai_config',
  'approval',
  'workflow',
  // workflowChainService's own configurable-approval-chain category
  // (BusinessRules.md Configurable approval workflow) — who approves
  // what is exactly the kind of policy 'approval'/'workflow' above
  // already exist to protect; this is that category's real name.
  'workflow_chains',
  'smtp',
  'sms',
  'whatsapp',
  'providers',
  // Stage 8a / RS-GOV-013: which storage backend a college's files live
  // on is an infrastructure/security posture choice, same bar as 'auth'
  // above — not ordinary-staff-readable even though "unrestricted" per
  // the spec means unrestricted to L1 (principal), not to everyone.
  'storage',
];

// RS-GOV-013's own "unrestricted" only means no WorkflowService
// approval gate, not "any shape accepted" — a category nobody validates
// is exactly how storage_tier ended up as a free-text field nothing
// ever read (see storageProviderRegistry.js's own comment). This is the
// one per-category validation this generically-shaped route makes, on
// the one category with a real registry of valid values to check
// against; every other category still has no validation of its own
// (documented, longstanding, this route's own comment below).
function assertValidStorageConfiguration(configuration) {
  const providerName = configuration && configuration.provider;
  if (!providerName || !storageProviderRegistry.listProviderNames().includes(providerName)) {
    throw new configurationService.ConfigurationCategoryValidationError(
      `configuration.provider must be one of ${JSON.stringify(storageProviderRegistry.listProviderNames())}, got ${JSON.stringify(providerName)}`,
    );
  }
}

function createConfigurationsRouter() {
  const router = express.Router();

  // Any authenticated tenant user may read a non-sensitive category —
  // matches the Python version's require_role(*TENANT_ROLES). A
  // sensitive category (SENSITIVE_CONFIGURATION_CATEGORIES above) is
  // restricted to principal instead (this session's own task: this
  // route used to let any authenticated user read finance/
  // notification-provider/AI-provider config, credentials included).
  router.get(
    '/configurations/:category',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const actorRole = req.jwtClaims.role || req.capabilities.effectiveRole;
      if (SENSITIVE_CONFIGURATION_CATEGORIES.includes(req.params.category) && actorRole !== 'principal') {
        res.status(403).json({
          detail: `role ${JSON.stringify(actorRole)} may not read configuration category ${JSON.stringify(req.params.category)}`,
        });
        return;
      }
      const row = await configurationService.getConfiguration(req.dbClient, {
        collegeId: req.collegeId,
        category: req.params.category,
      });
      if (row === null) {
        res.status(404).json({ detail: `No configuration set for category ${JSON.stringify(req.params.category)}` });
        return;
      }
      res.json({ category: row.category, configuration: row.configuration, version: row.version });
    }),
  );

  // Checked the deleted Python version rather than guessing: writes
  // were gated to require_role("principal") specifically — a
  // hardcoded single role, not the open tenant-role-model question
  // RBAC's own build already flagged as unresolved (BusinessRules.md
  // still doesn't say who should be able to change configuration;
  // that's decided per-category by whichever module owns it — e.g.
  // fee-structure changes might reasonably need HOD, not just
  // principal). Ported as-is, conservative default and all, not
  // silently resolved or silently loosened — worth revisiting once a
  // real category has a real business rule about who can change it.
  router.put(
    '/configurations/:category',
    requirePermission('configurations.update'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const { configuration, expected_version: rawExpectedVersion } = req.body || {};
      const expectedVersion = rawExpectedVersion === undefined ? null : rawExpectedVersion;
      try {
        if (req.params.category === 'storage') {
          assertValidStorageConfiguration(configuration);
        }
        const row = await configurationService.setConfiguration(req.dbClient, {
          collegeId: req.collegeId,
          category: req.params.category,
          configuration,
          expectedVersion,
          userId: identityService.resolveActorUserId(req.capabilities),
        });
        res.json({ category: row.category, configuration: row.configuration, version: row.version });
      } catch (err) {
        if (err instanceof configurationService.ConfigurationVersionConflictError) {
          res.status(409).json({ detail: err.message });
          return;
        }
        if (err instanceof configurationService.ConfigurationCategoryValidationError) {
          res.status(400).json({ detail: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  return router;
}

module.exports = createConfigurationsRouter;
