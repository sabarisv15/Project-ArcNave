'use strict';

const configurationService = require('./configurationService');

// Open Web Search (ADL-061) — the second, separate retrieval tool
// RS-AIG-020's amendment permits, alongside (not replacing)
// webRetrievalService.js's own allowlist-only fetchTrustedPage. Same
// opt-in-per-college shape that file and imageGenerationService.js
// already establish, and the identical hard rule RS-AIG-020's opening
// line states for the allowlist tool applies here without exception: a
// search result's content can inform an answer, it can never authorize
// an ARCNAVE action. This service returns plain result snippets — the
// caller (the web_search AI tool) flows them through the same untrusted-
// data pipeline every other tool result already goes through
// (RS-AIG-003), nothing special-cased for having come from a search
// provider rather than a single fetched page.
//
// Provider: Google Custom Search JSON API (product decision). Needs
// GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID — neither is
// required() in config.js (mirrors sandboxServiceUrl's own "not yet
// configured" shape): this service throws its own
// WebSearchNotConfiguredError at call time until both are set, rather
// than failing the whole backend's startup for a capability that isn't
// live yet.

const config = require('../config');

const CONFIG_CATEGORY = 'web_search';
const SEARCH_TIMEOUT_MS = 8000;
const MAX_RESULTS = 5;
const MAX_SNIPPET_CHARS = 500;

class WebSearchNotConfiguredError extends Error {}
class WebSearchNotEnabledError extends Error {}
class WebSearchValidationError extends Error {}
class WebSearchRequestError extends Error {}

async function getWebSearchConfig(client, collegeId) {
  const row = await configurationService.getConfiguration(client, { collegeId, category: CONFIG_CATEGORY });
  const stored = row ? row.configuration : {};
  return { enabled: Boolean(stored.enabled) };
}

async function search(client, collegeId, query) {
  if (!config.googleSearchApiKey || !config.googleSearchEngineId) {
    throw new WebSearchNotConfiguredError(
      'open web search is not configured yet (GOOGLE_SEARCH_API_KEY / GOOGLE_SEARCH_ENGINE_ID unset) — see ADL-061',
    );
  }
  if (typeof query !== 'string' || !query.trim()) {
    throw new WebSearchValidationError('query is required and must be a non-empty string');
  }

  const searchConfig = await getWebSearchConfig(client, collegeId);
  if (!searchConfig.enabled) {
    throw new WebSearchNotEnabledError('open web search is not enabled for this college — opt in via configuration first');
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', config.googleSearchApiKey);
  url.searchParams.set('cx', config.googleSearchEngineId);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(MAX_RESULTS));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url.toString(), { signal: controller.signal });
  } catch (err) {
    throw new WebSearchRequestError(`search request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new WebSearchRequestError(`search provider returned ${response.status}`);
  }
  const body = await response.json();
  const items = Array.isArray(body.items) ? body.items : [];
  return items.slice(0, MAX_RESULTS).map((item) => ({
    title: String(item.title || '').slice(0, 200),
    url: String(item.link || ''),
    snippet: String(item.snippet || '').slice(0, MAX_SNIPPET_CHARS),
  }));
}

module.exports = {
  WebSearchNotConfiguredError,
  WebSearchNotEnabledError,
  WebSearchValidationError,
  WebSearchRequestError,
  CONFIG_CATEGORY,
  getWebSearchConfig,
  search,
};
