'use strict';

const { Pool } = require('pg');
const config = require('../config');
const { logError } = require('../logging/logger');

// No statement_timeout here — arcnave_app already gets one at the DB
// ROLE level (migration 1762100000000_arcnave-app-role-timeouts, see
// tests/db-role-timeouts.test.js), which is the more precise place for
// it (survives regardless of how a connection is opened, not just
// through this Pool). Setting it again here would just override that
// role default with a less-considered value.
const poolOptions = {
  max: config.dbPool.max,
  min: config.dbPool.min,
  idleTimeoutMillis: config.dbPool.idleTimeoutMillis,
  connectionTimeoutMillis: config.dbPool.connectionTimeoutMillis,
};

// Runtime pool — arcnave_app. Subject to RLS in full (not the table
// owner, not a superuser). Every query issued through this pool must
// have app.current_tenant set via set_config(..., true) inside the
// same transaction first — see ADR-002. Nothing in this pass does
// that yet; Tenant Middleware, which owns that responsibility, is
// rebuilt in a later follow-up, same order Module 0 was originally
// built in.
const appPool = new Pool({ connectionString: config.databaseUrl, ...poolOptions });

// Platform pool — arcnave_platform. Not used by any route yet; the
// Super Admin Portal API is rebuilt in a later pass. Defined here now
// so the three-role connection separation (ADR-015) is real in the
// app's config from the start rather than bolted on later.
const platformPool = new Pool({ connectionString: config.platformDatabaseUrl, ...poolOptions });

// pg emits 'error' on the Pool itself when an idle client is dropped
// by the server (network reset, DB restart) — with no listener, that
// error is unhandled and crashes the whole Node process, taking down
// every tenant's in-flight request, not just the one that hit the bad
// connection.
appPool.on('error', (err) => logError('db_pool_idle_client_error', { pool: 'app', error: err.message }));
platformPool.on('error', (err) => logError('db_pool_idle_client_error', { pool: 'platform', error: err.message }));

module.exports = { appPool, platformPool };
