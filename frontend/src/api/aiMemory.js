import { api } from './client';

// routes/aiMemory.js — Scoped AI Preference Memory. Always the caller's own
// account (backend resolves the actor from the auth token, never a
// caller-supplied user id) — same shape as api/userPreferences.js would be
// if one existed. Consent can only be changed here, via a real human action
// on this page — no AI tool can call PUT /ai/memory/consent (see
// aiMemoryService.js's own file comment for why that split is the actual
// safety property).
export const aiMemoryApi = {
  getConsent: () => api.get('/ai/memory/consent'),
  setConsent: (consented) => api.put('/ai/memory/consent', { consented }),
  list: () => api.get('/ai/memory'),
  remove: (memoryType) => api.delete(`/ai/memory/${memoryType}`),
};
