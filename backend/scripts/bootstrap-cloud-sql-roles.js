'use strict';

// P4 O3 (staging on Cloud Run + Cloud SQL) — one-time equivalent of
// docker/postgres/init/01-app-role.sh + 02-platform-role.sh for Cloud
// SQL, which does not run docker-entrypoint-initdb.d scripts on an
// externally-managed instance. Re-read both shell scripts before
// editing this file — they intentionally do nothing beyond `CREATE
// ROLE ... LOGIN PASSWORD`; every GRANT (arcnave_app/arcnave_platform's
// actual table privileges) lives in the Module 0 migration itself and
// runs later, unchanged, via `npm run migrate` — this script must not
// duplicate or guess at those GRANTs.
//
// In local dev, "arcnave_admin" IS $POSTGRES_USER — the official
// postgres/pgvector image's own bootstrap superuser, named
// arcnave_admin only because docker-compose.yml sets POSTGRES_USER to
// that value (see docker-compose.yml:20-21). Cloud SQL has no
// equivalent "name the initial superuser whatever you want" knob — its
// bootstrap user is always literally `postgres`, and even that is
// `cloudsqlsuperuser`, not a true Postgres SUPERUSER. So this script
// creates arcnave_admin as an explicit role and grants it BYPASSRLS
// directly — per ADR-015's own reasoning, BYPASSRLS (not the
// SUPERUSER label) is the actual property that makes FORCE ROW LEVEL
// SECURITY meaningful for arcnave_app/arcnave_platform: an admin
// connection that doesn't have it would otherwise be silently subject
// to RLS like any other role, and one that does bypasses policy
// exactly like $POSTGRES_USER already does in dev.
//
// Idempotent — safe to re-run. Postgres has no native `CREATE ROLE IF
// NOT EXISTS`, hence the catalog-check DO blocks below.
//
// Usage (run once against a fresh Cloud SQL instance, before the first
// `npm run migrate`):
//   CLOUD_SQL_BOOTSTRAP_URL=postgresql://postgres:<password>@<host>/<db> \
//   ARCNAVE_ADMIN_PASSWORD=... ARCNAVE_APP_PASSWORD=... ARCNAVE_PLATFORM_PASSWORD=... \
//   node backend/scripts/bootstrap-cloud-sql-roles.js
//
// CLOUD_SQL_BOOTSTRAP_URL connects as Cloud SQL's own `postgres` user —
// deliberately a separate env var from this project's usual
// MIGRATION_DATABASE_URL (which points at arcnave_admin, a role this
// script is the one that creates).

const { Client } = require('pg');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required — see this script's own top comment for usage.`);
  }
  return value;
}

async function createRoleIfMissing(client, roleName, password, extraAttributes) {
  await client.query(
    `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
        CREATE ROLE ${roleName} LOGIN PASSWORD '${password}' ${extraAttributes};
      END IF;
    END
    $$;
    `,
  );
}

async function main() {
  const bootstrapUrl = required('CLOUD_SQL_BOOTSTRAP_URL');
  const adminPassword = required('ARCNAVE_ADMIN_PASSWORD');
  const appPassword = required('ARCNAVE_APP_PASSWORD');
  const platformPassword = required('ARCNAVE_PLATFORM_PASSWORD');

  const client = new Client({ connectionString: bootstrapUrl });
  await client.connect();

  try {
    // arcnave_admin — owns the tables migrations create (same role
    // migrate.js's MIGRATION_DATABASE_URL connects as), BYPASSRLS so
    // FORCE ROW LEVEL SECURITY doesn't apply to it (ADR-015).
    await createRoleIfMissing(client, 'arcnave_admin', adminPassword, 'BYPASSRLS CREATEDB');

    // arcnave_app — the least-privilege runtime role (ADR-015). No
    // extra attributes: mirrors docker/postgres/init/01-app-role.sh
    // exactly, which grants nothing beyond LOGIN here either.
    await createRoleIfMissing(client, 'arcnave_app', appPassword, '');

    // arcnave_platform — the Super Admin Portal API's least-privilege
    // role (ADR-015). Mirrors 02-platform-role.sh exactly.
    await createRoleIfMissing(client, 'arcnave_platform', platformPassword, '');

    // pgvector — needed by the Module 9 RAG slice's ai_document_chunks
    // migration (CREATE EXTENSION vector), same as
    // pgvector/pgvector:pg16 provides by default in dev
    // (docker-compose.yml:9). pg_stat_statements — P1 D6, same as
    // docker-compose.yml's own `command: postgres -c
    // shared_preload_libraries=pg_stat_statements`; on Cloud SQL this
    // is enabled via an instance database flag at provisioning time
    // (see STAGING-DEPLOY-RUNBOOK.md), not here — CREATE EXTENSION
    // alone only registers the SQL-visible view, same caveat
    // docker-compose.yml's own comment already makes.
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements;');

    console.log('Cloud SQL bootstrap complete: arcnave_admin, arcnave_app, arcnave_platform roles + extensions ready.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
