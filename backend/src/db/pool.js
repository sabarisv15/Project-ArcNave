'use strict';

const { Pool } = require('pg');
const config = require('../config');

// Runtime pool — arcnave_app. Subject to RLS in full (not the table
// owner, not a superuser). Every query issued through this pool must
// have app.current_tenant set via set_config(..., true) inside the
// same transaction first — see ADR-002. Nothing in this pass does
// that yet; Tenant Middleware, which owns that responsibility, is
// rebuilt in a later follow-up, same order Module 0 was originally
// built in.
const appPool = new Pool({ connectionString: config.databaseUrl });

// Platform pool — arcnave_platform. Not used by any route yet; the
// Super Admin Portal API is rebuilt in a later pass. Defined here now
// so the three-role connection separation (ADR-015) is real in the
// app's config from the start rather than bolted on later.
const platformPool = new Pool({ connectionString: config.platformDatabaseUrl });

module.exports = { appPool, platformPool };
