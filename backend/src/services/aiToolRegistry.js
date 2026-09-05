'use strict';

// Module 9 (AI) — Tool Registry + Policy Gate. Thin facade over
// services/aiTools/* (same split-file pattern services/academicService.js
// established for services/academic/*, and services/aiService.js for
// services/ai/*): this file owns no logic of its own. It requires the
// engine (services/aiTools/engine.js — registration/lookup machinery,
// the Policy Gate, invokeTool) and re-exports that engine's own public
// API unchanged, so every existing call site (routes/ai.js, aiService.js,
// other services, tests) that requires '../services/aiToolRegistry'
// keeps working with zero changes. It also requires every
// services/aiTools/tools*.js batch file purely for their registerTool()
// side effect at module load time — none of those files export anything
// meaningful themselves, and this file never re-exports anything from
// them.
//
// AI-Governance.md §1/§2: "AI Agent -> Tool Registry -> Read/Generate/
// Workflow Tools -> Business Services (never repositories, never
// storage)". See services/aiTools/engine.js's own header comment for
// why the registry and the Policy Gate stay one engine (the Policy Gate
// IS the registry's own invocation path, not a bolt-on), and each
// services/aiTools/tools*.js file's own header for which registration
// era (this file's original chronological section comments — "Real
// tool #1", "Institutional Documents Phase 2/3", "Role-aware ERP
// Copilot tools", "2026-07-26 UAT wiring", "Phase 8", etc.) it covers.

const engine = require('./aiTools/engine');

require('./aiTools/tools01');
require('./aiTools/tools02');
require('./aiTools/tools03');
require('./aiTools/tools04');
require('./aiTools/tools05');
require('./aiTools/tools06');
require('./aiTools/tools07');
require('./aiTools/tools08');
require('./aiTools/tools09');
require('./aiTools/tools10');
require('./aiTools/tools11');

module.exports = {
  AiToolNotFoundError: engine.AiToolNotFoundError,
  AiToolLevelNotSupportedError: engine.AiToolLevelNotSupportedError,
  AiToolTenantMismatchError: engine.AiToolTenantMismatchError,
  AiToolRoleNotPermittedError: engine.AiToolRoleNotPermittedError,
  AiToolDataClassificationError: engine.AiToolDataClassificationError,
  AiToolDepartmentScopeError: engine.AiToolDepartmentScopeError,
  AiToolL3BypassError: engine.AiToolL3BypassError,
  AiToolInvalidParamsError: engine.AiToolInvalidParamsError,
  AiToolAnalyticsLevelViolationError: engine.AiToolAnalyticsLevelViolationError,
  AiToolBulkOperationRejectedError: engine.AiToolBulkOperationRejectedError,
  registerTool: engine.registerTool,
  getTool: engine.getTool,
  listTools: engine.listTools,
  filterToolsByRelevance: engine.filterToolsByRelevance,
  rankToolsByKeywordOverlap: engine.rankToolsByKeywordOverlap,
  invokeTool: engine.invokeTool,
  checkToolPreconditions: engine.checkToolPreconditions,
  computeRiskLevel: engine.computeRiskLevel,
  buildActionManifest: engine.buildActionManifest,
};
