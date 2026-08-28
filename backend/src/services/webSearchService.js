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
// PROVIDER HISTORY — do not re-litigate this by trying Google again.
// The original provider was the Google Custom Search JSON API. It was
// configured correctly (API enabled, billing linked, key scoped, quota
// unused) and still returned a permanent 403: "This project does not
// have the access to Custom Search JSON API." Root cause is not
// configuration — Google closed that API to new customers/projects
// ahead of its 2027-01-01 discontinuation. No amount of setup fixes it.
//
// So the provider is now selected by config rather than baked in, and
// three are implemented: Brave Search (independent index), Tavily
// (built for agent/LLM search), and Gemini search-grounding. All three
// are single-key setups — none needs the Google engine-id dance. Adding
// a fourth is a new PROVIDERS entry, not another rewrite of this file.
//
// 'gemini' is the owner's chosen provider (2026-08-28) and is
// structurally unlike the other two: it is not a search index with an
// API in front of it, it is a model call whose answer is grounded in a
// search Google runs on our behalf. Three consequences that are NOT
// defects to be fixed later, they are what this provider is:
//
//   1. It needs a Generative Language API key (GEMINI_WEB_SEARCH_API_KEY),
//      NOT the Vertex AI + ADC path config.gemini already uses for chat
//      and embeddings. Deliberately a separate credential and a separate
//      config field — a search key with a different scope, quota and
//      blast radius should not be the same secret that can run the whole
//      chat pipeline.
//   2. Result URLs come back as Google redirect links
//      (vertexaisearch.cloud.google.com/grounding-api-redirect/...),
//      not the publisher's own URL. The redirect resolves in a browser;
//      it is not a URL to string-match a domain allowlist against. Any
//      future "is this source trusted" check must resolve it first —
//      which is exactly why RS-AIG-020 keeps fetchTrustedPage's
//      allowlist as a SEPARATE tool rather than folding it into this one.
//   3. Snippets are assembled from the model's own grounded answer text,
//      not quoted from the page. They are a paraphrase, and callers must
//      not treat them as verbatim source text.
//
// A grounded call returns no results at all when Google decides the
// query needed no search. That is reported as an empty array, the same
// as any other zero-result search — never as a failure, and never
// backfilled from the model's ungrounded knowledge.

const config = require('../config');

const CONFIG_CATEGORY = 'web_search';
const SEARCH_TIMEOUT_MS = 8000;
const MAX_RESULTS = 5;
// A "fast" search is the same provider call with a smaller result set —
// the consumer platform's web_search_fast/web_search split is about how
// much context a lookup is worth spending, not about a different index.
// Modelling it as a separate provider would be inventing a distinction
// neither Brave nor Tavily actually offers.
const MAX_FAST_RESULTS = 3;
const MAX_IMAGE_RESULTS = 8;
const MAX_SNIPPET_CHARS = 500;

class WebSearchNotConfiguredError extends Error {}
class WebSearchNotEnabledError extends Error {}
class WebSearchValidationError extends Error {}
class WebSearchRequestError extends Error {}

function truncate(value, maxChars) {
  return String(value || '').slice(0, maxChars);
}

// Each provider declares how to build a request and how to read its
// response. Nothing else in this file knows which one is active.
const PROVIDERS = {
  brave: {
    buildWebRequest(query, count) {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(count));
      return { url, headers: { Accept: 'application/json', 'X-Subscription-Token': config.webSearchApiKey } };
    },
    readWebResults(body) {
      const results = body && body.web && Array.isArray(body.web.results) ? body.web.results : [];
      return results.map((item) => ({
        title: truncate(item.title, 200),
        url: String(item.url || ''),
        snippet: truncate(item.description, MAX_SNIPPET_CHARS),
      }));
    },
    buildImageRequest(query, count) {
      const url = new URL('https://api.search.brave.com/res/v1/images/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(count));
      return { url, headers: { Accept: 'application/json', 'X-Subscription-Token': config.webSearchApiKey } };
    },
    readImageResults(body) {
      const results = body && Array.isArray(body.results) ? body.results : [];
      return results.map((item) => ({
        title: truncate(item.title, 200),
        imageUrl: String((item.properties && item.properties.url) || ''),
        sourceUrl: String(item.url || ''),
      }));
    },
  },
  tavily: {
    buildWebRequest(query, count) {
      const url = new URL('https://api.tavily.com/search');
      return {
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.webSearchApiKey}` },
        body: JSON.stringify({ query, max_results: count }),
      };
    },
    readWebResults(body) {
      const results = body && Array.isArray(body.results) ? body.results : [];
      return results.map((item) => ({
        title: truncate(item.title, 200),
        url: String(item.url || ''),
        snippet: truncate(item.content, MAX_SNIPPET_CHARS),
      }));
    },
    // Tavily has no dedicated image index — it returns images alongside
    // a normal web search. Declared explicitly as unsupported rather
    // than faked, so image_search fails honestly on this provider
    // instead of silently returning nothing.
    buildImageRequest: null,
    readImageResults: null,
  },
  gemini: {
    // Its own key, never config.gemini's Vertex/ADC credentials — see
    // the file comment's point 1.
    apiKey: () => config.geminiWebSearchApiKey,
    keyEnvVar: 'GEMINI_WEB_SEARCH_API_KEY',
    buildWebRequest(query, count) {
      const url = new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiWebSearchModel}:generateContent`,
      );
      return {
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.geminiWebSearchApiKey,
        },
        // The prompt asks for a search-shaped answer rather than a
        // conversational one, because everything this service returns is
        // derived from groundingMetadata — the prose is only the raw
        // material the snippets are cut from. count is a hint; Google
        // decides how many sources it actually grounds against, and
        // runWebSearch slices to count afterwards regardless.
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: `Search the web and summarise what the most relevant ${count} sources say about: ${query}` }],
          }],
          tools: [{ google_search: {} }],
        }),
      };
    },
    readWebResults(body) {
      const candidate = body && Array.isArray(body.candidates) ? body.candidates[0] : null;
      const meta = candidate && candidate.groundingMetadata;
      const chunks = meta && Array.isArray(meta.groundingChunks) ? meta.groundingChunks : [];
      // groundingSupports ties spans of the answer text back to the
      // chunk indices that support them. That mapping is the only thing
      // resembling a per-source snippet this API offers, so it is built
      // here rather than leaving every snippet empty.
      const supports = meta && Array.isArray(meta.groundingSupports) ? meta.groundingSupports : [];
      const snippetByChunk = new Map();
      supports.forEach((support) => {
        const text = support && support.segment && support.segment.text;
        if (!text) return;
        const indices = Array.isArray(support.groundingChunkIndices) ? support.groundingChunkIndices : [];
        indices.forEach((i) => {
          const existing = snippetByChunk.get(i);
          snippetByChunk.set(i, existing ? `${existing} ${text}` : text);
        });
      });
      return chunks.map((chunk, i) => {
        const web = (chunk && chunk.web) || {};
        return {
          title: truncate(web.title, 200),
          url: String(web.uri || ''),
          snippet: truncate(snippetByChunk.get(i) || '', MAX_SNIPPET_CHARS),
        };
      }).filter((result) => result.url !== '');
    },
    // Search grounding has no image index. Declared unsupported rather
    // than faked, same as Tavily — image_search fails honestly on this
    // provider instead of silently returning nothing.
    buildImageRequest: null,
    readImageResults: null,
  },
};

