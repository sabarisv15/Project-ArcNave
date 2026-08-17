#!/bin/bash
# Creates the least-privilege runtime role the FastAPI app connects
# as. Deliberately separate from $POSTGRES_USER, which owns the
# tables created by Alembic migrations.
#
# This split is not optional. FORCE ROW LEVEL SECURITY (set on every
# tenant table in the Module 0 migration) closes the table-owner RLS
# bypass, but it does nothing against a superuser connection — that
# bypass is unconditional and not configurable by policy. The official
# postgres image provisions $POSTGRES_USER as a superuser, and that's
# also the role that owns the tables (it runs the migrations). So if
# the app connected as $POSTGRES_USER, every RLS policy in this
# project would silently be a no-op regardless of FORCE. arcnave_app
# must stay a plain, non-superuser role. See ADR-015.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE arcnave_app LOGIN PASSWORD '$ARCNAVE_APP_PASSWORD';
EOSQL
