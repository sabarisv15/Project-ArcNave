'use strict';

// Scoped AI Preference Memory — the safe version of "persistent memory"
// flagged in CHECKPOINT.md's AI capability roadmap (P2.4) and, separately,
// the "Scoped Preference Memory (P1)" item the user's own chat-attachment
// governance plan deferred out of that pass. Deliberately its own pair of
// tables, not a reuse of `user_preferences` (that table already serves a
// different, narrower purpose — round 13's AI-response display settings
// like report_format/default_chart/language, set directly by the AI tool
// with no consent gate at all, since "how do you want answers formatted"
// carries none of the retention risk "the AI remembers things you told it"
// does).
//
// Two tables, same tenant_isolation RLS shape every other per-user table in
// this codebase already uses (see user_preferences' own migration):
//
// ai_memory_consent — one row per user, whether this user has opted in to
// the AI writing anything to ai_scoped_memory at all. Defaults to false
// (opt-in, never opt-out) with no row needed for the default: a user who
// never visits the consent UI has no row and is treated as not consented
// (aiMemoryService's own COALESCE-style read handles the no-row case).
//
// ai_scoped_memory — the actual remembered preferences, one row per
// (user, memory_type). UNIQUE(user_id, memory_type) mirrors
// user_preferences' own UNIQUE(user_id, preference_key) — "remembering the
// same type of thing again" is an update, not a second fact.
//
// No FK from ai_scoped_memory to ai_memory_consent on purpose: consent is
// checked in the service layer at write time (aiMemoryService.rememberPreference),
// not enforced as a DB constraint — a revoked consent already triggers a
// synchronous delete of every ai_scoped_memory row for that user
// (aiMemoryService.setConsent), so no row can outlive a "no" at the DB level
// either.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE ai_memory_consent (
        college_id        TEXT NOT NULL REFERENCES colleges(college_id),
        user_id           UUID NOT NULL REFERENCES users(id),
        consented         BOOLEAN NOT NULL DEFAULT false,
        consented_at      TIMESTAMPTZ,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id)
    )
  `);

  pgm.sql('ALTER TABLE ai_memory_consent ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE ai_memory_consent FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON ai_memory_consent
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON ai_memory_consent TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE TABLE ai_scoped_memory (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id        TEXT NOT NULL REFERENCES colleges(college_id),
        user_id           UUID NOT NULL REFERENCES users(id),
        memory_type       TEXT NOT NULL,
        value             JSONB NOT NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, memory_type)
    )
  `);

  pgm.sql('ALTER TABLE ai_scoped_memory ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE ai_scoped_memory FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON ai_scoped_memory
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON ai_scoped_memory TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS ai_scoped_memory');
  pgm.sql('DROP TABLE IF EXISTS ai_memory_consent');
};
