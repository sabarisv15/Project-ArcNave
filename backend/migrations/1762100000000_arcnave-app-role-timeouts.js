'use strict';

// Pre-launch audit finding (P1): no statement_timeout, lock_timeout, or
// idle_in_transaction_session_timeout was configured anywhere — not
// "too generous," genuinely absent at both the app (db/pool.js passes
// no such options to `pg.Pool`) and DB layers. A slow AI-triggered
// query, or a request handler blocked on the self-hosted LLM/an OCR
// child process while still holding its per-request transaction open,
// could hold locks and a pool connection indefinitely with nothing to
// intervene.
//
// Set at the Postgres ROLE level (arcnave_app — the runtime app role
// every request actually connects as, per ADR-015/db/pool.js), not a
// blind flat number applied everywhere: every value below is reasoned
// from this codebase's actual query/transaction shapes, not guessed.
//
// - lock_timeout = 10s: how long a statement will wait to ACQUIRE a
//   lock before giving up. An interactive HTTP request should fail
//   fast on real lock contention (a clean, retryable error) rather
//   than queue silently for minutes — 10s is comfortably above any
//   real single-row lock wait this app's own write patterns produce
//   (see workflowRepository.updatePendingStatus's own conditional-
//   UPDATE pattern, the only place a genuine concurrent-write
//   contention is expected by design) and short enough that a stuck
//   request surfaces quickly instead of silently piling up.
//
// - statement_timeout = 20s: how long a SINGLE SQL statement may run.
//   Checked the two realistic candidates for a genuinely long-running
//   query in this codebase: academicService.generateTimetable's
//   backtracking search (a bounded MAX_GENERATION_ATTEMPTS loop of
//   many small, individually-fast statements, not one long-running
//   query) and reportService's CSV/PDF/Excel export queries (checked:
//   analyticsService.js/searchService.js/reportService.js are all
//   small, few-hundred-line files over a dataset this codebase's own
//   prior sessions already characterized as "hundreds of rows, not
//   millions" — see searchService.js's own deferral note). The
//   repository-level LIMITs added in the prior optimization pass
//   (assessmentMarkRepository/attendanceService/financeService, all
//   capped at 5000 rows) further bound the worst realistic case. 20s
//   is generous headroom above any of these while still catching a
//   genuinely runaway query (e.g. a future missing-index regression)
//   well before it can matter.
//
// - idle_in_transaction_session_timeout = 90s: how long a transaction
//   may sit open between statements. This one has to stay ABOVE two
//   real, legitimate in-transaction waits this app already has, or
//   Postgres would kill a connection out from under a request that was
//   never actually stuck: each AI provider adapter's own 30s
//   AbortController timeout (services/aiProviders/*.js) and the OCR
//   pdftoppm exec timeout added alongside this migration (60s — see
//   ocr/pdfRasterizer.js), both of which can leave the per-request
//   transaction "idle" from Postgres's point of view while real work
//   happens application-side. 90s sits comfortably above both, while
//   still reclaiming a connection a genuinely crashed/abandoned
//   request left open.
//
// These are today's best-available evidence, not final numbers —
// revisit if real production latency data later shows a real workload
// this codebase doesn't have yet.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql("ALTER ROLE arcnave_app SET lock_timeout = '10s'");
  pgm.sql("ALTER ROLE arcnave_app SET statement_timeout = '20s'");
  pgm.sql("ALTER ROLE arcnave_app SET idle_in_transaction_session_timeout = '90s'");
};

exports.down = (pgm) => {
  pgm.sql('ALTER ROLE arcnave_app RESET lock_timeout');
  pgm.sql('ALTER ROLE arcnave_app RESET statement_timeout');
  pgm.sql('ALTER ROLE arcnave_app RESET idle_in_transaction_session_timeout');
};
