import { api } from './client';

// routes/configurations.js — generic per-category config store
// (configurationService.js), already used server-side by web retrieval
// (webRetrievalService.js's CONFIG_CATEGORY = 'web_retrieval') and others.
// Thin wrapper, same shape as every other api/*.js file in this app.
export const configurationsApi = {
  get: (category) => api.get(`/configurations/${category}`),
  // `configuration` is the raw category payload (e.g. { enabled, allowedDomains }
  // for web_retrieval) — never pass an object that already wraps its own
  // `configuration`/`expected_version` keys, or this double-wraps it into the
  // stored row (routes/configurations.js destructures `configuration` and
  // `expected_version` as two separate top-level body fields, not nested).
  update: (category, configuration, expectedVersion) => api.put(`/configurations/${category}`, {
    configuration, expected_version: expectedVersion,
  }),
};
