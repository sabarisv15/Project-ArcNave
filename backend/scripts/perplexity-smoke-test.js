'use strict';

// Minimal live smoke test for the Perplexity Agent API adapter
// (services/aiProviders/perplexity.js). Prints only the HTTP outcome —
// never the API key, never the full response body — per the "never log
// the key" rule in perplexity.js's own header comment.
//
// Usage (key must already be exported in your own shell):
//   PERPLEXITY_API_KEY=... node backend/scripts/perplexity-smoke-test.js

const perplexity = require('../src/services/aiProviders/perplexity');

async function main() {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    console.error('PERPLEXITY_API_KEY is not set. Create a key at https://console.perplexity.ai and export it.');
    process.exitCode = 1;
    return;
  }

  const cfg = { apiKey, model: process.env.PERPLEXITY_MODEL || undefined };

  try {
    const result = await perplexity.agentAnswer(cfg, {
      userPrompt: 'What is 2 + 2? Answer in one short sentence.',
    });
    console.log('status: 200 OK');
    console.log('output_text length:', result.text.length);
    console.log('search_results count:', result.searchResults.length);
  } catch (err) {
    console.error('smoke test failed:', err.constructor.name, '-', err.message.replace(apiKey, '[REDACTED]'));
    process.exitCode = 1;
  }
}

main();
