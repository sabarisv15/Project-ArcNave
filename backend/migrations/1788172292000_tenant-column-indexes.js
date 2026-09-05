'use strict';

// ARCNAVE modernization P1 (PDF D2: "confirm 'forced' [RLS] on every
// table; add matching indexes"). RLS-forced isolation itself was
// verified already-correct on every table (live query against
// pg_class.relforcerowsecurity, 2026-08-31 — zero tables with RLS
// enabled but not forced). The gap D2 actually names is this one:
// every query against these 60 tables is implicitly
// filtered by college_id via the RLS policy predicate on every single
// call, yet none of them had an index with college_id as the leading
// column — so that filter falls back to a full table scan under RLS,
// which gets worse as each tenant's data grows, unlike the ~7 tables
// hot-path-indexes.js (1756300000000) already covered for their own
// query-pattern-specific columns (a different, narrower finding).
//
// CONCURRENTLY (D5's own "build indexes without blocking") + IF NOT
// EXISTS (idempotent against a partial prior run) + noTransaction()
// (CONCURRENTLY cannot run inside a transaction block at all — a
// migration-runner-wrapped transaction would make every statement
// below fail outright, not just block longer).
//
// Table list generated from a live query against pg_class/pg_index,
// not hand-typed.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.noTransaction();

  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_document_chunks_college_id_idx ON ai_document_chunks (college_id)',
  );
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_general_memory_college_id_idx ON ai_general_memory (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_memory_consent_college_id_idx ON ai_memory_consent (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_scoped_memory_college_id_idx ON ai_scoped_memory (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS approval_history_college_id_idx ON approval_history (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS artifact_versions_college_id_idx ON artifact_versions (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS artifacts_college_id_idx ON artifacts (college_id)');
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS assessment_mark_corrections_college_id_idx ON assessment_mark_corrections (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS assessment_mark_reevaluations_college_id_idx ON assessment_mark_reevaluations (college_id)',
  );
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS assessment_marks_college_id_idx ON assessment_marks (college_id)');
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS assessment_submissions_college_id_idx ON assessment_submissions (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS attachment_intelligence_college_id_idx ON attachment_intelligence (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS attendance_absence_flags_college_id_idx ON attendance_absence_flags (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS attendance_corrections_college_id_idx ON attendance_corrections (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS attendance_sessions_college_id_idx ON attendance_sessions (college_id)',
  );
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_college_id_idx ON audit_log (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS background_jobs_college_id_idx ON background_jobs (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS class_logs_college_id_idx ON class_logs (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS college_campuses_college_id_idx ON college_campuses (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_college_id_idx ON conversations (college_id)');
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS exam_timetable_versions_college_id_idx ON exam_timetable_versions (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS faculty_allocation_college_id_idx ON faculty_allocation (college_id)',
  );
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS fee_corrections_college_id_idx ON fee_corrections (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS fee_payments_college_id_idx ON fee_payments (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS generated_reports_college_id_idx ON generated_reports (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_college_id_idx ON messages (college_id)');
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS notification_delivery_college_id_idx ON notification_delivery (college_id)',
  );
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_college_id_idx ON notifications (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS ocr_results_college_id_idx ON ocr_results (college_id)');
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS password_reset_tokens_college_id_idx ON password_reset_tokens (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS personal_document_folders_college_id_idx ON personal_document_folders (college_id)',
  );
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS personal_notes_college_id_idx ON personal_notes (college_id)');
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS position_account_mfa_otps_college_id_idx ON position_account_mfa_otps (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS position_account_refresh_tokens_college_id_idx ON position_account_refresh_tokens (college_id)',
  );
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS position_accounts_college_id_idx ON position_accounts (college_id)');
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS position_class_assignments_college_id_idx ON position_class_assignments (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS position_department_assignments_college_id_idx ON position_department_assignments (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS position_occupants_college_id_idx ON position_occupants (college_id)',
  );
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS positions_college_id_idx ON positions (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS project_documents_college_id_idx ON project_documents (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS projects_college_id_idx ON projects (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS refresh_tokens_college_id_idx ON refresh_tokens (college_id)');
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS scholarship_decisions_college_id_idx ON scholarship_decisions (college_id)',
  );
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS staff_phone_otps_college_id_idx ON staff_phone_otps (college_id)');
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS staff_work_history_college_id_idx ON staff_work_history (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS student_admission_draft_documents_college_id_idx ON student_admission_draft_documents (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS student_admission_drafts_college_id_idx ON student_admission_drafts (college_id)',
  );
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS student_flags_college_id_idx ON student_flags (college_id)');
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS student_lifecycle_events_college_id_idx ON student_lifecycle_events (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS student_phone_otps_college_id_idx ON student_phone_otps (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS student_semester_results_college_id_idx ON student_semester_results (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS student_transfer_requests_college_id_idx ON student_transfer_requests (college_id)',
  );
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS subjects_college_id_idx ON subjects (college_id)');
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS substitute_assignment_acknowledgements_college_id_idx ON substitute_assignment_acknowledgements (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS substitute_assignment_requests_college_id_idx ON substitute_assignment_requests (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS substitute_assignments_college_id_idx ON substitute_assignments (college_id)',
  );
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS timetable_revisions_college_id_idx ON timetable_revisions (college_id)',
  );
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS user_mfa_otps_college_id_idx ON user_mfa_otps (college_id)');
  pgm.sql('CREATE INDEX CONCURRENTLY IF NOT EXISTS user_preferences_college_id_idx ON user_preferences (college_id)');
  pgm.sql(
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS workflow_delegations_college_id_idx ON workflow_delegations (college_id)',
  );
};

exports.down = (pgm) => {
  pgm.noTransaction();

  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS ai_document_chunks_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS ai_general_memory_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS ai_memory_consent_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS ai_scoped_memory_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS approval_history_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS artifact_versions_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS artifacts_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS assessment_mark_corrections_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS assessment_mark_reevaluations_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS assessment_marks_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS assessment_submissions_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS attachment_intelligence_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS attendance_absence_flags_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS attendance_corrections_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS attendance_sessions_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS audit_log_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS background_jobs_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS class_logs_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS college_campuses_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS conversations_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS exam_timetable_versions_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS faculty_allocation_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS fee_corrections_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS fee_payments_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS generated_reports_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS messages_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS notification_delivery_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS notifications_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS ocr_results_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS password_reset_tokens_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS personal_document_folders_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS personal_notes_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS position_account_mfa_otps_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS position_account_refresh_tokens_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS position_accounts_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS position_class_assignments_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS position_department_assignments_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS position_occupants_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS positions_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS project_documents_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS projects_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS refresh_tokens_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS scholarship_decisions_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS staff_phone_otps_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS staff_work_history_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS student_admission_draft_documents_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS student_admission_drafts_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS student_flags_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS student_lifecycle_events_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS student_phone_otps_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS student_semester_results_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS student_transfer_requests_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS subjects_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS substitute_assignment_acknowledgements_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS substitute_assignment_requests_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS substitute_assignments_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS timetable_revisions_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS user_mfa_otps_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS user_preferences_college_id_idx');
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS workflow_delegations_college_id_idx');
};
