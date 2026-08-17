'use strict';

// student_phone_otps — WhatsApp OTP verification for a student's own
// phone or their parent's phone (item 1 of this session's task).
// `target` names WHICH of students.phone/parent_phone this OTP row is
// verifying — no CHECK constraint, matching house convention (known
// values 'phone'|'parent_phone' enforced in phoneVerificationService.js,
// same as notifications.channel/college_notification_channels.channel).
//
// code_hash, never the raw code: a one-way sha256 hash (see
// phoneVerificationService.js) — there is no legitimate reason to ever
// read a code back out once issued, unlike college_notification_channels.config
// (real credentials a provider adapter must be handed back), so this
// is a plain one-way hash, not cryptoUtil's reversible AES-256-GCM.
//
// consumed_at (nullable): single-use marker — a row with consumed_at
// already set can never be matched again by
// phoneVerificationService.verifyOtp's "latest active" lookup.
// attempts: incremented on every mismatched verify attempt against a
// live (unexpired, unconsumed) row, capped by
// config.otp.maxAttempts — bounds brute-forcing a 6-digit code without
// a separate rate-limit table.
//
// student_id has no UNIQUE(student_id, target) — a student may request
// a fresh OTP before a previous one expires (e.g. "didn't receive it"),
// which naturally supersedes it (verifyOtp always matches the most
// recently created unconsumed row for a given student_id+target, never
// an older one), so multiple historical rows per student+target is
// expected, not an anomaly.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE student_phone_otps (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        student_id    UUID NOT NULL REFERENCES students(id),
        target        TEXT NOT NULL,
        phone         TEXT NOT NULL,
        code_hash     TEXT NOT NULL,
        expires_at    TIMESTAMPTZ NOT NULL,
        consumed_at   TIMESTAMPTZ,
        attempts      INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('ALTER TABLE student_phone_otps ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE student_phone_otps FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON student_phone_otps
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON student_phone_otps TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS student_phone_otps');
};
