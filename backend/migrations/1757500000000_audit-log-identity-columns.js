'use strict';

// Identity-Architecture.md Audit Identity: an audit event records the
// Actor (user_id, already present) and, when the action was taken in
// a position context, the Acting Position Account and the Position
// itself, independently of one another (ADR-021). Both new columns
// are nullable — most actions today have no position context (Level
// 4/person-centric), and that is the ordinary case, not a gap.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_log
      ADD COLUMN position_account_id UUID REFERENCES position_accounts(id),
      ADD COLUMN position_id UUID REFERENCES positions(id)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE audit_log
      DROP COLUMN position_account_id,
      DROP COLUMN position_id
  `);
};
