# GCS buckets for document storage (P4 O3, ADL-077: GCS FUSE rather than a
# DocumentService rewrite -- see that ledger entry for the reasoning).
# Exact bucket names/location from STAGING-DEPLOY-RUNBOOK.md section 2.

resource "google_storage_bucket" "document_storage" {
  name     = "arcnave-${var.environment}-document-storage"
  location = var.region
  project  = var.project_id

  # Uniform bucket-level access -- IAM-only, no legacy per-object ACLs.
  # This is the current GCS-recommended default, not something the
  # runbook's own gcloud command explicitly asked for; stated here so a
  # future reader knows it's a deliberate choice, not an accidental
  # provider default.
  uniform_bucket_level_access = true

  # This is a staging environment (ADL-085: real prod infra deferred
  # indefinitely, pre-launch). force_destroy = true so a `terraform
  # destroy` of the staging environment isn't blocked by leftover
  # objects -- never set this for a real production bucket.
  force_destroy = true
}

resource "google_storage_bucket" "document_storage_backups" {
  name     = "arcnave-${var.environment}-document-storage-backups"
  location = var.region
  project  = var.project_id

  uniform_bucket_level_access = true
  force_destroy               = true
}
