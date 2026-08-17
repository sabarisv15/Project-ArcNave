'use strict';

// Students List redesign (2026-07-30): staff may optionally attach the
// student's official result copy as evidence when recording a semester
// result (student_semester_results, same migration set). Reuses the
// existing document_type_registry (1758500000000) and the existing,
// unchanged documentService.uploadDocument — this migration only adds
// a row, it does not touch storage or extraction logic.
//
// ocr_enabled: false — result-copy layouts vary too widely
// institution-to-institution to extract reliably today, and RS-ASM's
// own "no institutional internal mark calculation" rule means nothing
// downstream would consume an extracted mark anyway. required: false —
// the result itself (Pass/RA) is staff-entered directly; the document
// is supporting evidence, not a precondition for entry.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO document_type_registry (key, label, module, required, ocr_enabled, extraction_field_targets, sort_order) VALUES
      ('semester_result_copy', 'Semester Result Copy', 'student_result', false, false, '[]'::jsonb, 1)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM document_type_registry WHERE key = 'semester_result_copy'`);
};
