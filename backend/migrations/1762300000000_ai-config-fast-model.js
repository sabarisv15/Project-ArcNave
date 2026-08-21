'use strict';

// Model routing (P1.3 of the AI capability roadmap, CHECKPOINT.md) —
// a small/cheap model for the low-risk half of an askAgent turn (the
// natural-language summary of an already-fetched, already-Policy-
// Gated L1 read — R0/R1 on the risk ladder), the college's own
// configured `model` for everything else. Nullable, additive: a
// college with no fast_model set gets byte-for-byte the same single-
// model behavior as before (aiService only switches models when this
// is actually populated).
//
// Deliberately NOT applied to the tool-select call (completeWithTools)
// — round 2's own finding, preserved in CHECKPOINT.md: call #1 has no
// risk signal yet (nothing has been chosen to route on) and must never
// be downgraded below the currently-validated tier, given documented
// evidence the 8B default model needed real prompt-engineering fixes
// for basic tool-selection discipline. Routing only ever targets call
// #2 (the synthesis/summary call), after the tool (and its riskLevel)
// is already known.

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE college_ai_config ADD COLUMN fast_model TEXT');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE college_ai_config DROP COLUMN fast_model');
};
