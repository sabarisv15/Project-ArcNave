'use strict';

const createApp = require('./app');
const config = require('./config');
const { startPlatformStatsSync } = require('./jobs/platformStatsSync');

const app = createApp();
const port = process.env.PORT || 8000;

app.listen(port, () => {
  console.log(`ARCNAVE backend listening on port ${port}`);
  // Review Finding #5 — this experimental path is expensive (~13k tokens
  // per LLM call, resent on every call in a turn) and off by default; the
  // only way it's ever true is an explicit, untracked local override. A
  // silent startup carries no signal either way, so a deployment that
  // picked this up by accident (e.g. a stray override file) would have no
  // way to notice short of reading traffic costs. Non-sensitive: a single
  // boolean, never the instruction text itself.
  if (config.experimentalFullInstructionsDocument) {
    console.log(
      'WARNING: experimentalFullInstructionsDocument is ENABLED — every LLM call in every turn will carry the full ~13k-token experimental operating-instructions document instead of the compact default prompts. Testing-phase only; turn this off outside a deliberate, time-boxed live trial.',
    );
  }
});

startPlatformStatsSync();
