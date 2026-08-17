'use strict';

// college_notification_channels — per-college {channel, provider}
// configuration NotificationService resolves against instead of the
// hardcoded Twilio/nodemailer calls it used to make (item 3/4 of this
// session's task). `channel` has no CHECK constraint / DB enum,
// matching house convention (see notificationService.js's own comment
// on notifications.channel, college_ai_config's plain `provider TEXT`)
// — known values ('email'|'sms'|'whatsapp'|'fcm'|'telegram') are
// enforced at the service layer, where notificationService.js's
// PROVIDER_REGISTRY is what "a known channel/provider pair" actually
// means, not the database. fcm/telegram are valid values here with no
// adapter file yet on purpose (see routes/notificationProviders.js and
// NotificationChannelNotImplementedError) — the resolver throws a
// clear, visible error if a college enables one, rather than silently
// dropping messages.
//
// `config` (jsonb, no fixed columns): provider-specific
// credentials/settings. Stored encrypted at rest — the service layer
// (never this migration, never the repository) wraps the plaintext
// object as { encrypted: cryptoUtil.encryptSecret(JSON.stringify(...)) }
// before it ever reaches this column, reusing the same AES-256-GCM
// helper college_ai_config's api_key should also eventually adopt (not
// this session's scope to retrofit).
//
// UNIQUE (college_id, channel): one active provider per channel per
// college — BusinessRules.md gives no reason for a college to run two
// SMS providers side by side, and multi-provider fallback is
// explicitly out of scope for the Send Alert feature this table feeds
// (item 5 — "no auto-retry or channel fallback").

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE college_notification_channels (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        channel       TEXT NOT NULL,
        provider      TEXT NOT NULL,
        enabled       BOOLEAN NOT NULL DEFAULT true,
        config        JSONB,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (college_id, channel)
    )
  `);

  pgm.sql('ALTER TABLE college_notification_channels ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE college_notification_channels FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON college_notification_channels
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON college_notification_channels TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS college_notification_channels');
};
