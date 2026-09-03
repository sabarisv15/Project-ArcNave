'use strict';

// P4 O3 — post-deploy smoke test. Unlike every other script in this
// directory (migrate.js, backup-database.js, restore-database.js,
// query-stats-report.js), this one never opens a DB connection itself
// — it hits a DEPLOYED URL over plain HTTP, the same way a real user
// or load balancer would, to catch "the deploy is up but broken" the
// way the other scripts' direct-DB access never could. Non-mutating
// checks only — this is a boot-sanity check, not an E2E suite.
//
// Usage:
//   SMOKE_TEST_BASE_URL=https://<cloud-run-url> node backend/scripts/smoke-test.js

const BASE_URL = process.env.SMOKE_TEST_BASE_URL;
if (!BASE_URL) {
  console.error("SMOKE_TEST_BASE_URL is required — see this script's own top comment for usage.");
  process.exit(1);
}

const checks = [
  {
    name: 'GET /api/v1/health returns status ok + pool stats',
    async run() {
      const res = await fetch(`${BASE_URL}/api/v1/health`);
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
      const body = await res.json();
      if (body.status !== 'ok') throw new Error(`expected status "ok", got ${JSON.stringify(body.status)}`);
      if (!body.pool || typeof body.pool.total !== 'number') {
        throw new Error(`expected a pool stats object, got ${JSON.stringify(body.pool)}`);
      }
    },
  },
  {
    name: 'GET /api/v1/openapi.json returns a valid schema',
    async run() {
      const res = await fetch(`${BASE_URL}/api/v1/openapi.json`);
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
      const body = await res.json();
      if (!body.openapi && !body.paths) {
        throw new Error(`response doesn't look like an OpenAPI document: ${JSON.stringify(Object.keys(body))}`);
      }
    },
  },
  {
    // A verified requireAuth-gated route with no path params
    // (backend/src/routes/students.js:405-408). A raw 401 (not a
    // 500/502) confirms the app booted its auth middleware correctly
    // rather than crashing before it could reject the request — a
    // real failure mode a missing/misconfigured Secret Manager entry
    // would otherwise produce.
    name: 'GET /api/v1/students with no token returns 401, not a crash',
    async run() {
      const res = await fetch(`${BASE_URL}/api/v1/students`);
      if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    },
  },
];

async function main() {
  let failures = 0;
  for (const check of checks) {
    try {
      // eslint-disable-next-line no-await-in-loop -- small, fixed check set; sequential is deliberate (ordered pass/fail output), same precedent as scripts/backup-database.js
      await check.run();
      console.log(`PASS: ${check.name}`);
    } catch (err) {
      failures += 1;
      console.error(`FAIL: ${check.name} — ${err.message}`);
    }
  }
  if (failures > 0) {
    console.error(`${failures}/${checks.length} smoke checks failed.`);
    process.exit(1);
  }
  console.log(`All ${checks.length} smoke checks passed against ${BASE_URL}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
