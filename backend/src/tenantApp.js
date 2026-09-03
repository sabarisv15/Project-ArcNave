'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { appPool } = require('./db/pool');
const asyncHandler = require('./middleware/asyncHandler');
const { requestContextMiddleware } = require('./middleware/requestContext');
const { authMiddleware } = require('./middleware/auth');
const { tenantMiddleware } = require('./middleware/tenant');
const { sessionRevocationMiddleware } = require('./middleware/sessionRevocation');
const { identityMiddleware } = require('./middleware/identity');
const errorHandler = require('./middleware/errorHandler');
const createAuthRouter = require('./routes/auth');
const createOpenApiRouter = require('./routes/openapi');
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
const createAiMemoryRouter = require('./routes/aiMemory');
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

  // Security headers (X-Frame-Options/CSP/HSTS/etc, helmet's own
  // defaults) — no launch blocker was ever about a specific header
  // here, this is standard baseline hardening for any HTTP surface.
  app.use(helmet());
  // CORS — a single explicit origin (config.frontendOrigin), never a
  // wildcard (see config.js's own comment on why). `credentials: true`
  // (ARCNAVE modernization P0, PDF 5.1 / clash C6) lets the browser
  // send/receive the httpOnly refresh-token cookie cross-origin — safe
  // specifically because the origin allow-list is a single explicit
  // value, never a wildcard; `cors` itself refuses to combine
  // `credentials: true` with `origin: '*'`. Access tokens are still
  // bearer-in-header (see security.js), unaffected by this.
  // allowedHeaders lists every custom header a real cross-origin
  // frontend request actually sends today: Authorization (the bearer
  // token), X-Request-ID (requestContext.js's own client-settable
  // correlation id), and Idempotency-Key (the AI tool-invoke
  // idempotency header — see routes/ai.js).
  app.use(
    cors({
      origin: config.frontendOrigin,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Idempotency-Key'],
    }),
  );
  app.use(cookieParser());

  // Path-scoped, ahead of the global default below — deliberately, not
  // incidentally. Pre-launch audit finding: body-parser's json
  // middleware sets req._body = true after it parses a body and every
  // later express.json() call in the chain just sees that flag and
  // no-ops (lib/read.js) — it does NOT re-parse with a different
  // limit. The 4 document-upload routes each used to carry their own
  // route-level `express.json({limit:'15mb'})`, but since the global
  // default below always ran FIRST for every request (registered
  // before any router), those route-level instances were silently
  // inert dead code — the global default's 100kb limit was the one
  // actually enforced, capping real uploads to ~75kb of raw file after
  // base64 overhead. Registering this narrower, larger-limit instance
  // for exactly this one path prefix BEFORE the global default fixes
  // it correctly: /documents/* requests get parsed here (real 15mb),
  // the global default below then no-ops for them (req._body already
  // true), and every other route is completely unaffected — still the
  // same 100kb default it always had.
  app.use('/documents', express.json({ limit: '15mb' }));
  app.use(express.json());

  // Minimal liveness + DB connectivity check — same purpose as the
  // original Python scaffold's /api/v1/health. Registered before
  // authMiddleware/tenantMiddleware on purpose: a liveness probe
  // shouldn't require a resolved tenant (or even a transaction) to
  // succeed, same as the Python version's /health not needing one.
  app.get(
    '/health',
    asyncHandler(async (req, res) => {
      await appPool.query('SELECT 1');
      // ARCNAVE modernization P3 (D1) — pull-based pool-exhaustion
      // visibility, same live gauges tenantConnection.js's own
      // db_pool_contention warning reads. Cheap (property reads, no
      // extra query) and additive — `status: 'ok'` is unchanged for
      // every existing caller of this endpoint.
      res.json({
        status: 'ok',
        pool: { total: appPool.totalCount, idle: appPool.idleCount, waiting: appPool.waitingCount },
      });
    }),
  );

  // ARCNAVE modernization P1 (PDF 4.8) — generated API documentation,
  // same "no tenant/transaction needed" reasoning as /health above:
  // reading the schema shape a route enforces isn't tenant data.
  app.use(createOpenApiRouter());

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
  app.get(
    '/whoami',
    asyncHandler(async (req, res) => {
      const result = await req.dbClient.query("SELECT current_setting('app.current_tenant', true) AS college_id");
      const collegeId = result.rows[0] ? result.rows[0].college_id : null;
      if (!collegeId) {
        res.status(400).json({ detail: 'No tenant could be resolved for this request' });
        return;
      }
      res.json({ college_id: collegeId });
    }),
  );

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
  app.use(createAiMemoryRouter());
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
