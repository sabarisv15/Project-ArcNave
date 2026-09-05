# The values a human applying this needs next -- mirrors
# STAGING-DEPLOY-RUNBOOK.md's own manual `gcloud ... describe` steps and
# the two repo secrets deploy-staging.yml's auth step already expects
# (GCP_WIF_PROVIDER/GCP_DEPLOY_SERVICE_ACCOUNT).

output "cloud_sql_connection_name" {
  description = "Instance connection name for --add-cloudsql-instances (deploy-staging.yml) and the Cloud SQL Auth Proxy bootstrap step (STAGING-DEPLOY-RUNBOOK.md section 4)."
  value       = google_sql_database_instance.arcnave.connection_name
}

output "deployer_service_account_email" {
  description = "GCP_DEPLOY_SERVICE_ACCOUNT repo secret value."
  value       = google_service_account.deployer.email
}

output "workload_identity_provider" {
  description = "GCP_WIF_PROVIDER repo secret value."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "secret_ids" {
  description = "Secret Manager secret ids created (containers only -- populate the first real version manually, see secrets.tf's own comment)."
  value       = [for s in google_secret_manager_secret.arcnave : s.secret_id]
}
