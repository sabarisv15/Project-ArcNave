'use strict';
// Read-only-ish live check for the Gemini search-grounding provider (F1).
// Opts the demo college in (idempotent) and runs one real grounded call.
const { appPool } = require('../src/db/pool');
const configurationService = require('../src/services/configurationService');
const webSearchService = require('../src/services/webSearchService');

const COLLEGE_ID = process.env.PROBE_COLLEGE_ID || 'demo';

(async () => {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [COLLEGE_ID]);
    const existing = await configurationService.getConfiguration(client, {
      collegeId: COLLEGE_ID, category: webSearchService.CONFIG_CATEGORY,
    });
    if (!existing || !existing.configuration || !existing.configuration.enabled) {
      await configurationService.setConfiguration(client, {
        collegeId: COLLEGE_ID,
        category: webSearchService.CONFIG_CATEGORY,
        configuration: { enabled: true },
        expectedVersion: existing ? existing.version : 0,
        userId: null,
      });
      console.log('opted in:', COLLEGE_ID);
    } else {
      console.log('already opted in:', COLLEGE_ID);
    }
    await client.query('COMMIT');

    // set_config(..., true) is TRANSACTION-local, so the tenant setting
    // died with the COMMIT above. The read below runs under RLS and
    // would find nothing without this — which reads as "not opted in".
    await client.query("SELECT set_config('app.current_tenant', $1, false)", [COLLEGE_ID]);

    const query = process.argv[2] || 'What is the current AICTE approval process for engineering colleges in India?';
    console.log('\nquery:', query);
    const t0 = Date.now();
    const results = await webSearchService.search(client, COLLEGE_ID, query);
    console.log(`\n${results.length} results in ${Date.now() - t0}ms\n`);
    results.forEach((r, i) => {
      console.log(`[${i + 1}] ${r.title}`);
      console.log(`    url: ${r.url.slice(0, 110)}`);
      console.log(`    snippet: ${r.snippet.slice(0, 160) || '(none)'}\n`);
    });
  } catch (err) {
    console.error('FAILED:', err.constructor.name, '-', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await appPool.end();
  }
})();
