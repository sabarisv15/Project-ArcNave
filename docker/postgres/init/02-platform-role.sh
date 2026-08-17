#!/bin/bash
# Creates the least-privilege role the Super Admin Portal API connects
# as. Same reasoning as 01-app-role.sh's arcnave_app (ADR-015): a
# distinct, non-superuser role that owns no tables, so RLS/GRANT
# actually mean something for it. arcnave_platform gets SELECT/INSERT/
# UPDATE on platform_admins and colleges only — granted in the Module
# 0 migration, never on users/refresh_tokens/audit_log/configurations.
# That's what makes "the platform path can't touch tenant data" a DB-
# enforced fact, not just an application convention.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE arcnave_platform LOGIN PASSWORD '$ARCNAVE_PLATFORM_PASSWORD';
EOSQL
