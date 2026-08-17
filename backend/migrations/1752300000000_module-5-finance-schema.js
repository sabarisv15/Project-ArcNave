'use strict';

// Module 5 (Finance), first vertical slice: `fee_structures` table
// only — no service/API/UI yet. See .ai/TASK.md.
//
// Unlike every prior module's first slice (classes, attendance_
// sessions), there is no real frontend screen to ground this ERD
// against — checked (see .ai/TASK.md): no fee/invoice/payment screen
// exists anywhere in frontend/src, only incidental text matches
// (CampusAICopilot.jsx's canned demo reply, DocumentPanel.jsx's
// scholarship-certificate upload *category*, CampusBrain.jsx's
// suggested-question chip). None of those are a working, wired
// screen the way StaffDashboard.jsx/TutorClass.jsx were for
// Attendance/Academic. This schema is built from BusinessRules.md's
// Finance section and Architecture.md's data-model conventions only
// — every shape decision below is flagged as an assumption, not
// silently guessed.
//
// fee_structures is a tenant table like every other in this schema:
// ENABLE + FORCE ROW LEVEL SECURITY and a tenant_isolation policy on
// college_id, filtered by current_setting('app.current_tenant',
// true) — same pattern, same reasoning (ADR-002), not reinvented.
//
// This is the fee DEFINITION (what a class owes for a given academic
// year, per fee category), not the per-student transactional record
// (what a specific student has paid/still owes). Same "structure
// before the transactional record" sequencing Module 3's classes
// slice used before Module 4's attendance_sessions slice — invoices/
// payments per student are a later Finance slice, not guessed at
// here.
//
// Grounded, resolved decisions:
//
// - status ('Pending Approval' | 'Approved' | 'Rejected', no CHECK
//   constraint): BusinessRules.md Finance states "Fee changes require
//   approval before taking effect" — directly analogous to
//   classes.timetable_status, which this column copies verbatim in
//   spirit: known values enforced at the service layer once
//   FinanceService exists (not built this slice), not the DB, same
//   house convention as timetable_status/users.role/
//   colleges.subscription_status. WorkflowService (Module 8) doesn't
//   exist yet, so nothing can really gate on this end-to-end today —
//   same open gap Module 3 flagged for timetable_status and Module 4
//   restated; not worked around here either.
// - deleted_at (soft-delete, resolved now, not left open like
//   students/staff/classes did): BusinessRules.md's AI section names
//   "fees" explicitly alongside attendance and marks — "The AI is
//   never given a hard-delete capability on attendance, fees, or
//   marks records, even with approval — only soft-delete (a flag/
//   timestamp)." Same treatment attendance_sessions.deleted_at got in
//   the Module 4 migration, for the identical reason: this is a named,
//   resolved rule, not a deferred one. The GRANT below omits DELETE
//   entirely, enforced at the DB permission level.
// - UNIQUE (college_id, academic_year, class_id, fee_category) WHERE
//   deleted_at IS NULL: a partial unique index, not a plain UNIQUE —
//   same reasoning attendance_sessions_class_date_hour_key already
//   established: a plain UNIQUE would permanently block ever
//   re-creating a fee line for the same class/year/category once one
//   copy of it was soft-deleted.
// - No Aadhaar column anywhere (CLAUDE.md rule 8).
//
// Flagged assumptions (no frontend to confirm against — real
// decisions, not guesses, but genuinely open until a later slice
// grounds them against a real screen or a product answer):
//
// - class_id is NOT NULL, scoping every fee line to one class for one
//   academic year — there is no "college-wide default fee" row in
//   this shape. A fee that's actually identical across every class in
//   a college would mean one fee_structures row per class with the
//   same amount, not a single null-class_id row. Assumed rather than
//   modeling a nullable "applies to all classes" row, because nothing
//   in BusinessRules.md or Architecture.md says whether fees are ever
//   defined below the class level (e.g. per-student overrides) or
//   above it (per-department/per-college), and inventing that
//   resolution without a real screen would be guessing silently.
// - academic_year is free TEXT, not a foreign key — there is no
//   academic_years table anywhere in this schema yet (Module 3 only
//   ever modeled `semester` as free TEXT on classes, never a
//   normalized academic-year entity). Matches that existing
//   convention rather than inventing a new normalized table this
//   slice doesn't need.
// - fee_category is free TEXT, not a foreign key to a normalized
//   category table (e.g. "Tuition", "Hostel", "Transport", "Lab") —
//   same "don't normalize what nothing queries that way yet"
//   reasoning Module 3's first slice used for classes.timetable_data
//   and Module 3's normalization slice restated for faculty_
//   allocation.subject staying free text.
// - No scholarship-eligibility table or column in this slice.
//   BusinessRules.md Finance's second rule — "Students below a
//   configured income threshold become scholarship eligible (exact
//   threshold is per-tenant config, not hardcoded)" — describes a
//   *computation* FinanceService will need to perform, not a new
//   table on its own: the threshold itself is "per-tenant config,"
//   which is exactly what the existing `configurations` JSONB table
//   (ConfigurationService, Module 0, already built) is for — see
//   Architecture.md 2.5's ConfigurationService row. This migration
//   does not add a Finance category row to that table (no service
//   consumes it yet, same restraint configurationService.js's own
//   file-level comment already documents for every category it
//   doesn't yet validate). A real, flagged gap, not built here: there
//   is no income field anywhere in this schema today — not on
//   `students` (checked: Module 1's migration has no income/family-
//   income column), not here. Computing "students below a threshold"
//   needs an income figure to compare against that does not exist yet
//   anywhere; a later Finance slice must add it (most likely on
//   `students`, since income is a per-student fact, not a per-fee-line
//   one) rather than this migration inventing a column nothing has
//   asked for the shape of.
// - No approved_by_user_id/approved_at columns, matching
//   classes.timetable_status's own precedent: Module 3's first slice
//   added timetable_status + timetable_remarks only, deferring who/
//   when approval columns to WorkflowService itself (Module 8) rather
//   than pre-building approval bookkeeping a real approval mechanism
//   doesn't exist yet to populate. `remarks` here mirrors
//   timetable_remarks for the same reason (a place for the approver's
//   free-text note once approval is real).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE fee_structures (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id      TEXT NOT NULL REFERENCES colleges(college_id),
        academic_year   TEXT NOT NULL,
        class_id        UUID NOT NULL REFERENCES classes(id),
        fee_category    TEXT NOT NULL,
        amount          NUMERIC(12, 2) NOT NULL,
        status          TEXT NOT NULL DEFAULT 'Pending Approval',
        remarks         TEXT,
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX fee_structures_college_year_class_category_key
        ON fee_structures (college_id, academic_year, class_id, fee_category)
        WHERE deleted_at IS NULL
  `);

  pgm.sql('ALTER TABLE fee_structures ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fee_structures FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON fee_structures
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  // No DELETE grant — soft-delete only (deleted_at), per
  // BusinessRules.md's AI section naming "fees" explicitly. See the
  // file-level comment above.
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON fee_structures TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS fee_structures');
};
