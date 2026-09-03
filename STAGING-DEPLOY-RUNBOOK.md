# Staging deploy runbook (P4 O3)

One-time GCP setup for `.github/workflows/deploy-staging.yml`. This
repo's code changes for staging are already landed — nothing here
happens automatically; every command below is real, billed
infrastructure and must be run (or reviewed and approved) by a human.
Same convention as `dependency-scan-baseline.md`: an operational
tracking doc, not a spec.

Project: `project-8bcf740a-a7bd-4aea-974`, region `asia-south1` — same
GCP project/region `sandbox-service` already deploys to
(`sandbox-service/build-log.txt:1298`, the only existing Cloud Run
precedent in this repo).

Every command marked `# VERIFY:` was not run or confirmed against live
`gcloud` output during this session — confirm current flag syntax
against `gcloud <command> --help` before running.

## 1. Artifact Registry

Reuse the existing `arcnave` repo sandbox-service already pushes to —
no new repo needed, just a new image name (`backend`) inside it.

```bash
gcloud auth configure-docker asia-south1-docker.pkg.dev
```

## 2. GCS buckets (document storage — see ledger entry for why GCS FUSE, not a DocumentService rewrite)

```bash
gcloud storage buckets create gs://arcnave-staging-document-storage --location=asia-south1
gcloud storage buckets create gs://arcnave-staging-document-storage-backups --location=asia-south1
```

## 3. Cloud SQL instance

```bash
# VERIFY: exact flag names for pgvector + pg_stat_statements against
# current `gcloud sql instances create --help` / Cloud SQL docs — not
# confirmed live this session.
gcloud sql instances create arcnave-staging \
  --database-version=POSTGRES_16 \
  --region=asia-south1 \
  --tier=db-custom-1-3840 \
  --database-flags=cloudsql.enable_pgvector=on,shared_preload_libraries=pg_stat_statements

gcloud sql databases create arcnave --instance=arcnave-staging
```

Get the instance connection name (needed for `--add-cloudsql-instances`
in the deploy workflow):

```bash
gcloud sql instances describe arcnave-staging --format='value(connectionName)'
```

## 4. Bootstrap the three DB roles

Run once, via Cloud SQL Auth Proxy or an authorized network, connecting
as Cloud SQL's built-in `postgres` user:

```bash
CLOUD_SQL_BOOTSTRAP_URL="postgresql://postgres:<postgres-user-password>@<proxy-host>/arcnave" \
ARCNAVE_ADMIN_PASSWORD="..." \
ARCNAVE_APP_PASSWORD="..." \
ARCNAVE_PLATFORM_PASSWORD="..." \
  node backend/scripts/bootstrap-cloud-sql-roles.js
```

Then run the real migrations once, as `arcnave_admin`, before the first
deploy (`MIGRATION_DATABASE_URL` pointed at the arcnave_admin
connection this just created):

```bash
MIGRATION_DATABASE_URL="postgresql://arcnave_admin:<password>@<proxy-host>/arcnave" \
  node backend/scripts/migrate.js up
```

## 5. Secret Manager entries

Six secrets — same six required vars `docker-compose.yml`'s `:?`
guards enforce locally (`docker-compose.yml`'s required-var lines),
plus the three full connection-string secrets the deploy workflow
references directly:

```bash
# VERIFY: confirm `gcloud secrets create` syntax against current CLI.
printf '%s' '<database-url>' | gcloud secrets create arcnave-staging-database-url --data-file=-
printf '%s' '<migration-database-url>' | gcloud secrets create arcnave-staging-migration-database-url --data-file=-
printf '%s' '<platform-database-url>' | gcloud secrets create arcnave-staging-platform-database-url --data-file=-
printf '%s' '<jwt-secret>' | gcloud secrets create arcnave-staging-jwt-secret-key --data-file=-
printf '%s' '<platform-jwt-secret>' | gcloud secrets create arcnave-staging-platform-jwt-secret-key --data-file=-
printf '%s' '<document-storage-encryption-key>' | gcloud secrets create arcnave-staging-document-storage-encryption-key --data-file=-
```

Each connection-string secret uses the Cloud SQL Unix socket form
(`?host=/cloudsql/<connection-name>`), not the `db:5432` TCP form
`docker-compose.yml` uses locally — the deploy workflow's
`--add-cloudsql-instances` flag is what makes that socket path exist
inside the Cloud Run container.

## 6. Deploy service account + Workload Identity Federation

```bash
gcloud iam service-accounts create arcnave-staging-deployer \
  --display-name="ARCNAVE staging deploy (GitHub Actions)"

# VERIFY: exact WIF pool/provider/binding commands against current
# `gcloud iam workload-identity-pools --help` — not confirmed live
# this session. Grant the resulting principal
# roles/run.admin, roles/artifactregistry.writer,
# roles/cloudsql.client, roles/secretmanager.secretAccessor,
# roles/iam.serviceAccountUser on arcnave-staging-deployer.
```

Add the resulting `workload_identity_provider`/`service_account`
values as `GCP_WIF_PROVIDER`/`GCP_DEPLOY_SERVICE_ACCOUNT` repo secrets
— referenced in `deploy-staging.yml`'s auth step.

## 7. First run

Trigger `.github/workflows/deploy-staging.yml` manually via
`workflow_dispatch` (GitHub Actions UI or `gh workflow run
deploy-staging.yml`). Watch the final "Smoke test" step — it's the
real end-to-end signal that everything above is wired correctly.

Once this has passed at least once, decide separately whether to
switch the workflow's trigger to `push: branches: [master]` — that's a
deliberate follow-up decision, not automatic (see `deploy-staging.yml`'s
own top comment).
