variable "project_id" {
  description = "GCP project id. STAGING-DEPLOY-RUNBOOK.md's own value: project-8bcf740a-a7bd-4aea-974."
  type        = string
  default     = "project-8bcf740a-a7bd-4aea-974"
}

variable "region" {
  description = "GCP region. Same one sandbox-service already deploys to (the only existing Cloud Run precedent in this repo)."
  type        = string
  default     = "asia-south1"
}

variable "environment" {
  description = "Environment name, used as a resource-name prefix (arcnave-<environment>-...). Only \"staging\" is defined by this pass -- a production environment is its own future decision, not assumed here."
  type        = string
  default     = "staging"
}

variable "github_repository" {
  description = "owner/repo for the Workload Identity Federation attribute condition -- only this exact repo's GitHub Actions runs may impersonate the deploy service account."
  type        = string
  default     = "sabarisv15/Project-ArcNave"
}

variable "cloud_sql_tier" {
  description = "Cloud SQL machine tier. STAGING-DEPLOY-RUNBOOK.md's own value."
  type        = string
  default     = "db-custom-1-3840"
}
