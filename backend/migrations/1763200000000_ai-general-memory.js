'use strict';

// General freeform AI Memory (product decision, this round): the existing
// ai_scoped_memory table only ever holds ONE value per (user, memory_type)
// from a fixed, bounded allowlist — real for "how do you like answers
// formatted," but not what a genuinely freeform "remember things I tell
// you" feature needs (many independent facts, not one slot per named
// category). This is a second, separate table rather than a reshape of
// ai_scoped_memory's own UNIQUE(user_id, memory_type) shape, which a
// many-facts-per-user model would just break.
//
// Shares the SAME consent gate as ai_scoped_memory (ai_memory_consent —
// no second toggle to confuse "is AI Memory on" into two questions) and
// the same safety posture aiMemoryService.js's own file comment already
// established: only the acting user's own account may ever write here
// (aiMemoryService.rememberFact, called only from the AI tool, itself
// gated on consent), consent can only be granted/revoked by a human
// directly (routes/aiMemory.js), and revoking it deletes every row here
// too, immediately.
//
// This table is deliberately NOT where a general "remember anything"
// design would stop: aiMemoryService.js's own MAX_GENERAL_FACTS bounds
// how much can accumulate (an unbounded store was the exact "unbounded/
// unauditable PII retention risk" the earlier, narrower design avoided —
// bounding it here keeps that property even though the CONTENT is now
// freeform), and the fact column holds plain short text, never a
// document or nested object. No UPDATE grant: a fact is remembered or
// forgotten, never edited in place — the same "replace by forgetting and
// re-remembering" shape a real correction already takes in conversation.
const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE ai_general_memory (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        user_id       UUID NOT NULL REFERENCES users(id),
        fact          TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql('CREATE INDEX ai_general_memory_user_id_idx ON ai_general_memory (user_id, created_at)');
  pgm.sql('ALTER TABLE ai_general_memory ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE ai_general_memory FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON ai_general_memory
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, DELETE ON ai_general_memory TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS ai_general_memory');
};
