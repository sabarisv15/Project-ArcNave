'use strict';

// RS-GOV-010/011/012 (organization provisioning lifecycle + readiness
// gate) and RS-GOV-005/006/008/009 (structural authorization key
// mechanism + department risk split + structural versioning).
//
// structural_authorization_keys gets no RLS, same reasoning as
// principal_invitations: it's looked up by an opaque bearer token from
// the platform side, outside any tenant's RLS context. Directional
// grants mirror that table too — arcnave_app (the tenant's own L1)
// generates/cancels, arcnave_platform (Platform Admin) only redeems.

const APP_ROLE = 'arcnave_app';
const PLATFORM_ROLE = 'arcnave_platform';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE colleges
      ADD COLUMN provisioning_status TEXT NOT NULL DEFAULT 'provisioning'
        CHECK (provisioning_status IN ('provisioning', 'ready', 'active', 'suspended', 'archived', 'cancelled')),
      ADD COLUMN version INT NOT NULL DEFAULT 1
  `);

  pgm.sql(`
    ALTER TABLE departments
      ADD COLUMN version INT NOT NULL DEFAULT 1,
      ADD COLUMN course_duration INT,
      ADD COLUMN created_at_onboarding BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN merged_into_department_id UUID REFERENCES departments(id)
  `);

  pgm.sql(`
    CREATE TABLE structural_authorization_keys (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id        TEXT NOT NULL REFERENCES colleges(college_id),
        action_type       TEXT NOT NULL CHECK (action_type IN (
                              'l2_configuration', 'affiliation_change', 'add_campus',
                              'department_merge_rename', 'accreditation_change'
                          )),
        action_payload    JSONB NOT NULL,
        token_hash        TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'generated'
                              CHECK (status IN ('generated', 'cancelled', 'expired', 'redeemed')),
        generated_by      UUID NOT NULL,
        generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at        TIMESTAMPTZ NOT NULL,
        cancelled_at      TIMESTAMPTZ,
        redeemed_by       UUID REFERENCES platform_admins(id),
        redeemed_at       TIMESTAMPTZ
    )
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON structural_authorization_keys TO ${APP_ROLE}`);
  pgm.sql(`GRANT SELECT, UPDATE ON structural_authorization_keys TO ${PLATFORM_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS structural_authorization_keys');
  pgm.sql(`
    ALTER TABLE departments
      DROP COLUMN IF EXISTS merged_into_department_id,
      DROP COLUMN IF EXISTS created_at_onboarding,
      DROP COLUMN IF EXISTS course_duration,
      DROP COLUMN IF EXISTS version
  `);
  pgm.sql(`
    ALTER TABLE colleges
      DROP COLUMN IF EXISTS version,
      DROP COLUMN IF EXISTS provisioning_status
  `);
};
