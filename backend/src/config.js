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

  // Pool sizing/timeouts shared by both db/pool.js Pools. `max` was
  // pg's own library default (10), carried over with no reasoning of
  // its own — a real gap under this app's transaction model: every
  // request holds ONE client for its WHOLE lifetime (db/tenantTransaction.js
  // opens the transaction at request start, releases at res.end), not
  // just per-query, and that lifetime can legitimately run several
  // seconds when an LLM call happens inside it (bounded well under the
  // DB role's own idle_in_transaction_session_timeout=90s — see
  // db/pool.js's comment and 1762100000000_arcnave-app-role-timeouts —
  // but not near-zero). At max=10, an 11th concurrent request across
  // the ENTIRE app (every tenant, not per-college) simply queues for a
  // free connection regardless of how idle Postgres itself is — a real
  // throughput ceiling for a multi-tenant app, not a style nit. Raised
  // to 20: Postgres's own default max_connections is 100, and this
  // value is shared by BOTH appPool and platformPool (db/pool.js), so
  // 20+20=40 leaves comfortable headroom below 100 for the separate
  // migration-owner connection and manual/psql access, while roughly
  // doubling this app's own concurrent-request ceiling versus the
  // unexamined default. Revisit with real concurrent-tenant load data
  // once it exists (CHECKPOINT.md's staged-infra principle — this is
  // an interface-level default, cheap to override per-environment via
  // DB_POOL_MAX without a code change, not a load-bearing architecture
  // decision). statement_timeout is deliberately not here — that's set
  // at the DB role level (see db/pool.js's own comment).
  dbPool: {
    max: Number(process.env.DB_POOL_MAX) || 20,
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

  // Google Gemini — the GLOBAL default provider (chat AND embeddings —
  // see defaultAiProvider/embeddingProvider below) ConfigurationService.
  // getAiConfig falls back to for a college with no college_ai_config
  // row of its own. Auth is Vertex AI + Application Default Credentials
  // (gemini.js), not an API key — so "configured" hinges on projectId,
  // not a secret this block holds. Optional, same reasoning as smtp
  // above: unset projectId means the LLM step is simply unavailable
  // (LlmNotConfiguredError, mapped to a real 503 by routes/ai.js)
  // rather than a startup failure — this app must keep running (every
  // non-LLM route, including the plain tool-invoke path with no
  // `question`) whether or not GEMINI_PROJECT_ID is set. Per-tenant
  // override now exists (college_ai_config) — this remains the
  // fallback every pre-existing college without a row still gets.
  // embeddingModel defaults to gemini-embedding-001 (Google's current
  // unified English/multilingual/code embedding model, a real fit for
  // ARCNAVE's own English/Tamil/Tanglish/tool-description/document mix)
  // — services/aiProviders/gemini.js's embed() requests it truncated to
  // EMBEDDING_DIMENSIONS via Vertex's outputDimensionality parameter,
  // fixing the embedding dimension the ai_document_chunks/
  // ai_tool_embeddings migrations' vector(1024) columns are sized
  // against; changing this to a model/dimension combination gemini.js
  // doesn't already request needs a new migration, not just this env var.
  gemini: {
    projectId: process.env.GEMINI_PROJECT_ID || null,
    location: process.env.GEMINI_LOCATION || null,
    model: process.env.GEMINI_MODEL || null,
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
    fastModel: process.env.GEMINI_FAST_MODEL || null,
  },

  // OpenAI — a third, optional global-default provider. Added alongside
  // the NIM removal specifically so a deployment (or this codebase's own
  // test suite, which needs a simple, globally-configurable OpenAI-
  // compatible fixture provider now that nim — which served exactly this
  // role — is gone) can select it via DEFAULT_AI_PROVIDER the same way
  // gemini/claude already can; openai.js's per-college path
  // (college_ai_config) already worked before this and is unaffected
  // either way. Same "unset apiKey means unavailable, never a startup
  // failure" reasoning as every other optional global block here.
  openai: {
    apiKey: process.env.OPENAI_API_KEY || null,
    model: process.env.OPENAI_MODEL || null,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || null,
    fastModel: process.env.OPENAI_FAST_MODEL || null,
  },

  // Claude on Vertex AI — a fourth, optional global-default provider, same
  // shape/reasoning as gemini above (ADC/projectId, not a secret this
  // block holds; unset means unavailable, never a startup failure).
  // CLAUDE_PROJECT_ID is deliberately its own var, not a reuse of
  // GEMINI_PROJECT_ID, even though a deployment will often set both to
  // the same GCP project — the two providers are independently
  // selectable (DEFAULT_AI_PROVIDER names exactly one), and this adapter
  // has no embed() (see claude.js's own comment), so embeddingModel is
  // intentionally absent here, not just defaulted null.
  claude: {
    projectId: process.env.CLAUDE_PROJECT_ID || null,
    location: process.env.CLAUDE_LOCATION || null,
    model: process.env.CLAUDE_MODEL || null,
    fastModel: process.env.CLAUDE_FAST_MODEL || null,
  },

  // Which provider a college with no college_ai_config row of its own
  // falls back to (configurationService.getAiConfig). Defaults to
  // 'gemini' — Gemini is this app's global-default chat provider.
  // Setting this to 'claude'/'openai'/'self_hosted' with that block
  // populated is enough to make every college with no per-college
  // override use it instead, with no DB write required.
  defaultAiProvider: process.env.DEFAULT_AI_PROVIDER || 'gemini',

  // The embedding provider — deliberately a SEPARATE choice from
  // defaultAiProvider/a college's own chat provider (embeddingService.js's
  // own file comment has the full reasoning): tool retrieval and
  // document search both need embeddings regardless of which provider a
  // college picked for chat, and Claude has no embed() at all (see
  // claude.js's own comment) — tying embeddings to the chat provider
  // would silently break both features for any Claude-configured
  // college. Defaults to 'gemini', which ships a real embedding model
  // default (gemini.embeddingModel above) even with zero env
  // configuration beyond GEMINI_PROJECT_ID. This is a single
  // platform-wide choice, never a per-college override — embeddings
  // are retrieval infrastructure, not a tenant-facing customization —
  // and stays independently swappable from defaultAiProvider even
  // though both currently default to the same provider (e.g. a future
  // Claude-for-chat + Gemini-for-embeddings college is still exactly
  // as supported as it was before this change).
  embeddingProvider: process.env.EMBEDDING_PROVIDER || 'gemini',

  // ADR-030 P2(c) — bounds TOOL EXECUTIONS per askAgent turn, not LLM
  // calls (a turn at the cap can cost cap+1 completeWithTools calls: one
  // decision call plus one continuation per executed tool). `1` is
  // compatibility mode — the loop's first iteration hits the cap
  // immediately and falls into the same old-shape synthesis call the
  // pre-loop code always made, so this is the safe, provably-inert
  // default. `2`-`5` turn on the real adaptive loop (the model sees each
  // tool's result and may call another before answering). Hard-ceilinged
  // at 5 in code (MAX_TOOL_CALLS_PER_TURN_CEILING in aiService.js) —
  // deliberately not raisable via env var alone, since an unbounded value
  // here would turn ARCNAVE into an unrestricted autonomous agent rather
  // than a bounded tool-use turn. Validated with a strict integer-string
  // pattern, not bare parseInt (parseInt('3abc', 10) and parseInt('2.5',
  // 10) both silently return a "valid" integer and must not be accepted).
  maxToolCallsPerTurn: (() => {
    const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 1;
    const MAX_TOOL_CALLS_PER_TURN_CEILING = 5;
    const ERROR = `MAX_TOOL_CALLS_PER_TURN must be an integer between 1 and ${MAX_TOOL_CALLS_PER_TURN_CEILING}`;
    const raw = process.env.MAX_TOOL_CALLS_PER_TURN;
    if (raw === undefined || raw === '') return DEFAULT_MAX_TOOL_CALLS_PER_TURN;
    if (!/^[1-9]\d*$/.test(raw)) throw new Error(ERROR);
    const value = Number(raw);
    if (value > MAX_TOOL_CALLS_PER_TURN_CEILING) throw new Error(ERROR);
    return value;
  })(),

  // ADL-059 — the credential-less code-execution sandbox. Deliberately
  // NOT `required()`: this is a separate, not-yet-deployed service (see
  // sandboxExecutionService.js's own file comment), so the main backend
  // must start up fine with it entirely absent — sandboxExecutionService
  // throws its own SandboxNotConfiguredError at call time instead,
  // same shape webRetrievalService/imageGenerationService already use
  // for "the capability exists in code before its infra/config does."
  // No API key lives here: the sandbox service is a separate deployment
  // with its own auth, never a value this main backend's own env holds.
  sandboxServiceUrl: process.env.SANDBOX_SERVICE_URL || null,
  // Must match sandbox-service's own SANDBOX_SHARED_SECRET — the second,
  // independent auth layer alongside Cloud Run IAM invoker auth (see
  // sandbox-service/server.js's own file comment).
  sandboxServiceToken: process.env.SANDBOX_SERVICE_TOKEN || null,
  // Cloud Run IAM invoker auth, the primary boundary in front of the
  // shared secret above. Opt-in rather than inferred from the URL: the
  // same image runs in docker-compose and in tests with no Google
  // credentials anywhere, and a deployment that silently decided to
  // demand them would fail at call time instead of at config time.
  sandboxServiceIamAuth: process.env.SANDBOX_SERVICE_IAM_AUTH === 'true',
  // The sandbox invoker service account's own key file — deliberately
  // NOT the same variable as GOOGLE_APPLICATION_CREDENTIALS, which
  // gemini.js/claude.js already read for the Gemini/Claude-on-Vertex
  // ADC (see sandboxExecutionService.js's own comment on
  // getIdTokenClient). Unset is a valid, supported state: GoogleAuth
  // then falls back to its own ADC discovery.
  sandboxServiceCredentialsPath: process.env.SANDBOX_SERVICE_CREDENTIALS_PATH || null,

  // ADL-061 — open web search. Originally Google Custom Search JSON
  // API; that API is closed to new projects ahead of its 2027-01-01
  // discontinuation and returns a permanent 403 no matter how it is
  // configured, so the provider is now selectable rather than baked in
  // (webSearchService.js's own file comment carries the evidence).
  // WEB_SEARCH_PROVIDER picks between 'brave' and 'tavily'; the key is
  // whichever that provider issues. Not required() — webSearchService
  // throws WebSearchNotConfiguredError at call time until it is set,
  // same "capability exists in code before its credentials do" shape as
  // sandboxServiceUrl above.
  webSearchProvider: process.env.WEB_SEARCH_PROVIDER || 'brave',
  webSearchApiKey: process.env.WEB_SEARCH_API_KEY || null,
  // Retained only so an existing .env.local.sh that still sets these
  // does not silently look configured while pointing at the dead API.
  // Nothing reads them any more.
  googleSearchApiKey: process.env.GOOGLE_SEARCH_API_KEY || null,
  googleSearchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID || null,

  // Weather fetch (OpenWeatherMap) — same not-yet-configured shape.
  openWeatherApiKey: process.env.OPENWEATHER_API_KEY || null,
};
