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
  // General freeform facts (product decision, this round) — remembering
  // happens only via the ai_memory_remember_fact AI tool in chat, same
  // "no human-driven add" shape the bounded preferences above already
  // have; this is read + forget only, same as `remove` above.
  listFacts: () => api.get('/ai/memory/facts'),
  removeFact: (factId) => api.delete(`/ai/memory/facts/${factId}`),
};
