'use strict';

// Platform Admin module build, Phase A (plan: "Platform Admin — full
// module build", plans/tingly-marinating-whistle.md). A singleton
// settings row for platform-wide configuration — the Platform Admin
// Settings screen's "General" section only (platform name, support
// email, default timezone, date format, items-per-page). No
// Email/Security/Billing/Integrations/Backup/Data-Retention/Appearance
// fields — none of those systems exist in this codebase yet, and an
// inert form field with no backing behavior would be fabricated UI.
//
// Singleton via `id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id)` — the
// standard Postgres one-row-table trick: only the value `true` can
// ever satisfy both the PK and the CHECK, so a second INSERT is
// rejected by the PK constraint before the CHECK is even relevant.
// Seeded with one default row in this same migration so `GET
// /platform/settings` always has a row to read.
//
// No RLS — same as every other platform-only table (platform_admins,
// colleges): no per-tenant scoping concept applies here.

const PLATFORM_ROLE = 'arcnave_platform';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE platform_settings (
        id                  BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
        platform_name       TEXT NOT NULL DEFAULT 'ARCNAVE',
        support_email       TEXT,
        default_timezone    TEXT NOT NULL DEFAULT 'Asia/Kolkata',
        date_format         TEXT NOT NULL DEFAULT 'DD MMM YYYY',
        items_per_page      INTEGER NOT NULL DEFAULT 20,
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  pgm.sql('INSERT INTO platform_settings (id) VALUES (true)');

  pgm.sql(`GRANT SELECT, UPDATE ON platform_settings TO ${PLATFORM_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS platform_settings');
};
