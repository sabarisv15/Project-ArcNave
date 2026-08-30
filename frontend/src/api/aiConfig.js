import { api } from './client';

// routes/aiConfig.js — per-college AI provider config + read-only
// ops/capability summaries. Thin wrapper, same shape as every other
// api/*.js file in this app.
export const aiConfigApi = {
  get: () => api.get('/ai-config'),
  getCapabilities: () => api.get('/ai-config/capabilities'),
  // CEO Vertex/Gemini audit #40/#41/#42/C20/C21 (2026-08-30) — fallback
  // status, last-observed model version, and monthly cost/rate-limit
  // usage, all previously invisible anywhere in the app.
  getOpsStatus: () => api.get('/ai-config/ops-status'),
};
