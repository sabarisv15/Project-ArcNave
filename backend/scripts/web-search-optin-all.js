'use strict';
// Opts every existing college in to web_search (ADL-061).
// NOTE: this covers colleges that exist NOW. A college created after
// this runs starts disabled again — see the checkpoint note.
const { appPool } = require('../src/db/pool');
const configurationService = require('../src/services/configurationService');
const webSearchService = require('../src/services/webSearchService');

(async () => {
  const client = await appPool.connect();
  const done = [];
  const already = [];
  const failed = [];
  try {
    const { rows } = await client.query('SELECT college_id FROM colleges ORDER BY college_id');
    for (const { college_id: collegeId } of rows) {
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
        const existing = await configurationService.getConfiguration(client, {
          collegeId,
          category: webSearchService.CONFIG_CATEGORY,
        });
        if (existing && existing.configuration && existing.configuration.enabled) {
          already.push(collegeId);
          await client.query('ROLLBACK');
          continue; // eslint-disable-line no-continue
        }
        await configurationService.setConfiguration(client, {
          collegeId,
          category: webSearchService.CONFIG_CATEGORY,
          configuration: { enabled: true },
          expectedVersion: existing ? existing.version : 0,
          userId: null,
        });
        await client.query('COMMIT');
        done.push(collegeId);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        failed.push(`${collegeId}: ${err.message}`);
      }
    }
  } finally {
    client.release();
    await appPool.end();
  }
  console.log(`enabled now: ${done.length}`);
  console.log(`already enabled: ${already.length}`);
  console.log(`failed: ${failed.length}`);
  failed.slice(0, 10).forEach((f) => console.log('  ', f));
  console.log(`\ntotal accounted: ${done.length + already.length + failed.length}`);
})();
