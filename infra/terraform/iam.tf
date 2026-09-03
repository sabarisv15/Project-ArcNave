# Deploy service account + Workload Identity Federation --
# STAGING-DEPLOY-RUNBOOK.md section 6. WIF, not a downloaded JSON key: no
# long-lived service-account key ever exists on disk or in a GitHub
# secret, matching this project's own broader secrets-out-of-plain-files
# direction (O6).

resource "google_service_account" "deployer" {
  account_id   = "arcnave-${var.environment}-deployer"
  display_name = "ARCNAVE ${var.environment} deploy (GitHub Actions)"
  project      = var.project_id
}

# Exactly the five roles STAGING-DEPLOY-RUNBOOK.md section 6 names --
# least-privilege for what deploy-staging.yml's own steps actually do
# (push an image, deploy Cloud Run, connect to Cloud SQL, read secrets,
# act as the runtime service account), never project-wide Editor/Owner.
locals {
  deployer_roles = [
    "roles/run.admin",
    "roles/artifactregistry.writer",
    "roles/cloudsql.client",
    "roles/secretmanager.secretAccessor",
    "roles/iam.serviceAccountUser",
  ]
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(local.deployer_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "arcnave-${var.environment}-github-pool"
  project                   = var.project_id
  display_name              = "ARCNAVE ${var.environment} GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  project                            = var.project_id
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Scoped to this exact repo -- no other GitHub repo's Actions run can
  # impersonate this service account, regardless of what token it
  # presents. Not further scoped to a specific branch/ref: this pool
  # covers both deploy-staging.yml today (workflow_dispatch only, per its
  # own header comment) and any future ref this same repo's Actions need
  # to deploy from -- branch-level narrowing is a deploy-workflow policy
  # decision (O2's own "separate deployed from switched on"), not an IAM
  # concern to bake in here.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_wif_binding" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}
