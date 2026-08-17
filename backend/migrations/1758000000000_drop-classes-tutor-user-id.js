'use strict';

// Phase 2 (Position Account Auth) step 20, Migration D: drops
// classes.tutor_user_id now that every reader/writer has migrated onto
// the Position/Account/Occupant model (steps 11-18) and
// `grep -rn tutor_user_id backend/src` returns nothing outside this
// migration file and classRepository.js's own historical comments.
// classTutorService.assignClassTutor/reassignClassTutor
// (position_class_assignments) is the sole path that sets a class's
// tutor now — see docs/architecture/Phase2-Position-Account-Auth-Plan.md.
//
// down() re-adds the column, its UNIQUE (classes_tutor_user_id_key) and
// FK (classes_tutor_user_id_fkey) constraints, but does NOT attempt to
// backfill data from position_class_assignments — a real, non-lossless
// rollback, documented here rather than silently pretended otherwise
// (the plan's own explicit amendment to a literal "reversible"
// migration).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE classes DROP CONSTRAINT classes_tutor_user_id_key');
  pgm.sql('ALTER TABLE classes DROP CONSTRAINT classes_tutor_user_id_fkey');
  pgm.sql('ALTER TABLE classes DROP COLUMN tutor_user_id');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE classes ADD COLUMN tutor_user_id UUID');
  pgm.sql('ALTER TABLE classes ADD CONSTRAINT classes_tutor_user_id_key UNIQUE (tutor_user_id)');
  pgm.sql('ALTER TABLE classes ADD CONSTRAINT classes_tutor_user_id_fkey FOREIGN KEY (tutor_user_id) REFERENCES users(id)');
};
