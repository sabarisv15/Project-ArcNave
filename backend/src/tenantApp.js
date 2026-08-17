'use strict';

const express = require('express');
const { appPool } = require('./db/pool');
const asyncHandler = require('./middleware/asyncHandler');
const { requestContextMiddleware } = require('./middleware/requestContext');
const { authMiddleware } = require('./middleware/auth');
const { tenantMiddleware } = require('./middleware/tenant');
const { sessionRevocationMiddleware } = require('./middleware/sessionRevocation');
const { identityMiddleware } = require('./middleware/identity');
const errorHandler = require('./middleware/errorHandler');
const createAuthRouter = require('./routes/auth');
const createConfigurationsRouter = require('./routes/configurations');
const createAiConfigRouter = require('./routes/aiConfig');
const createInvitationsRouter = require('./routes/invitations');
const createPositionAccountInvitationsRouter = require('./routes/positionAccountInvitations');
const createStaffInvitationsRouter = require('./routes/staffInvitations');
const createPositionAccountsRouter = require('./routes/positionAccounts');
const createStudentsRouter = require('./routes/students');
const createStaffRouter = require('./routes/staff');
const createClassesRouter = require('./routes/classes');
const createFacultyAllocationRouter = require('./routes/facultyAllocation');
const createTimetablePeriodsRouter = require('./routes/timetablePeriods');
const createAttendanceRouter = require('./routes/attendance');
const createFinanceRouter = require('./routes/finance');
const createDocumentsRouter = require('./routes/documents');
const createDocumentCategoriesRouter = require('./routes/documentCategories');
const createReportsRouter = require('./routes/reports');
const createBackgroundJobsRouter = require('./routes/backgroundJobs');
const createWorkflowRequestsRouter = require('./routes/workflowRequests');
const createCollegeProfileRouter = require('./routes/collegeProfile');
const createDepartmentsRouter = require('./routes/departments');
const createStructuralAuthorizationKeysRouter = require('./routes/structuralAuthorizationKeys');
const createAiRouter = require('./routes/ai');
const createAnalyticsRouter = require('./routes/analytics');
const createNotificationsRouter = require('./routes/notifications');
const createAcademicYearsRouter = require('./routes/academicYears');
const createCurriculumRouter = require('./routes/curriculum');
const createExaminationRouter = require('./routes/examination');
const createAssessmentsRouter = require('./routes/assessments');
const createWorkflowChainsRouter = require('./routes/workflowChains');
const createArchivalRouter = require('./routes/archival');
const createCalendarRouter = require('./routes/calendar');
const createAdmissionDraftsRouter = require('./routes/admissionDrafts');
const createDocumentTypesRouter = require('./routes/documentTypes');
const createClassLogsRouter = require('./routes/classLogs');
const createPersonalNotesRouter = require('./routes/personalNotes');
const createProjectsRouter = require('./routes/projects');
const createConversationsRouter = require('./routes/conversations');
const createArtifactsRouter = require('./routes/artifacts');
const createUserPreferencesRouter = require('./routes/userPreferences');
const createActivityTimelineRouter = require('./routes/activityTimeline');
const createSearchRouter = require('./routes/search');
const createWorkspaceHeroRouter = require('./routes/workspaceHero');

