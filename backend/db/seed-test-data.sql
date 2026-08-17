-- ARCNAVE — manual test data seed
--
-- Hand-run only. NOT executed automatically on container init (unlike
-- docker/postgres/init/*.sh, which provision roles) — this is sample
-- data for manually exercising the app, not schema. Safe to re-run:
-- the cleanup block at the top removes this exact tenant (college_id
-- 'demo') before recreating it, so running this file twice just resets
-- the demo tenant back to this same state, without touching any other
-- tenant's data.
--
-- HOW TO RUN
--   Local Docker Compose (arcnave-blueprint-db-1 container, matches
--   this repo's docker-compose.yml):
--     docker exec -i arcnave-blueprint-db-1 psql -U arcnave_admin -d arcnave < backend/db/seed-test-data.sql
--
--   Or against any reachable Postgres, using the migration
--   (arcnave_admin / table-owner) role — the same role
--   backend/scripts/migrate.js uses, via MIGRATION_DATABASE_URL:
--     psql "$MIGRATION_DATABASE_URL" -f backend/db/seed-test-data.sql
--
--   Must run AFTER migrations are applied (node scripts/migrate.js up)
--   — this file only inserts rows, it does not create any table.
--
-- LOGIN
--   College code: demo
--   Every seeded user shares the password: Test@1234
--   (real argon2id hash below, verified against backend/src/security.js's
--   actual hashPassword/verifyPassword — not a placeholder string)
--
--   Username         Role        Notes
--   ---------------  ----------  --------------------------------------
--   principal        principal   Final approval authority
--   hod.cse          hod         Head of CSE department
--   tutor.cse3a      staff       Class Tutor of CSE-3A (Approved timetable)
--   tutor.cse3b      staff       Class Tutor of CSE-3B (Pending HOD timetable)
--   staff.ece        staff       Regular ECE faculty, no tutor duty
--
-- WHAT'S SEEDED (one tenant, "demo", across every module built so far)
--   Module 0/2 — 1 college, 5 users, 4 staff profiles, 2 departments
--   Phase 1/2  — Position/Account/Occupant rows (ADR-021) for
--                principal (Level 1), hod.cse (Level 3, CSE dept),
--                tutor.cse3a/tutor.cse3b (Level 4, position_type=
--                'class_tutor') — every RBAC check
--                (identityService.resolveCapabilities) and the tutor-
--                of-record reads (assertCanMark, sendClassAlert, etc.)
--                resolve through these, not users.role or the long-gone
--                classes.tutor_user_id column.
--   Module 3   — 3 classes, 3 shared timetable periods, 3 faculty
--                allocations, 1 class's timetable_data JSONB grid
--   Module 1   — 6 students
--   Module 4   — 2 attendance sessions (CSE-3A only — the one
--                'Approved' class; attendance is locked behind an
--                Approved timetable, see BusinessRules.md)
--   Module 5   — 4 fee structures (mixed Approved/Pending Approval),
--                4 fee payments (mixed paid/not_paid)
--
--   Modules 6 (Documents & OCR) and 7 (Reports) exist in the schema
--   (documents, generated_reports) but have no sample rows here yet —
--   this file predates both; the cleanup block below still accounts
--   for them (in correct FK order) so re-running this file stays safe
--   even after a manual document/report gets created against the
--   'demo' tenant by hand.

BEGIN;

-- --- Cleanup (idempotent re-run) — same dependency order every
-- integration test's own cleanupTenant() already uses in this repo.
-- generated_reports and fee_payments both FK into documents
-- (document_id / receipt_document_id respectively), so both must be
-- deleted before documents. fee_corrections FKs into fee_payments, so
-- it goes first (D4/D5, Stage 4 — fee_structures no longer exists).
DELETE FROM platform_college_stats WHERE college_id = 'demo';
DELETE FROM audit_log            WHERE college_id = 'demo';
DELETE FROM fee_corrections      WHERE college_id = 'demo';
DELETE FROM fee_payments         WHERE college_id = 'demo';
DELETE FROM generated_reports    WHERE college_id = 'demo';
DELETE FROM documents            WHERE college_id = 'demo';
DELETE FROM document_categories  WHERE college_id = 'demo';
DELETE FROM attendance_sessions  WHERE college_id = 'demo';
DELETE FROM faculty_allocation   WHERE college_id = 'demo';
DELETE FROM timetable_periods    WHERE college_id = 'demo';
-- Position/Account/Occupant rows (ADR-021) FK into classes/departments/
-- users — deleted before all three. position_occupants/
-- position_department_assignments/position_class_assignments all FK
-- into position_accounts/positions, so those go first.
DELETE FROM position_occupants              WHERE college_id = 'demo';
DELETE FROM position_department_assignments WHERE college_id = 'demo';
DELETE FROM position_class_assignments      WHERE college_id = 'demo';
DELETE FROM position_accounts               WHERE college_id = 'demo';
DELETE FROM positions                       WHERE college_id = 'demo';
DELETE FROM classes               WHERE college_id = 'demo';
DELETE FROM departments           WHERE college_id = 'demo';
DELETE FROM staff                 WHERE college_id = 'demo';
-- student_lifecycle_events.student_id FK -> students (no ON DELETE
-- action), so events must go before students. Found live while
-- resetting demo data after archiving a test student through the
-- redesigned Students List page's Archive action.
DELETE FROM student_lifecycle_events WHERE college_id = 'demo';
DELETE FROM students              WHERE college_id = 'demo';
DELETE FROM refresh_tokens        WHERE college_id = 'demo';
-- student_admission_drafts.created_by_user_id FK -> users (no ON DELETE
-- action), so drafts must go before users. draft_documents cascade off
-- draft_id, so deleting drafts is enough for both tables.
DELETE FROM student_admission_drafts WHERE college_id = 'demo';
-- background_jobs.created_by_user_id FK -> users (no ON DELETE action)
-- — the admission wizard's async extraction job is the first real
-- writer of this table; a leftover job (e.g. from a live-tested
-- admission draft) blocked the users DELETE below with a real FK
-- violation, caught live while resetting demo data after an
-- admission-wizard acceptance test.
-- student_admission_draft_documents.extraction_job_id ON DELETE SET
-- NULL, so this is always safe regardless of draft/draft-document order.
DELETE FROM background_jobs       WHERE college_id = 'demo';
DELETE FROM users                 WHERE college_id = 'demo';
DELETE FROM configurations        WHERE college_id = 'demo';
DELETE FROM colleges              WHERE college_id = 'demo';

-- --- Module 0: college ---

INSERT INTO colleges (college_id, name, subdomain, subscription_status)
VALUES ('demo', 'ARCNAVE Demo College', 'demo', 'trial');

-- The same 7 default categories authService.acceptInvitation now seeds
-- for any real college on principal-invite accept — 'demo' never goes
-- through that flow (it's seeded directly here), so it needs its own
-- copy to exercise Institutional Documents / resolve_document_destination
-- against realistic data instead of an empty table.
INSERT INTO document_categories (college_id, name, slug) VALUES
  ('demo', 'Curriculum', 'curriculum'),
  ('demo', 'Circulars', 'circular'),
  ('demo', 'Academic Calendar', 'academic_calendar'),
  ('demo', 'Examination', 'examination'),
  ('demo', 'Policies', 'policies'),
  ('demo', 'Forms', 'forms'),
  ('demo', 'Notices', 'notices');

-- --- Module 0/2: users + staff profiles ---
-- Password for every seeded user: Test@1234
-- (argon2id, generated via this repo's own argon2 dependency and
-- verified with security.js's verifyPassword before use here)

INSERT INTO users (id, college_id, username, email, password_hash, role, is_active) VALUES
  ('32b4721e-e58a-4aa1-9c7d-81d5865be9b2', 'demo', 'principal',   'principal@demo.arcnave.test',   '$argon2id$v=19$m=65536,t=3,p=4$Go6udh/r+CqLjGaxzDa48g$iQU/4UvtsY9sYyCHaSfwY1UJ7qmEuZFwQ26ly/ohS3g', 'principal', true),
  ('6812023b-8a16-421a-b72f-095e8d565c52', 'demo', 'hod.cse',      'hod.cse@demo.arcnave.test',      '$argon2id$v=19$m=65536,t=3,p=4$Go6udh/r+CqLjGaxzDa48g$iQU/4UvtsY9sYyCHaSfwY1UJ7qmEuZFwQ26ly/ohS3g', 'hod',       true),
  ('fca0f803-f3fa-4f9d-a398-fe13fc235264', 'demo', 'tutor.cse3a',  'tutor.cse3a@demo.arcnave.test',  '$argon2id$v=19$m=65536,t=3,p=4$Go6udh/r+CqLjGaxzDa48g$iQU/4UvtsY9sYyCHaSfwY1UJ7qmEuZFwQ26ly/ohS3g', 'staff',     true),
  ('315a5a18-d4e6-4c81-b3fa-323b6e0c4839', 'demo', 'tutor.cse3b',  'tutor.cse3b@demo.arcnave.test',  '$argon2id$v=19$m=65536,t=3,p=4$Go6udh/r+CqLjGaxzDa48g$iQU/4UvtsY9sYyCHaSfwY1UJ7qmEuZFwQ26ly/ohS3g', 'staff',     true),
  ('076885d8-61c3-4fd3-ba1a-99cd587bd51b', 'demo', 'staff.ece',    'staff.ece@demo.arcnave.test',    '$argon2id$v=19$m=65536,t=3,p=4$Go6udh/r+CqLjGaxzDa48g$iQU/4UvtsY9sYyCHaSfwY1UJ7qmEuZFwQ26ly/ohS3g', 'staff',     true);

-- staff profiles — one per non-principal user (principal has no staff
-- row, same as this codebase's own real registration chains: Principal
-- is the apex approval role, not a "staff" profile). staff.id is left
-- to its own DEFAULT (gen_random_uuid()) — nothing else in this schema
-- FKs to staff(id) yet (see the Module 2 migration's own comment).
INSERT INTO staff (college_id, user_id, staff_code, full_name, gender, phone, department, designation, qualification, has_phd, aicte_id, joined_year) VALUES
  ('demo', '6812023b-8a16-421a-b72f-095e8d565c52', 'CSE-HOD-01', 'Dr. Lakshmi Narayanan', 'Female', '9840011223', 'CSE', 'Head of Department', 'Ph.D. Computer Science', true,  '1-98231001', 2012),
  ('demo', 'fca0f803-f3fa-4f9d-a398-fe13fc235264', 'CSE-042',    'Ananya Rao',            'Female', '9845201928', 'CSE', 'Assistant Professor', 'M.E. Computer Science', false, '1-45239103', 2018),
  ('demo', '315a5a18-d4e6-4c81-b3fa-323b6e0c4839', 'CSE-051',    'Ravi Shankar',          'Male',   '9886712340', 'CSE', 'Assistant Professor', 'M.Tech CSE',            false, '1-45239220', 2019),
  ('demo', '076885d8-61c3-4fd3-ba1a-99cd587bd51b', 'ECE-018',    'Karthik Subramaniam',   'Male',   '9900123456', 'ECE', 'Assistant Professor', 'M.E. Electronics',      false, '1-33221100', 2020);

-- --- Module 0: departments ---
-- Real department rows (position_department_assignments/classes.
-- department_id both FK here) — matches the free-text 'CSE'/'ECE'
-- classes.department values already used below and in staff's own
-- free-text department column, now given a real id both can reference.
INSERT INTO departments (id, college_id, name) VALUES
  ('6c342b99-5d3a-4d4b-8add-6376087773ab', 'demo', 'CSE'),
  ('5c3edb39-247c-4872-9145-244fac4dc5da', 'demo', 'ECE');

-- --- Module 3: classes, timetable periods, faculty allocation ---

-- CSE-3A: tutor assigned, timetable Approved (the one class Attendance
-- can actually be marked against — see BusinessRules.md's Academic/
-- Attendance dependency). timetable_data is the same headers/rows CSV-
-- style grid shape TutorClass.jsx's own display expects (see the
-- Module 3 migration's own comment) — populated here for exactly this
-- one class so the still-prototype timetable display has something
-- real-looking to render; CSE-3B/ECE-5A are left null on purpose,
-- matching their own "not there yet" narrative (Pending HOD / No Tutor).
-- Class Tutor is no longer a classes.tutor_user_id column (Phase 2) —
-- see the Position/Account/Occupant block below for CSE-3A/CSE-3B's
-- real Class Tutor assignment.
INSERT INTO classes (id, college_id, class_name, department, department_id, semester, timetable_status, timetable_data) VALUES
  ('32b5f155-c1a2-4054-b4b3-80bd8c4b3058', 'demo', '3rd Sem · CSE-A', 'CSE', '6c342b99-5d3a-4d4b-8add-6376087773ab', '3rd Sem', 'Approved',
   '{"headers": ["Day", "09:00 - 10:00", "10:00 - 11:00"], "rows": [["Monday", "Data Structures (Ananya Rao)", "Operating Systems (Ravi Shankar)"], ["Tuesday", "Database Systems (Ananya Rao)", "Free"]]}'::jsonb),
  ('f1302262-9b80-45ad-a0a7-adde9dcee2d0', 'demo', '3rd Sem · CSE-B', 'CSE', '6c342b99-5d3a-4d4b-8add-6376087773ab', '3rd Sem', 'Pending HOD', NULL),
  ('720f6755-0d08-4af5-a2cb-3f0732a8c550', 'demo', '5th Sem · ECE-A', 'ECE', '5c3edb39-247c-4872-9145-244fac4dc5da', '5th Sem', 'No Tutor',    NULL);

-- --- Position/Account/Occupant (ADR-021) ---
-- Every role RBAC (requirePermission) actually checks now resolves
-- through identityService.resolveCapabilities against these rows, not
-- users.role directly (Phase 1: Capability Resolver integration) — a
-- seeded principal/hod/tutor with no Position row resolves as plain,
-- no-position staff. principal (Level 1, college-wide), hod.cse
-- (Level 3, CSE department), tutor.cse3a/tutor.cse3b (Level 4,
-- position_type='class_tutor', one per class) — mirrors exactly what
-- authService.provisionLevel1PositionForNewPrincipal/
-- staffService.ensureHodPosition/classTutorService.assignClassTutor
-- each provision for real in the running app.
INSERT INTO positions (id, college_id, level, title, created_by, position_type) VALUES
  ('1a3f22a4-1b90-4356-9df3-972b6384ac16', 'demo', 1, 'Principal',    '32b4721e-e58a-4aa1-9c7d-81d5865be9b2', NULL),
  ('e60a55c5-2fb4-4a19-8121-297e6e5eeeff', 'demo', 3, 'HOD',          '32b4721e-e58a-4aa1-9c7d-81d5865be9b2', NULL),
  ('445b1f3b-392b-4a20-8ef1-4d32b04ce215', 'demo', 4, 'Class Tutor',  '6812023b-8a16-421a-b72f-095e8d565c52', 'class_tutor'),
  ('b5c199f4-935d-436f-83e1-0c5b8b7335bc', 'demo', 4, 'Class Tutor',  '6812023b-8a16-421a-b72f-095e8d565c52', 'class_tutor');

INSERT INTO position_accounts (id, college_id, position_id, official_email, password_hash) VALUES
  ('4f5b2bb9-4f54-4a66-9a0b-2ad06ced8699', 'demo', '1a3f22a4-1b90-4356-9df3-972b6384ac16', 'principal-position@demo.positions.internal',   '$argon2id$v=19$m=65536,t=3,p=4$Go6udh/r+CqLjGaxzDa48g$iQU/4UvtsY9sYyCHaSfwY1UJ7qmEuZFwQ26ly/ohS3g'),
  ('925d0986-bd1d-4ba0-8337-e27f2f289820', 'demo', 'e60a55c5-2fb4-4a19-8121-297e6e5eeeff', 'hod-cse-position@demo.positions.internal',      '$argon2id$v=19$m=65536,t=3,p=4$Go6udh/r+CqLjGaxzDa48g$iQU/4UvtsY9sYyCHaSfwY1UJ7qmEuZFwQ26ly/ohS3g'),
  ('40966ff8-f36c-466d-ac04-33cbe3a161a8', 'demo', '445b1f3b-392b-4a20-8ef1-4d32b04ce215', 'class-tutor-cse3a-position@demo.positions.internal', '$argon2id$v=19$m=65536,t=3,p=4$Go6udh/r+CqLjGaxzDa48g$iQU/4UvtsY9sYyCHaSfwY1UJ7qmEuZFwQ26ly/ohS3g'),
  ('f0e2bc6b-d7fe-46b7-886c-405c8cbb00dd', 'demo', 'b5c199f4-935d-436f-83e1-0c5b8b7335bc', 'class-tutor-cse3b-position@demo.positions.internal', '$argon2id$v=19$m=65536,t=3,p=4$Go6udh/r+CqLjGaxzDa48g$iQU/4UvtsY9sYyCHaSfwY1UJ7qmEuZFwQ26ly/ohS3g');

INSERT INTO position_department_assignments (college_id, position_id, department_id, assigned_by) VALUES
  ('demo', 'e60a55c5-2fb4-4a19-8121-297e6e5eeeff', '6c342b99-5d3a-4d4b-8add-6376087773ab', '32b4721e-e58a-4aa1-9c7d-81d5865be9b2');

-- BusinessRules.md Staff: "Class Tutor is assigned only by HOD" —
-- assigned_by is hod.cse, not the principal, matching
-- classTutorService.assignClassTutor's own actor.
INSERT INTO position_class_assignments (college_id, position_id, class_id, assigned_by) VALUES
  ('demo', '445b1f3b-392b-4a20-8ef1-4d32b04ce215', '32b5f155-c1a2-4054-b4b3-80bd8c4b3058', '6812023b-8a16-421a-b72f-095e8d565c52'),
  ('demo', 'b5c199f4-935d-436f-83e1-0c5b8b7335bc', 'f1302262-9b80-45ad-a0a7-adde9dcee2d0', '6812023b-8a16-421a-b72f-095e8d565c52');

INSERT INTO position_occupants (college_id, position_account_id, user_id, assigned_by) VALUES
  ('demo', '4f5b2bb9-4f54-4a66-9a0b-2ad06ced8699', '32b4721e-e58a-4aa1-9c7d-81d5865be9b2', '32b4721e-e58a-4aa1-9c7d-81d5865be9b2'),
  ('demo', '925d0986-bd1d-4ba0-8337-e27f2f289820', '6812023b-8a16-421a-b72f-095e8d565c52', '32b4721e-e58a-4aa1-9c7d-81d5865be9b2'),
  ('demo', '40966ff8-f36c-466d-ac04-33cbe3a161a8', 'fca0f803-f3fa-4f9d-a398-fe13fc235264', '6812023b-8a16-421a-b72f-095e8d565c52'),
  ('demo', 'f0e2bc6b-d7fe-46b7-886c-405c8cbb00dd', '315a5a18-d4e6-4c81-b3fa-323b6e0c4839', '6812023b-8a16-421a-b72f-095e8d565c52');

-- Shared, college-wide bell schedule (Module 3's own timetable-
-- normalization slice — one row per (day_of_week, hour_index), not per
-- class).
INSERT INTO timetable_periods (id, college_id, day_of_week, hour_index, start_time, end_time) VALUES
  ('c3df2e4e-6b10-4ae9-9c6c-4dd92cb2d397', 'demo', 'Monday',  1, '09:00', '10:00'),
  ('9d762a79-0a6f-4094-bba1-21e5e1d6db1d', 'demo', 'Monday',  2, '10:00', '11:00'),
  ('ba08cd25-f496-4f35-b92e-fb786a16b6a1', 'demo', 'Tuesday', 1, '09:00', '10:00');

-- Real, structured "who teaches what, when" link (what
-- AttendanceService's "scheduled staff member" authorization check
-- resolves against — see attendanceService.js's assertCanMark).
-- staff.ece (plain ECE faculty, no tutor duty — see the roster comment
-- above) had ZERO faculty_allocation rows before this line: not just
-- "their class has no students" like tutor.cse3a/tutor.cse3b's own gap,
-- but no visible class at all, so Students/Assessments ever showed an
-- empty roster for this login. Allocated to the one ECE class
-- (720f6755, '5th Sem · ECE-A') that otherwise had no faculty rows
-- either, reusing an existing shared bell-schedule period — both
-- (class_id, period_id) and (period_id, staff_user_id) uniqueness are
-- untouched since neither this class nor this staff member appears in
-- any other faculty_allocation row.
INSERT INTO faculty_allocation (college_id, class_id, period_id, subject, staff_user_id) VALUES
  ('demo', '32b5f155-c1a2-4054-b4b3-80bd8c4b3058', 'c3df2e4e-6b10-4ae9-9c6c-4dd92cb2d397', 'Data Structures',   'fca0f803-f3fa-4f9d-a398-fe13fc235264'),
  ('demo', '32b5f155-c1a2-4054-b4b3-80bd8c4b3058', '9d762a79-0a6f-4094-bba1-21e5e1d6db1d', 'Operating Systems', '315a5a18-d4e6-4c81-b3fa-323b6e0c4839'),
  ('demo', 'f1302262-9b80-45ad-a0a7-adde9dcee2d0', 'ba08cd25-f496-4f35-b92e-fb786a16b6a1', 'Database Systems',  'fca0f803-f3fa-4f9d-a398-fe13fc235264'),
  ('demo', '720f6755-0d08-4af5-a2cb-3f0732a8c550', 'ba08cd25-f496-4f35-b92e-fb786a16b6a1', 'Electronics I',     '076885d8-61c3-4fd3-ba1a-99cd587bd51b');

-- --- Module 1: students ---
-- class_id scopes a student to a class/department for the Students List
-- (department/year/semester/section all resolve off the class row via
-- studentRepository's own LEFT JOIN classes) — left NULL for most of
-- this roster on purpose (an unscoped-student state is real and worth
-- keeping seeded), except Sneha Pillai below, who is assigned into
-- ECE-5A specifically so staff.ece's own class has a real student in it
-- (see the faculty_allocation row just added above).

INSERT INTO students (id, college_id, roll_no, full_name, gender, entry_type, emis_number, email, phone, parent_name, parent_phone, address, pincode, mark_10th, mark_12th, accommodation, club, career_plan) VALUES
  ('1ebeb5dc-03eb-467b-92f9-853f83903142', 'demo', 'CSE21001', 'Aarav Sharma',      'Male',   'Regular', '33021004521', 'aarav.sharma@demo.arcnave.test',   '9988776601', 'Suresh Sharma',   '9988776001', 'Plot 12, Anna Nagar, Chennai',     '600040', '92%',    '88%', 'Day Scholar', 'NCC',  'Higher Studies'),
  ('816d0773-2d3a-4e7d-9c73-6222421dd1f6', 'demo', 'CSE21002', 'Priya Venkatesh',  'Female', 'Regular', '33021004522', 'priya.venkatesh@demo.arcnave.test', '9988776602', 'Venkatesh Iyer',  '9988776002', 'Flat 4B, T Nagar, Chennai',        '600017', '94%',    '90%', 'Hosteller',   'NSS',  'Job'),
  ('b041741a-959c-4ca7-9da6-33f5ed01a7aa', 'demo', 'CSE21003', 'Mohammed Faisal',  'Male',   'Regular', '33021004523', 'mohammed.faisal@demo.arcnave.test', '9988776603', 'Abdul Kareem',    '9988776003', 'No. 8, Triplicane, Chennai',       '600005', '88%',    '85%', 'Day Scholar', 'None', 'Job'),
  ('6cd484be-0420-49ac-832e-569413315d4f', 'demo', 'CSE21004', 'Divya Ramesh',     'Female', 'Lateral Entry', '33021004524', 'divya.ramesh@demo.arcnave.test', '9988776604', 'Ramesh Kumar', '9988776004', 'Plot 21, Velachery, Chennai',      '600042', '460/500','528/600', 'Day Scholar', 'YRC',  'Entrepreneurship'),
  ('dae9156d-fab5-44d6-b06e-fd00a53520ab', 'demo', 'CSE21005', 'Karthik Raja',     'Male',   'Regular', '33021004525', 'karthik.raja@demo.arcnave.test',   '9988776605', 'Raja Mohan',      '9988776005', 'No. 15, Adyar, Chennai',           '600020', '90%',    '86%', 'Hosteller',   'Sports','Job'),
  ('6851d953-ca4e-40cf-9a73-20b208b019a7', 'demo', 'ECE21001', 'Sneha Pillai',     'Female', 'Regular', '33021004526', 'sneha.pillai@demo.arcnave.test',   '9988776606', 'Pillai Nair',     '9988776006', 'Flat 2A, Mylapore, Chennai',       '600004', '91%',    '89%', 'Day Scholar', 'Rotaract','Higher Studies');

UPDATE students SET class_id = '720f6755-0d08-4af5-a2cb-3f0732a8c550' WHERE id = '6851d953-ca4e-40cf-9a73-20b208b019a7' AND college_id = 'demo';

-- --- Module 4: attendance sessions ---
-- CSE-3A only: it's the one 'Approved' class (attendance is locked
-- behind timetable_status == 'Approved', CLAUDE.md rule 7). Marked by
-- the real class tutor, matching one of BusinessRules.md's three
-- eligible markers.

INSERT INTO attendance_sessions (college_id, class_id, session_date, hour_index, marked_by_user_id, absent_student_ids, total_students) VALUES
  ('demo', '32b5f155-c1a2-4054-b4b3-80bd8c4b3058', CURRENT_DATE,     1, 'fca0f803-f3fa-4f9d-a398-fe13fc235264', '["1ebeb5dc-03eb-467b-92f9-853f83903142"]'::jsonb, 5),
  ('demo', '32b5f155-c1a2-4054-b4b3-80bd8c4b3058', CURRENT_DATE - 1, 1, 'fca0f803-f3fa-4f9d-a398-fe13fc235264', '[]'::jsonb,                                        5);

-- --- Module 5: fee payments ---
-- RS-FIN-001/004 (D4, Stage 4): no fee_structures/amount concept left
-- — one Paid/Not-Paid flag per student (fee_payments_student_id_key),
-- mixing both states. Manual flags only (no amount/ledger fields),
-- marked by the principal.
INSERT INTO fee_payments (college_id, student_id, status, marked_by_user_id) VALUES
  ('demo', '1ebeb5dc-03eb-467b-92f9-853f83903142', 'paid',     '32b4721e-e58a-4aa1-9c7d-81d5865be9b2'),
  ('demo', '816d0773-2d3a-4e7d-9c73-6222421dd1f6', 'not_paid', '32b4721e-e58a-4aa1-9c7d-81d5865be9b2'),
  ('demo', 'b041741a-959c-4ca7-9da6-33f5ed01a7aa', 'paid',     '32b4721e-e58a-4aa1-9c7d-81d5865be9b2'),
  ('demo', '6cd484be-0420-49ac-832e-569413315d4f', 'not_paid', '32b4721e-e58a-4aa1-9c7d-81d5865be9b2');

COMMIT;
