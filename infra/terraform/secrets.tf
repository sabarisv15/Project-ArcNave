# Secret Manager -- STAGING-DEPLOY-RUNBOOK.md section 5, the same six
# secrets docker-compose.yml's own `:?` guards require locally. This
# module creates only the secret CONTAINERS (the named slot Cloud Run
# references), never a version with real secret material -- committing an
# actual database password or JWT key into a .tf file (even as a
# "sensitive" variable default) would defeat the entire point of moving
# secrets out of plain files (this is O6's own subject, not O7's).
# Populating the first real version stays a manual, out-of-band step
# (`gcloud secrets versions add <name> --data-file=-`, the same runbook
# pattern this replaces the container-creation half of), run by a human
# with the actual credential in hand, never by Terraform or by this
# session.

locals {
  secret_ids = [
    "arcnave-${var.environment}-database-url",
    "arcnave-${var.environment}-migration-database-url",
    "arcnave-${var.environment}-platform-database-url",
    "arcnave-${var.environment}-jwt-secret-key",
    "arcnave-${var.environment}-platform-jwt-secret-key",
    "arcnave-${var.environment}-document-storage-encryption-key",
  ]
}

resource "google_secret_manager_secret" "arcnave" {
  for_each  = toset(local.secret_ids)
  secret_id = each.value
  project   = var.project_id

  replication {
    auto {}
  }
}