function activeProvider() {
  const provider = PROVIDERS[config.webSearchProvider];
  if (!provider) {
    throw new WebSearchNotConfiguredError(
      `WEB_SEARCH_PROVIDER ${JSON.stringify(config.webSearchProvider)} is not a provider this service implements `
      + `(expected one of ${Object.keys(PROVIDERS).join(', ')})`,
    );
  }
  return provider;
}

async function getWebSearchConfig(client, collegeId) {
  const row = await configurationService.getConfiguration(client, { collegeId, category: CONFIG_CATEGORY });
  const stored = row ? row.configuration : {};
  return { enabled: Boolean(stored.enabled) };
}

// The four gates every search goes through, in the order that fails
// cheapest first: is a provider configured at all, is the query real,
// is this college opted in, and only then does a billable call happen.
async function assertSearchable(client, collegeId, query) {
  // Provider first, then ITS key. The order matters: providers do not
  // share one credential (gemini reads its own Generative Language API
  // key, never config.gemini's Vertex/ADC path), so checking a single
  // hardcoded field first would report the wrong variable as missing.
  const provider = activeProvider();
  const apiKey = provider.apiKey ? provider.apiKey() : config.webSearchApiKey;
  if (!apiKey) {
    throw new WebSearchNotConfiguredError(
      `open web search is not configured yet (${provider.keyEnvVar || 'WEB_SEARCH_API_KEY'} unset `
      + `for provider ${JSON.stringify(config.webSearchProvider)}) — see ADL-061`,
    );
  }
  if (typeof query !== 'string' || !query.trim()) {
    throw new WebSearchValidationError('query is required and must be a non-empty string');
  }
  const searchConfig = await getWebSearchConfig(client, collegeId);
  if (!searchConfig.enabled) {
    throw new WebSearchNotEnabledError('open web search is not enabled for this college — opt in via configuration first');
  }
  return provider;
}

async function callProvider({
  url, method, headers, body,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url.toString(), {
      method: method || 'GET', headers, body, signal: controller.signal,
    });
  } catch (err) {
    throw new WebSearchRequestError(`search request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new WebSearchRequestError(`search provider returned ${response.status}`);
  }
  return response.json();
}

async function runWebSearch(client, collegeId, query, count) {
  const provider = await assertSearchable(client, collegeId, query);
  const body = await callProvider(provider.buildWebRequest(query.trim(), count));
  return provider.readWebResults(body).slice(0, count);
}

async function search(client, collegeId, query) {
  return runWebSearch(client, collegeId, query, MAX_RESULTS);
}

async function searchFast(client, collegeId, query) {
  return runWebSearch(client, collegeId, query, MAX_FAST_RESULTS);
}

// image_search — returns URLs only, never bytes. ARCNAVE does not
// proxy, cache or store a third-party image: doing so would put
// unreviewed external binary content inside DocumentService, which owns
// institutional documents. The frontend renders these as external
// references, which also keeps the provider's own attribution intact.
async function searchImages(client, collegeId, query) {
  const provider = await assertSearchable(client, collegeId, query);
  if (!provider.buildImageRequest) {
    throw new WebSearchNotConfiguredError(
      `the configured search provider ${JSON.stringify(config.webSearchProvider)} does not support image search`,
    );
  }
  const body = await callProvider(provider.buildImageRequest(query.trim(), MAX_IMAGE_RESULTS));
  return provider.readImageResults(body).slice(0, MAX_IMAGE_RESULTS);
}

module.exports = {
  WebSearchNotConfiguredError,
  WebSearchNotEnabledError,
  WebSearchValidationError,
  WebSearchRequestError,
  CONFIG_CATEGORY,
  MAX_RESULTS,
  MAX_FAST_RESULTS,
  MAX_IMAGE_RESULTS,
  PROVIDERS,
  getWebSearchConfig,
  search,
  searchFast,
  searchImages,
};
