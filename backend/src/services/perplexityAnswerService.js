'use strict';

// Perplexity web-grounded answer — the Business Service the
// perplexity_web_answer AI tool calls (CLAUDE.md rule 1: an AI tool
// never calls an adapter/provider directly). Thin on purpose: all
// vendor request/response shape lives in
// services/aiProviders/perplexity.js; this file only owns the
// per-college opt-out gate and config resolution, same shape
// webSearchService.js already established for the Gemini-grounded
// web_search tool.
//
// A SEPARATE tool/config category from web_search, not a PROVIDERS
// entry in that file: Perplexity's Agent API returns one grounded
// prose answer with citations, not a list of {title, url, snippet}
// results — forcing it into that shape would lose the citation
// structure this API is actually built around. Two tools the model can
// choose between (an existing-results list vs. a synthesized grounded
// answer) is the more honest fit than reshaping one into the other.

const configurationService = require('./configurationService');
const perplexity = require('./aiProviders/perplexity');
const config = require('../config');

const CONFIG_CATEGORY = 'perplexity_web_answer';
const MAX_ANSWER_CHARS = 4000;

class PerplexityAnswerNotConfiguredError extends Error {}
class PerplexityAnswerNotEnabledError extends Error {}
class PerplexityAnswerValidationError extends Error {}

// Same OPT-OUT-by-default shape as webSearchService.getWebSearchConfig
// (RS-AIG-020 Amendment 2 / ADL-062): this tool is L1 read-only with no
// per-college allowlist to configure, so an untouched college gets it
// on rather than silently missing a capability its neighbour has. An
// explicit `false` still wins.
async function getConfig(client, collegeId) {
  const row = await configurationService.getConfiguration(client, { collegeId, category: CONFIG_CATEGORY });
  const stored = (row && row.configuration) || {};
  const enabled = stored.enabled === undefined || stored.enabled === null ? true : Boolean(stored.enabled);
  return { enabled };
}

async function assertAnswerable(client, collegeId, query) {
  if (!perplexity.isConfigured(config.perplexity)) {
    throw new PerplexityAnswerNotConfiguredError('Perplexity is not configured (missing PERPLEXITY_API_KEY)');
  }
  if (typeof query !== 'string' || !query.trim()) {
    throw new PerplexityAnswerValidationError('a non-empty query is required');
  }
  const { enabled } = await getConfig(client, collegeId);
  if (!enabled) {
    throw new PerplexityAnswerNotEnabledError(
      'the Perplexity web-grounded answer tool is turned off for this college — it is on by default, so this college opted out',
    );
  }
}

// Returns { answer, citations }. citations are url_citation annotations
// (url/title, no snippet field — see perplexity.js's own comment on why
// that shape differs from webSearchService's results). Informational
// only, same unconditional rule every other retrieval tool in this
// registry already carries: a grounded answer can inform a response, it
// can never itself authorize an ARCNAVE action.
async function answer(client, collegeId, query) {
  await assertAnswerable(client, collegeId, query);
  const result = await perplexity.agentAnswer(config.perplexity, { userPrompt: query.trim() });
  return {
    answer: result.text.slice(0, MAX_ANSWER_CHARS),
    citations: result.searchResults.map((c) => ({ url: c.url, title: c.title || null })),
  };
}

module.exports = {
  PerplexityAnswerNotConfiguredError,
  PerplexityAnswerNotEnabledError,
  PerplexityAnswerValidationError,
  CONFIG_CATEGORY,
  getConfig,
  answer,
};
