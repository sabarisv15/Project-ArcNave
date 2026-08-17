'use strict';

// Central role -> permission mapping — replaces the flat, scattered
// requireRole('a', 'b') string-list checks every route embedded
// individually. PERMISSION_ROLES is the single source of truth: each
// entry lists exactly the roles requireRole(...) named at that route
// before this refactor (see the route comment on each line below), so
// this table reproduces existing access behavior exactly — a
// refactor, not a policy change. Any future change to "who may do X"
// is now a one-line edit here, not a hunt through route files.
//
// A static, code-level config, not a DB table: nothing in
// BusinessRules.md gives any tenant a reason to customize who holds
// which permission today — every role's capabilities are fixed
// platform-wide. A `role_permissions` table (with a migration) is the
// natural next step if/when a real per-tenant customization need
// shows up; a speculative migration for a need that doesn't exist yet
// would be exactly the premature complexity CLAUDE.md warns against.
//
// Permission names are `resource.action` (or `resource.subresource.action`),
// not `resource.write` — routes/actions that happen to share the same
// role set today (nearly everything here is principal-only) still get
// distinct names, because the entire point of a permission model is
// that one action's role set can change later without that change
// leaking into an unrelated action that happens to look identical
// today.

const PERMISSION_ROLES = {
  // routes/academicYears.js — BusinessRules.md Academic Year: "only the
  // Principal may request lifecycle transitions." Reads are requireAuth
  // (any authenticated tenant user), not gated here.
  'academic_years.create': ['principal'],
  'academic_years.activate': ['principal'],
  'academic_years.complete': ['principal'],

  // routes/analytics.js — GET /analytics/attendance-rate. Widened
  // 2026-07-26 (UAT discovery, Class Tutor dashboard) from
  // ['principal', 'hod'] to include 'staff': the route now calls
  // analyticsService.getAttendanceRateForActor, the same actor-scoped
  // resolver the AI tool (attendance_summary) already used — a staff/
  // class_tutor caller only ever sees their own taught/tutored
  // class(es), never another tutor's, so this is not a widening of what
  // data is reachable, only of who may reach the same already-scoped
  // view the AI could already answer.
  //
  // Capability Coverage Audit finding (2026-07-26, same session): a
  // genuine Class Tutor Position Account seat login's effectiveRole is
  // 'class_tutor', not 'staff' — the same "seat login gets a flat 403
  // before the service's own ownership check ever runs" bug already
  // fixed for students.*/RS-TTB-001, just not yet fixed on this route.
  // 'class_tutor' added alongside 'staff' for the same reason.
  'analytics.attendance_rate.read': ['principal', 'hod', 'staff', 'class_tutor'],

  // routes/backgroundJobs.js
  'background_jobs.create': ['principal'],
  // GET routes (this session's own task): background jobs are an
  // operational/internal concern (job status, error text) — no
  // BusinessRules.md rule names ordinary staff/hod as needing this,
  // same conservative-default reasoning finance.js's own writes use.
  'background_jobs.read': ['principal'],

  // routes/classes.js — POST/PUT/DELETE /classes
  'classes.create': ['principal'],
  'classes.update': ['principal'],
  'classes.delete': ['principal'],
  'classes.promote_semester': ['principal', 'hod'],
  // Phase 2 step 18: POST/PUT /classes/:id/tutor — BusinessRules.md
  // Staff: "Class Tutor is assigned only by HOD" (own department,
  // service-layer-enforced via visibilityService.assertIsHodOfDepartment
  // — this permission only gates the role, not the department scope).
  'classes.assign_tutor': ['hod'],

  // routes/collegeProfile.js — GET/PUT /college-profile. Moved from
  // college_admin to principal: college_admin is no longer a tenant
  // users.role (BusinessRules.md's College Admin — final model: an
  // ARCNAVE support employee, not a seat in any tenant's users table
  // — see Staff/Multi-tenancy). College profile maintenance is now a
  // Principal duty in-tenant.
  'college_profile.read': ['principal'],
  'college_profile.update': ['principal'],

  // routes/configurations.js — PUT /configurations/:category
  'configurations.update': ['principal'],

  // routes/calendar.js — POST/PUT/DELETE /calendar-events (task #20,
  // BusinessRules.md Platform administration, Academic Calendar).
  // Reads are requireAuth-only (any tenant user); writes are
  // Principal-only, same conservative default as configurations.update
  // above.
  'calendar.write': ['principal'],

  // routes/aiConfig.js — GET/PUT /ai-config
  'ai_config.read': ['principal'],
  'ai_config.update': ['principal'],

  // routes/departments.js — GET/POST/PUT/DELETE /departments. Moved
  // from college_admin to principal — see the college_profile note
  // above.
  'departments.read': ['principal'],
  'departments.create': ['principal'],
  'departments.update': ['principal'],
  'departments.delete': ['principal'],
  'hod_in_charge.appoint': ['principal'],

  // routes/structuralAuthorizationKeys.js — RS-GOV-005/006: only L1
  // (principal) generates or cancels a structural authorization key.
  'structural_authorization_keys.create': ['principal'],
  'structural_authorization_keys.cancel': ['principal'],

  // routes/documents.js
  'documents.upload': ['principal'],
  // Template upload moved from college_admin to principal — see the
  // college_profile note above.
  'documents.templates.upload': ['principal'],
  // Institution-wide Curriculum/Circulars uploads (ARCNAVE AI's own
  // upload+browse task) — a dedicated permission, not a widening of
  // documents.upload: the user explicitly asked for hod/staff reach
  // here without loosening the existing (principal-only) per-student
  // upload path.
  'documents.institutional.upload': ['principal', 'hod', 'staff'],
  // routes/documentCategories.js — Institutional Documents Phase 1.
  // Categories are institution-wide taxonomy (Curriculum, Circulars,
  // ...), same "structural, college-wide config" reasoning
  // departments.create/college_profile.update already use for
  // principal-only.
  'document_categories.manage': ['principal'],
  'documents.ocr.run': ['principal'],
  'documents.review': ['principal'],
  'documents.delete': ['principal'],

  // routes/facultyAllocation.js — POST/DELETE /faculty-allocation
  'faculty_allocation.create': ['principal'],
  'faculty_allocation.delete': ['principal'],

  // routes/finance.js — RS-FIN-002/003 (D4/D5, Stage 4): every write
  // route now names a real per-row actor (class tutor for first-entry
  // marking, the department's hod for correction approval) that a
  // role-only permission key can't express — financeService itself is
  // the gate, same reasoning routes/staff.js's deactivate/invite routes
  // already establish. No requirePermission entries here at all.

  // routes/notifications.js (Module 8 second slice — human-facing
  // route for the ledger) — same allowedRoles as the AI-tool path's
  // draft_notification/request_notification_send in aiToolRegistry.js,
  // so a human and an AI acting on a college's behalf have identical
  // reach; staff is excluded from both for the same reason: nothing in
  // BusinessRules.md's Notifications section names ordinary staff as a
  // drafter, only that drafts (human- or AI-origin) require Principal
  // approval before dispatch.
  'notifications.draft': ['principal', 'hod'],
  'notifications.submit': ['principal', 'hod'],
  'notifications.read': ['principal', 'hod'],

  // routes/classes.js's substitute-assignment INITIATE route used to
  // gate here (['hod', 'principal']) — removed under RS-CLS-007/ADL-004:
  // the real actor set is "absent staff / L3 / the class's L4," a
  // wider and differently-shaped set than a role list can express
  // (a hod of an unrelated department is not this rule's L3), and
  // approval is a separate, workflow-gated step besides. Both are now
  // requireAuth + a service-layer check, same "role check at the route
  // is not the real gate" split submit-for-approval already uses.
  // BusinessRules.md Automatic timetable generation names no actor for
  // triggering generation itself (only "HOD reviews and approves" the
  // result, already gated by the existing submit/approve chain) — same
  // conservative default other un-named-actor create actions in this
  // table use.
  //
  // RS-TTB-001 (this session) moved POST /classes/:id/generate-timetable
  // and /revise-timetable off requirePermission entirely — a genuine
  // Class Tutor Position Account seat login's effectiveRole is
  // 'class_tutor', a value that can never be added to a role-list
  // permission table like this one and also admit that login (this
  // table has no 'class_tutor' entry anywhere, on purpose — a seat
  // login's per-class ownership can't be expressed as "is this role
  // allowed," only "is this actor the tutor of THIS class," which only
  // a service-layer check like academicService.assertCanGenerateForClass
  // can answer). Both routes are requireAuth now, same as
  // submit-for-approval/send-alert above. This key is intentionally
  // removed, not left dangling.
  //
  // timetable_periods.generate_grid (RS-TTB-001 Section 1) stays here:
  // it writes college-wide timetable_periods rows with no per-class
  // ownership boundary to enforce — there is no department or class
  // dimension on a timetable_period row at all (see the GET route's
  // own comment), so a per-actor ownership check (like
  // academicService.assertCanGenerateForClass) has nothing to check
  // against here; a flat role list is the only shape that fits.
  //
  // Capability Coverage Audit finding (2026-07-26): 'staff'/'class_tutor'
  // were listed, which let any ordinary teacher (not just a tutor)
  // rewrite the whole college's shared bell schedule — this route has
  // the same blast radius as timetable_periods.create/import_csv/
  // delete below (all 'principal'-only), and 'staff'/'class_tutor' was
  // never true parity with those, just a copy-paste of the per-class
  // generate-timetable route's role reasoning onto a college-wide
  // config action that has no per-class scope to reason about.
  // Narrowed to principal/hod — hod kept because HOD already sits in
  // this table's escalated-administrative tier (e.g. the timetable
  // approval chain), ordinary staff/class_tutor have no business
  // reason named anywhere to redefine the shared bell schedule.
  'timetable_periods.generate_grid': ['principal', 'hod'],

  // routes/attendance.js — locking a session is an administrative
  // action (BusinessRules.md frames it as time-based/automatic, not a
  // named human actor — see attendanceService.lockAttendanceSession's
  // own comment); restricted to HOD/Principal rather than left open to
  // any authenticated user, pending a real scheduled-job trigger.
  // Correction submit/approve/reject are requireAuth, not gated here —
  // same "the service is the gate" reasoning the rest of this router
  // already uses for markAttendance.
  'attendance.lock': ['hod', 'principal'],

  // routes/curriculum.js — regulations/subjects are Principal-created
  // (BusinessRules.md doesn't name a different actor for this, same
  // conservative default other create/update/delete actions in this
  // table use); curriculum-migration submit/approve/reject are
  // requireAuth, not gated here — same "the service is the gate, not
  // requireRole" reasoning staff.js's submit-registration route uses.
  // routes/assessments.js — assessment types are institution-wide
  // configuration; mark entry/read/delete are requireAuth, gated by
  // assessmentService's own assigned-faculty check instead.
  'workflow_delegations.create': ['principal'],
  'archived_records.create': ['principal'],

  // Widened 2026-08-04, ADL-030/RS-ASM-012: any teaching staff member
  // may create/edit their own assessment type — the real per-class/
  // subject protection is assessmentService's own
  // assertHasTeachingAssignment (create) / creator-only check (update),
  // not the role list here.
  'assessment_types.create': ['staff', 'class_tutor', 'hod', 'principal'],
  'assessment_types.update': ['staff', 'class_tutor', 'hod', 'principal'],

  'regulations.create': ['principal'],
  'subjects.create': ['principal'],
  'subjects.update': ['principal'],
  'subjects.delete': ['principal'],

  // routes/reports.js — attendance/finance/assessment-marks reports
  // keep the original shared requireRole('principal') default;
  // BusinessRules.md names no different actor for those three.
  'reports.generate': ['principal'],

  // RS-CLS-005 (D21): student export's own Authority line is "any
  // timetable-linked staff member," not principal-only — separate
  // permission key from reports.generate above. reportService itself
  // still enforces the actual class-scoping (staff/hod see only their
  // visible classes' students; a staff member with zero timetable
  // links gets zero rows back, same as GET /students).
  // 'class_tutor' added alongside 'staff' for the same reason as
  // analytics.attendance_rate.read above — a Class Tutor seat is a
  // distinct effectiveRole from 'staff', not a superset of it.
  'reports.student_export': ['principal', 'hod', 'staff', 'class_tutor'],

  // routes/staff.js
  'staff.create': ['principal'],
  'staff.hod_accounts.create': ['principal'],
  'staff.update': ['principal'],
  'staff.delete': ['principal'],

  // 4-login authorization architecture (2026-08-09): 'staff' removed
  // from all three of students.create/update/delete. BusinessRules.md's
  // real rule is "the assigned Class Tutor creates/edits students for
  // their own class" — Class Tutor authority belongs to the L4 Position
  // Account login alone (actorRole === 'class_tutor'), never to a
  // personal Staff login, even for a person who currently occupies that
  // L4 seat (Position Occupancy is informational only — see
  // studentService.createStudent/assertCanModifyStudent's own
  // comments). This table only narrows who reaches the route at all;
  // the real scope/ownership check lives in the service, same split
  // this table has always documented — 'class_tutor' alone is
  // sufficient there now.
  'students.create': ['class_tutor'],
  'students.update': ['hod', 'principal', 'class_tutor'],
  'students.delete': ['hod', 'principal', 'class_tutor'],

  // routes/timetablePeriods.js
  'timetable_periods.create': ['principal'],
  'timetable_periods.import_csv': ['principal'],
  'timetable_periods.delete': ['principal'],
};

// Derived, not hand-maintained separately — keeping PERMISSION_ROLES
// as the one place a human edits avoids the two tables drifting apart
// the way the flat requireRole calls and this refactor's own audit
// just proved module docs already do.
const ROLE_PERMISSIONS = {};
for (const [permission, roles] of Object.entries(PERMISSION_ROLES)) {
  for (const role of roles) {
    if (!ROLE_PERMISSIONS[role]) ROLE_PERMISSIONS[role] = new Set();
    ROLE_PERMISSIONS[role].add(permission);
  }
}

function roleHasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[role];
  return Boolean(perms && perms.has(permission));
}

module.exports = { PERMISSION_ROLES, ROLE_PERMISSIONS, roleHasPermission };
