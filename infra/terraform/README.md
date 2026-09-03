# ARCNAVE staging infrastructure (Terraform)

ARCNAVE modernization P5 (O7: "no infrastructure-as-code -> infrastructure
defined in version-controlled files"). This is the same infrastructure
[`STAGING-DEPLOY-RUNBOOK.md`](../../STAGING-DEPLOY-RUNBOOK.md) (repo root)
already documents as manual `gcloud` commands, expressed as Terraform
instead — same project, same region, same resource names, so the two
stay interchangeable rather than describing two different environments.

**Code-only, not applied.** Same status as O3 itself (ADL-077) and the
O2/O3 deferral (ADL-085): ARCNAVE is pre-launch, and real GCP infra is
an ongoing cost with no live users yet to justify it. Nothing in this
directory has been run against real GCP. `terraform fmt`/`terraform
validate` were run locally (network access to download the `google`
provider and its schema, no GCP credentials involved) to confirm the
HCL itself is syntactically correct and every resource argument matches
the real provider's current schema — stronger verification than a
human proofreading `gcloud` commands gets, but still not a `terraform
plan` against a live project, since no credentials for
`project-8bcf740a-a7bd-4aea-974` exist in this environment.

## What this creates

| File | Resources | Runbook section |
|---|---|---|
| `storage.tf` | 2 GCS buckets (document storage + backups) | 2 |
| `cloud_sql.tf` | Cloud SQL Postgres 16 instance + `arcnave` database | 3 |
| `secrets.tf` | 6 Secret Manager secret *containers* (never a value — see that file's own comment) | 5 |
| `iam.tf` | Deploy service account, 5 least-privilege role bindings, Workload Identity Federation pool/provider (no downloaded JSON key, ever) | 6 |

**Deliberately not in this module** (see each file's own comment for
the reasoning): the three DB roles (`arcnave_admin`/`arcnave_app`/
`arcnave_platform`, ADR-015) — `backend/scripts/bootstrap-cloud-sql-
roles.js` already owns that, and duplicating it into Terraform would
create a second source of truth; the Artifact Registry repo — reusing
the existing one `sandbox-service` already pushes to, no new repo
needed; and any secret *value* — populated manually, out-of-band, by
whoever actually applies this.

## Applying this for real (when the owner decides to)

1. `cd infra/terraform && terraform init`
2. Decide on a remote state backend (a GCS bucket — not created by this
   module, since that's the same "no infra provisioned yet" chicken-
   and-egg every Terraform-for-GCS-itself setup hits; create one bucket
   by hand first, or use local state for a first trial run) and add a
   `backend "gcs" {}` block to `versions.tf` before any real apply.
3. `terraform plan` — review every resource against
   `STAGING-DEPLOY-RUNBOOK.md`'s own descriptions before proceeding.
4. `terraform apply`.
5. Populate the 6 Secret Manager secret versions manually
   (`gcloud secrets versions add <name> --data-file=-`, same as the
   runbook's own section 5), then continue the runbook from its
   section 4 (bootstrap the three DB roles) onward — this module only
   covers the resources gcloud commands would otherwise create, not the
   application-level bootstrap steps that already have their own real
   scripts.
6. Add `terraform output workload_identity_provider` /
   `terraform output deployer_service_account_email` as the
   `GCP_WIF_PROVIDER`/`GCP_DEPLOY_SERVICE_ACCOUNT` repo secrets
   `deploy-staging.yml` already expects.

## Keeping this in sync with the runbook

If a future session changes `STAGING-DEPLOY-RUNBOOK.md`'s resource
shapes (a different Cloud SQL tier, a new secret, a different IAM
role), update this module in the same pass — two descriptions of the
same infrastructure drifting apart defeats the point of either one.
