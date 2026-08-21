'use strict';

// Mirrors the old app/core/config.py Settings class's discipline:
// secrets/connection strings have no hardcoded fallback — a missing
// required value fails loudly at startup, not silently at first use.

const path = require('path');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  appName: process.env.APP_NAME || 'ARCNAVE',
  environment: process.env.ENVIRONMENT || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // The one browser origin allowed to make cross-origin requests to
  // this API (see tenantApp.js/platformApp.js's cors() wiring) — never
  // a wildcard: this app serves student/staff PII across every tenant,
  // and auth is bearer-token-in-header (see security.js — no cookies
  // anywhere in this codebase), so an overly permissive CORS policy
  // would let any third-party page read a response if it ever got hold
  // of a token, not just enable convenience. Defaults to the frontend's
  // own local dev server (frontend/vite.config.js, port 3100) —
  // deploy-specific, must be set for any non-local frontend origin.
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3100',

  // Runtime app connection — must use the least-privilege arcnave_app
  // role, never the migration-owner role. That role is a Postgres
  // superuser (provisioned by the official postgres image) and
  // superusers bypass RLS unconditionally, regardless of FORCE ROW
  // LEVEL SECURITY. This distinction is load bearing, not stylistic.
  // See ADR-015.
  databaseUrl: required('DATABASE_URL'),

  // Migration connection — owns the tables (CREATE TABLE, CREATE
  // POLICY, GRANT). Only used by scripts/migrate.js and by tests that
  // seed/verify fixture data directly (bypassing RLS on purpose, as
  // the negative control) — never by application routes.
  migrationDatabaseUrl: required('MIGRATION_DATABASE_URL'),

  // Pool sizing/timeouts shared by both db/pool.js Pools. Defaults are
  // pg's own recommended starting point for a single-instance app, not
  // tuned against real traffic — safe to override per-environment
  // without a code change once real load data exists. statement_timeout
  // is deliberately not here — that's set at the DB role level (see
  // db/pool.js's own comment).
  dbPool: {
    max: Number(process.env.DB_POOL_MAX) || 10,
    min: Number(process.env.DB_POOL_MIN) || 0,
    idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS) || 30000,
    connectionTimeoutMillis: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS) || 5000,
  },

  // Platform (Super Admin Portal) DB connection — arcnave_platform, a
  // separate least-privilege role from arcnave_app, granted only on
  // platform_admins/colleges/principal_invitations (see the ported
  // migrations). Not wired into any route yet in this pass — the
  // Platform API is rebuilt in a later follow-up, same as Module 0's
  // original build order. Required here now so the three-role
  // connection separation (ADR-015) exists in the app's config from
  // the start, matching how it's wired in docker-compose.yml, rather
  // than being bolted on later.
  platformDatabaseUrl: required('PLATFORM_DATABASE_URL'),

  // Signs/verifies access JWTs. A real secret, required — no default,
  // same reasoning as databaseUrl: a hardcoded fallback here would be
  // a hardcoded auth bypass waiting to happen in prod.
  jwtSecretKey: required('JWT_SECRET_KEY'),
  jwtAlgorithm: process.env.JWT_ALGORITHM || 'HS256',
  accessTokenExpireMinutes: Number(process.env.ACCESS_TOKEN_EXPIRE_MINUTES) || 15,
  // Refresh tokens are opaque, stored server-side as token_hash only
  // (never the raw token) — see src/security.js.
  refreshTokenExpireDays: Number(process.env.REFRESH_TOKEN_EXPIRE_DAYS) || 30,

  // Signs/verifies platform-admin access JWTs. Deliberately a
  // DIFFERENT secret from jwtSecretKey, required, no fallback to it:
  // a platform token and a tenant token must never verify against the
  // same key, or a leaked tenant token plus a signature bug could be
  // mistaken for platform access. See security.js's
  // createPlatformAccessToken/decodePlatformAccessToken.
  platformJwtSecretKey: required('PLATFORM_JWT_SECRET_KEY'),

  // How long a principal-invitation token (services/platformService.js
  // invitePrincipal) stays acceptable. A safe default, not a business
  // rule yet — nothing in BusinessRules.md specifies this.
  principalInvitationExpireHours: Number(process.env.PRINCIPAL_INVITATION_EXPIRE_HOURS) || 72,

  // How long a password-reset token (services/authService.js
  // requestPasswordReset) stays acceptable. Deliberately much shorter
  // than principalInvitationExpireHours above: a reset token is
  // self-service and emailed to an address that may not be as tightly
  // controlled as a platform admin's own invite flow, so a short
  // window bounds the damage if an inbox is compromised. A safe
  // default, not a business rule — nothing in BusinessRules.md
  // specifies this either.
  passwordResetTokenExpireHours: Number(process.env.PASSWORD_RESET_TOKEN_EXPIRE_HOURS) || 2,

  // How long a student/parent phone-verification OTP (services/
  // phoneVerificationService.js) stays acceptable, and how many
  // mismatched attempts a single OTP tolerates before it's locked out
  // (still expires normally either way — a locked-out row is never
  // deleted, just unusable; requesting a new OTP always works). Short
  // expiry + a low attempt cap are the only real defense a 6-digit code
  // has against brute-forcing; no rate limit on requestOtp itself
  // exists yet (a future gap, not solved here).
  otp: {
    expireMinutes: Number(process.env.OTP_EXPIRE_MINUTES) || 10,
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
  },

  // Local-disk root DocumentService writes uploaded files under (see
  // ADR-017). Not a secret — a plain path, defaulted like appName/
  // logLevel rather than required() like the connection strings above.
  // docker-compose.yml does not yet mount a persistent volume here —
  // a flagged gap, not solved by this default (see ADR-017's
  // Consequences).
  documentStorageRoot: process.env.DOCUMENT_STORAGE_ROOT || path.join(__dirname, '../storage'),
  documentBackupRoot: process.env.DOCUMENT_BACKUP_ROOT || path.join(__dirname, '../storage-backups'),
  // A real secret (encrypts every stored document at rest) — required(),
  // same as the JWT keys above. Previously defaulted to a public,
  // known literal, which would have silently encrypted production
  // documents with a key visible in this file's own git history.
  documentStorageEncryptionKey: required('DOCUMENT_STORAGE_ENCRYPTION_KEY'),

  // NotificationService's real email channel (Module 8). Deliberately
  // NOT required() like the connection strings/JWT secrets above:
  // this session's own task asks for "a stub/log-only fallback if no
  // provider is configured," so an unset SMTP_HOST must not crash
  // startup — notificationService.js checks for this exact null and
  // logs instead of attempting to send. host has no default at all
  // (empty string/undefined both mean "unconfigured"); the rest have
  // reasonable defaults so a caller only needs to set host+credentials
  // to turn the real channel on.
  smtp: {
    host: process.env.SMTP_HOST || null,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || null,
    password: process.env.SMTP_PASSWORD || null,
    fromAddress: process.env.SMTP_FROM_ADDRESS || 'no-reply@arcnave.local',
  },

  // NotificationService's real sms/whatsapp/email channels are now
  // resolved per-college from college_notification_channels (see
  // notificationChannelRepository.js/notificationService.js's
  // PROVIDER_REGISTRY) — there is no more app-wide sms/whatsapp
  // credential block here. Twilio was the only global provider this
  // config ever held for those two channels; it's been replaced by the
  // per-vendor adapters under services/notificationProviders/ (msg91,
  // meta) and removed, not left as an unused fallback.

  // NVIDIA NIM (OpenAI-compatible /chat/completions) — the GLOBAL
  // default provider ConfigurationService.getAiConfig falls back to
  // for a college with no college_ai_config row of its own (see
  // services/aiProviders/nim.js and services/configurationService.js).
  // Optional, same reasoning as smtp above: unset apiKey means the LLM
  // step is simply unavailable (LlmNotConfiguredError, mapped to a
  // real 503 by routes/ai.js) rather than a startup failure — this
  // app must keep running (every non-LLM route, including the plain
  // tool-invoke path with no `question`) whether or not a provider key
  // exists. Per-tenant override now exists (college_ai_config) — this
  // remains the fallback every pre-existing college without a row
  // still gets, unchanged from before that table existed.
  nim: {
    apiKey: process.env.NIM_API_KEY || null,
    baseUrl: process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    model: process.env.NIM_MODEL || 'meta/llama-3.1-8b-instruct',
    // The RAG slice's embedding model — a SEPARATE model from `model`
    // above (chat completion and embeddings are different model
    // families even within one provider). nv-embedqa-e5-v5 is
    // purpose-built for retrieval (asymmetric query/passage embeddings
    // — see services/aiProviders/nim.js's embed()) and fixes the
    // embedding dimension the ai_document_chunks migration's
    // vector(1024) column is sized against; changing this to a model
    // with a different output dimension needs a new migration, not
    // just this env var.
    embeddingModel: process.env.NIM_EMBEDDING_MODEL || 'nvidia/nv-embedqa-e5-v5',
    // Model routing (P1.3) — an optional smaller/cheaper model for the
    // low-risk half of an askAgent turn (see aiService.js's own
    // comment on where this is/isn't used). No default: unset means no
    // routing happens for the global-default NIM config, same single-
    // model behavior as before this existed.
    fastModel: process.env.NIM_FAST_MODEL || null,
  },

  // Google Gemini — a second, optional global-default provider
  // (configurationService.js's own comment on GLOBAL_CONFIG_BUILDERS).
  // Same "unset means unavailable, never a startup failure" reasoning
  // as nim above — this app must keep running whether or not a Gemini
  // key exists. baseUrl has no default here (gemini.js's own
  // DEFAULT_BASE_URL applies when this is null); embeddingModel is
  // null by default since Gemini's embedContent isn't why a college
  // would set this — chat/vision is.
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || null,
    baseUrl: process.env.GEMINI_BASE_URL || null,
    model: process.env.GEMINI_MODEL || null,
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || null,
    fastModel: process.env.GEMINI_FAST_MODEL || null,
  },

  // Which provider a college with no college_ai_config row of its own
  // falls back to (configurationService.getAiConfig). Defaults to
  // 'nim' — this app's pre-existing global behavior, unchanged unless
  // a deployment explicitly opts a different provider in. Setting this
  // to 'gemini' with the block above populated is enough to make every
  // college with no per-college override use Gemini, with no DB write
  // required.
  defaultAiProvider: process.env.DEFAULT_AI_PROVIDER || 'nim',
};