// The tenant-facing API — a genuinely separate Express app from
// platformApp.js, mounted at /api/v1 in app.js. Owns the full tenant
// middleware stack; nothing platform-related runs here, and nothing
// here runs for a platform-mounted request either — see app.js's
// module docstring for why that requires living on its own app rather
// than just being routes on a shared top-level one.
//
// Every route here is registered at a path RELATIVE to the eventual
// /api/v1 mount point (e.g. '/health', not '/api/v1/health') — app.js's
// app.use('/api/v1', createTenantApp()) supplies that prefix
// externally, same as the deleted Python version's tenant_app.py had
// no prefix of its own for the identical reason.
//
// A factory, not a pre-built singleton — Express's error-handling
// middleware only catches errors from routes registered *before* it
// in the stack (Express walks the middleware array forward-only when
// searching for the next matching layer after next(err), never
// backward). A test that needs to add its own route and still have
// errors from it reach the real error handler has to be able to
// insert that route before errorHandler is attached, not after — see
// tests/tenant-middleware.test.js's rollback-on-error test, which is
// exactly why `registerExtraRoutes` exists.
function createTenantApp({ registerExtraRoutes } = {}) {
  const app = express();

  // Outermost middleware within this app — registered first so every
  // other middleware and route, including /health below, runs inside
  // the request-scoped AsyncLocalStorage context it opens.
  app.use(requestContextMiddleware);

  app.use(express.json());

  // Minimal liveness + DB connectivity check — same purpose as the
  // original Python scaffold's /api/v1/health. Registered before
  // authMiddleware/tenantMiddleware on purpose: a liveness probe
  // shouldn't require a resolved tenant (or even a transaction) to
  // succeed, same as the Python version's /health not needing one.
  app.get('/health', asyncHandler(async (req, res) => {
    await appPool.query('SELECT 1');
    res.json({ status: 'ok' });
  }));

  // POST /invitations/accept — also registered before authMiddleware/
  // tenantMiddleware, same reasoning as /health: this route resolves
  // its own tenant scope from the invitation token itself (see
  // routes/invitations.js), not from anything tenantMiddleware would
  // resolve. It never reaches authMiddleware/tenantMiddleware at all.
  app.use(createInvitationsRouter());
  // POST /position-accounts/invitations/accept — same reasoning as
  // /invitations/accept above, own separate token/table.
  app.use(createPositionAccountInvitationsRouter());
  // POST /staff/invitations/accept — same reasoning as
  // /invitations/accept above, own separate token/table (D10,
  // RS-STF-001/002).
  app.use(createStaffInvitationsRouter());

  // AuthMiddleware before TenantMiddleware — resolveTenant reads
  // req.jwtClaims, which AuthMiddleware sets. Express runs app.use()
  // in the literal order it's called, so this is simply declaring
  // them in the order they must run; no inversion needed (see
  // middleware/auth.js's docstring for the contrast with the
  // Python/Starlette port).
  app.use(authMiddleware);
  app.use(asyncHandler(tenantMiddleware));
  // ADR-024: after tenantMiddleware so req.dbClient (the tenant-scoped
  // transaction) exists to read token_version through — see
  // middleware/sessionRevocation.js's own docstring for why this
  // ordering is load-bearing, not incidental.
  app.use(asyncHandler(sessionRevocationMiddleware));
  // Phase 1 (Capability Resolver integration): resolves
  // req.capabilities exactly once per request, after revocation has
  // already rejected a stale session — see middleware/identity.js.
  app.use(asyncHandler(identityMiddleware));

  // Proves the whole resolve -> set_tenant_context -> route-handler
  // pipeline actually reaches Postgres: reads current_setting() back
  // from the database itself, not any in-memory value TenantMiddleware
  // computed. A passing response is only possible if every step
  // actually ran, not just that the middleware thinks it did.
  app.get('/whoami', asyncHandler(async (req, res) => {
    const result = await req.dbClient.query(
      "SELECT current_setting('app.current_tenant', true) AS college_id",
    );
    const collegeId = result.rows[0] ? result.rows[0].college_id : null;
    if (!collegeId) {
      res.status(400).json({ detail: 'No tenant could be resolved for this request' });
      return;
    }
    res.json({ college_id: collegeId });
  }));

  // Ordinary tenant-scoped routes, registered after tenantMiddleware
  // like whoami above — not to be confused with AuthMiddleware.
  app.use(createAuthRouter());
  app.use(createPositionAccountsRouter());
  app.use(createConfigurationsRouter());
  app.use(createAiConfigRouter());
  app.use(createStudentsRouter());
  app.use(createStaffRouter());
  app.use(createClassesRouter());
  app.use(createFacultyAllocationRouter());
  app.use(createTimetablePeriodsRouter());
  app.use(createAttendanceRouter());
  app.use(createFinanceRouter());
  app.use(createDocumentsRouter());
  app.use(createDocumentCategoriesRouter());
  app.use(createReportsRouter());
  app.use(createBackgroundJobsRouter());
  app.use(createWorkflowRequestsRouter());
  app.use(createCollegeProfileRouter());
  app.use(createDepartmentsRouter());
  app.use(createStructuralAuthorizationKeysRouter());
  app.use(createAiRouter());
  app.use(createAnalyticsRouter());
  app.use(createNotificationsRouter());
  app.use(createAcademicYearsRouter());
  app.use(createCurriculumRouter());
  app.use(createExaminationRouter());
  app.use(createAssessmentsRouter());
  app.use(createWorkflowChainsRouter());
  app.use(createArchivalRouter());
  app.use(createCalendarRouter());
  app.use(createAdmissionDraftsRouter());
  app.use(createDocumentTypesRouter());
  app.use(createClassLogsRouter());
  app.use(createPersonalNotesRouter());
  app.use(createProjectsRouter());
  app.use(createConversationsRouter());
  app.use(createArtifactsRouter());
  app.use(createUserPreferencesRouter());
  app.use(createActivityTimelineRouter());
  app.use(createSearchRouter());
  app.use(createWorkspaceHeroRouter());

  if (typeof registerExtraRoutes === 'function') {
    registerExtraRoutes(app);
  }

  app.use(errorHandler);

  return app;
}

module.exports = createTenantApp;
