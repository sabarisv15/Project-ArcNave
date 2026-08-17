'use strict';

// Frontend-discovery gap, Priority 2 #6/#7 and the recommended
// "Personal Dashboard Configuration" feature: one generic per-user
// key/value preference store, not three separate tables. Saved
// Filters, Dashboard widget layout, and Notification channel
// preferences are all "a small blob of settings private to one user,
// looked up by a name" — the same shape three times over. A single
// table keyed by (college_id, user_id, preference_key) lets the
// frontend introduce a new preference key (e.g. "dashboard_layout",
// "notification_channels", "saved_filters.students_list") without a
// migration each time, while still giving each existing key a real,
// queryable row.
//
// value is JSONB, not TEXT: every candidate use (widget order array,
// channel on/off flags, a saved filter's field/value pairs) is
// naturally structured, and JSONB lets a future read filter/index into
// it if a specific key ever needs that.
//
// This migration stores preferences only. It deliberately does not
// wire any read of this table into NotificationService's dispatch path
// — enforcing "don't email me" is a separate, later change to
// notificationService itself, not a half-finished part of this table.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE user_preferences (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id        TEXT NOT NULL REFERENCES colleges(college_id),
        user_id           UUID NOT NULL REFERENCES users(id),
        preference_key    TEXT NOT NULL,
        value             JSONB NOT NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, preference_key)
    )
  `);

  pgm.sql('ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON user_preferences
        USING (college_id = current_setting('app.current_tenant', true))
  `);

  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON user_preferences TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS user_preferences');
};
