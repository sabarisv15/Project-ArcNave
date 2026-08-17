'use strict';

// Backend Readiness Review finding: only 5 explicit CREATE INDEX
// statements existed across the whole schema before this migration —
// every other college_id-scoped table relied solely on the RLS
// policy predicate, which does not help the query planner for the
// second filter column real repository queries already use. Adding
// indexes only for columns a repository actually filters/joins on
// today (verified by grep against src/repositories/*.js), not
// speculative coverage for every column that might matter someday.

exports.shorthands = undefined;

exports.up = (pgm) => {
  // studentRepository.findByClassId: WHERE class_id = $1 AND deleted_at IS NULL
  pgm.sql('CREATE INDEX students_class_id_idx ON students (class_id) WHERE deleted_at IS NULL');

  // attendanceRepository: WHERE class_id = $1 AND session_date = $2 [AND hour_index = $3]
  pgm.sql('CREATE INDEX attendance_sessions_class_date_idx ON attendance_sessions (class_id, session_date)');

  // staffRepository.findByDepartmentId / findByCollegeDepartmentAndRole
  pgm.sql('CREATE INDEX staff_department_id_idx ON staff (department_id)');

  // classRepository: WHERE department_id = $1
  pgm.sql('CREATE INDEX classes_department_id_idx ON classes (department_id)');

  // facultyAllocationRepository.findByClassId / findByStaffUserId
  pgm.sql('CREATE INDEX faculty_allocation_class_id_idx ON faculty_allocation (class_id)');
  pgm.sql('CREATE INDEX faculty_allocation_staff_user_id_idx ON faculty_allocation (staff_user_id)');

  // workflowRepository.findPendingForEntity: WHERE entity_type = $1 AND entity_id = $2
  pgm.sql('CREATE INDEX workflow_requests_entity_idx ON workflow_requests (entity_type, entity_id)');
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS students_class_id_idx');
  pgm.sql('DROP INDEX IF EXISTS attendance_sessions_class_date_idx');
  pgm.sql('DROP INDEX IF EXISTS staff_department_id_idx');
  pgm.sql('DROP INDEX IF EXISTS classes_department_id_idx');
  pgm.sql('DROP INDEX IF EXISTS faculty_allocation_class_id_idx');
  pgm.sql('DROP INDEX IF EXISTS faculty_allocation_staff_user_id_idx');
  pgm.sql('DROP INDEX IF EXISTS workflow_requests_entity_idx');
};
