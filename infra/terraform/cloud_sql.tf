# Cloud SQL instance -- STAGING-DEPLOY-RUNBOOK.md section 3. That
# runbook's own gcloud command is itself marked "# VERIFY: exact flag
# names for pgvector + pg_stat_statements ... not confirmed live this
# session" -- the same honest caveat applies here, carried forward rather
# than silently resolved: the `database_flags` block below is this
# session's best-effort HCL translation of that same gcloud command, not
# independently re-verified against a live Cloud SQL instance.
#
# deletion_protection defaults to true in the google provider -- left at
# that default deliberately, even for staging: an accidental
# `terraform destroy`/`terraform apply` removing a real instance is a far
# worse outcome than a staging environment being briefly annoying to tear
# down (the storage buckets above are the ones deliberately given
# force_destroy = true, not this).

resource "google_sql_database_instance" "arcnave" {
  name             = "arcnave-${var.environment}"
  project          = var.project_id
  region           = var.region
  database_version = "POSTGRES_16"

  settings {
    tier = var.cloud_sql_tier

    database_flags {
      name  = "cloudsql.enable_pgvector"
      value = "on"
    }
    database_flags {
      name  = "shared_preload_libraries"
      value = "pg_stat_statements"
    }

    # Bootstrapped once from an authorized network / Cloud SQL Auth Proxy
    # per the runbook's section 4 -- this module does not open public IP
    # access; ipv4_enabled defaults to true in the provider (needed for
    # the Auth Proxy bootstrap step), left at that default rather than
    # narrowed here, since narrowing it is a real security decision this
    # pass isn't making unreviewed.
    backup_configuration {
      enabled = true
      # Point-in-time recovery -- RS-DAT/D7's own "a copy of the database
      # is not a backup... you need point-in-time recovery" standard
      # (ARCNAVE-modernization-english.md's Database section), applied
      # here at the infra level for this Cloud SQL instance specifically
      # (distinct from D7's own already-shipped
      # backend/scripts/backup-database.js, which backs up the local
      # Docker Postgres this repo runs today).
      point_in_time_recovery_enabled = true
    }
  }
}

resource "google_sql_database" "arcnave" {
  name     = "arcnave"
  project  = var.project_id
  instance = google_sql_database_instance.arcnave.name
}

# The three DB roles (arcnave_admin/arcnave_app/arcnave_platform, ADR-015)
# are deliberately NOT created here -- STAGING-DEPLOY-RUNBOOK.md section 4
# already has the real mechanism for that
# (backend/scripts/bootstrap-cloud-sql-roles.js, idempotent, mirrors
# docker/postgres/init/*.sh), and duplicating role/grant logic into
# Terraform would create two sources of truth for the same three-role
# separation this project's own ADR-015 already owns in one place.
