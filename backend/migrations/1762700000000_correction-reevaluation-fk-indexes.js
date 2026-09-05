'use strict';

// Round 10 P2/P3 finding: same gap 1761900000000_hot-path-indexes-followup.js
// closed for approval_history/fee_corrections — these three append-only
// ledger tables are also queried by their FK lookup key with no
// supporting index (attendanceCorrectionRepository.findBySessionId/
// findAppliedBySessionId: WHERE attendance_session_id = $1;
// assessmentMarkCorrectionRepository/assessmentMarkReevaluationRepository's
// own equivalents: WHERE assessment_mark_id = $1) — missed the original
// pass because all three were added to the schema afterward, same
// reason the followup migration itself exists. All three tables only
// grow (no deletes), so the missing-index cost compounds over time
// rather than staying flat.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(
    'CREATE INDEX attendance_corrections_attendance_session_id_idx ON attendance_corrections (attendance_session_id)',
  );
  pgm.sql(
    'CREATE INDEX assessment_mark_corrections_assessment_mark_id_idx ON assessment_mark_corrections (assessment_mark_id)',
  );
  pgm.sql(
    'CREATE INDEX assessment_mark_reevaluations_assessment_mark_id_idx ON assessment_mark_reevaluations (assessment_mark_id)',
  );
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS attendance_corrections_attendance_session_id_idx');
  pgm.sql('DROP INDEX IF EXISTS assessment_mark_corrections_assessment_mark_id_idx');
  pgm.sql('DROP INDEX IF EXISTS assessment_mark_reevaluations_assessment_mark_id_idx');
};
