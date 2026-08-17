'use strict';

// Resolves the exact follow-up the Module 5 migration's own comment
// named: "A later migration, once Module 6 creates `documents`, must
// add ALTER TABLE fee_payments ADD CONSTRAINT
// fee_payments_receipt_document_id_fkey FOREIGN KEY
// (receipt_document_id) REFERENCES documents(id)." `documents` now
// exists (Module 6's first slice) — this is that already-planned
// unblock, nothing else touched in fee_payments.
//
// No NOT VALID / VALIDATE split: this is a dev-only schema with no
// production data to worry about violating the new constraint.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE fee_payments
        ADD CONSTRAINT fee_payments_receipt_document_id_fkey
        FOREIGN KEY (receipt_document_id) REFERENCES documents(id)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE fee_payments
        DROP CONSTRAINT IF EXISTS fee_payments_receipt_document_id_fkey
  `);
};
