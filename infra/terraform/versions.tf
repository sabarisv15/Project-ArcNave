# ARCNAVE modernization P5 (O7: "no infrastructure-as-code -> infrastructure
# defined in version-controlled files"). Same GCP project/region O3's own
# STAGING-DEPLOY-RUNBOOK.md already names (project-8bcf740a-a7bd-4aea-974,
# asia-south1) -- this module defines the exact same resources that
# runbook's gcloud commands create by hand, so a human can apply this
# instead of typing each command, or diff a future change against a known
# state instead of re-deriving it from the runbook prose.
#
# Code-only, same as O3 itself (ADL-077) and O2/O3's own deferral
# (ADL-085): nothing in this directory has been applied against real GCP
# by this session -- no `terraform apply`, no real billed resource created.
# `terraform validate`/`fmt` were run locally against a downloaded CLI
# (network access only, no GCP credentials involved) to confirm the HCL
# itself is syntactically correct; the actual resource shapes could not be
# plan-verified against a live GCP project from this environment, the same
# honest limitation O3's own bootstrap-cloud-sql-roles.js/smoke-test.js
# already carried ("reviewed directly against docker/postgres/init/*.sh
# for parity instead").

terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Deliberately no `backend "gcs"` block yet -- that bucket doesn't exist
  # (O2/O3's own real infra is deferred indefinitely, ADL-085). Uses local
  # state until a human actually applies this and can point it at a real
  # state bucket. Do not add a backend block speculatively; the moment
  # real infra is provisioned, add one pointing at a real bucket in the
  # same PR that runs the first `terraform apply`.
}

provider "google" {
  project = var.project_id
  region  = var.region
}
