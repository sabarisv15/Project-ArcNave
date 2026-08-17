'use strict';

// Stage 8a / D13 / RS-GOV-013: Organization Name and position-title
// editing move to the tenant side (Institution Settings, principal
// only) — they no longer belong on the platform-admin frontend.
// collegeProfileRepository.js (the tenant-side, no-RLS, column-grant-
// scoped counterpart to platformRepository.js — see
// 1753000000000_college-admin-profile-schema.js's own comment for why
// `colleges` can't use RLS and a column-level GRANT is the real
// tenant-scoping mechanism here, not just the `WHERE college_id = $1`
// filter) gains UPDATE on three more columns it didn't need before:
// name, level1_position_title, level3_position_title. `arcnave_app`
// still has no UPDATE on subscription_status/subdomain/created_by/
// college_id/storage_tier — storage_tier is superseded entirely by the
// new per-tenant `storage` configuration category (configurationService,
// see storageProviderRegistry.js), never granted to arcnave_app at all.

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`GRANT UPDATE (name, level1_position_title, level3_position_title) ON colleges TO ${APP_ROLE}`);
};

exports.down = (pgm) => {
  pgm.sql(`REVOKE UPDATE (name, level1_position_title, level3_position_title) ON colleges FROM ${APP_ROLE}`);
};
