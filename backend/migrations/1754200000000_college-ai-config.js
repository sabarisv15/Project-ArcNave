'use strict';

// Module 9 (AI) — per-college AI provider config. Each college may
// pick its own provider (nim/gemini/claude/self_hosted, see
// services/aiProviders/) and supply its own api_key/model instead of
// the global config.nim.* every college shared before this. One row
// per college (UNIQUE college_id) — a college either has a row (its
// own provider/key) or doesn't (falls back to the global default,
// ConfigurationService.getAiConfig's own job, not this table's).
//
// api_key is encrypted at rest (cryptoUtil.encryptSecret, AES-256-GCM)
// before ever reaching this column — the column itself is just TEXT
// (ciphertext), same "encrypt before the DB write, decrypt only in the
// service layer" split fileStorage.js already uses for document bytes.
// Nullable: a self-hosted provider behind a private network may need
// no key at all.
//
// base_url is nullable — only self_hosted (and an override for a
// hosted provider's regional/proxy endpoint) needs one; every other
// adapter has its own real default baked into its own file.
//
// Tenant table like every other in this schema: ENABLE + FORCE ROW
// LEVEL SECURITY and a tenant_isolation policy on college_id (ADR-002).
// No DELETE grant — clearing a college's config is an UPDATE (set
// provider back to a null-ish state via the service), not a row
// removal; same "no DELETE unless something asked for it" restraint
// configurations/notifications already apply.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE college_ai_config (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id        TEXT NOT NULL UNIQUE REFERENCES colleges(college_id),
        provider          TEXT NOT NULL,
        api_key           TEXT,
        model             TEXT,
        embedding_model   TEXT,
        base_url          TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE college_ai_config ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE college_ai_config FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON college_ai_config
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON college_ai_config TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS college_ai_config');
};
