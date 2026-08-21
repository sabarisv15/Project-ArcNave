'use strict';

// Scoped AI Preference Memory — see the migration's own comment for the
// full "why two new tables, not a reuse of user_preferences" reasoning.
// The one safety property this whole module exists to hold: consent can
// ONLY be granted or revoked through setConsent, called only from the real
// human-driven route (routes/aiMemory.js) — there is deliberately no AI
// tool anywhere that can call setConsent. The AI can ask the user to turn
// this on (in its own reply text), but it can never turn it on for them.
// Revoking consent synchronously deletes every remembered fact for that
// user (never left "orphaned but inert") — the safe default for something
// framed as consent, not just a display preference.

const aiMemoryRepository = require('../repositories/aiMemoryRepository');

class AiMemoryValidationError extends Error {}
class AiMemoryConsentRequiredError extends Error {}

// A bounded, structured allowlist — the same "never a freeform key an LLM
// picks from open conversation" reasoning aiToolRegistry.js's own
// AI_ALLOWED_PREFERENCE_KEYS already establishes for the narrower
// report_format/default_chart/language set. This list is deliberately
// about how the user wants to work with the AI (communication style,
// recurring focus areas, terminology), never a place to remember facts,
// notes, or opinions about a student, staff member, or anyone else — the
// exact "unbounded/unauditable PII retention risk" CHECKPOINT.md's own
// roadmap section flagged as the reason this feature has to stay scoped.
const ALLOWED_MEMORY_TYPES = ['communication_style', 'recurring_focus_area', 'preferred_terminology', 'response_length'];

// A memory value is one short, human-entered string — not a document, not
// a nested object. Keeps a single remembered fact bounded and keeps the
// eventual prompt hint (aiService.buildMemoryHint) a fixed, small size
// regardless of how many memory_types get set.
const MAX_MEMORY_VALUE_CHARS = 300;

function assertValidMemoryType(memoryType) {
  if (!ALLOWED_MEMORY_TYPES.includes(memoryType)) {
    throw new AiMemoryValidationError(
      `memoryType must be one of ${ALLOWED_MEMORY_TYPES.map((t) => JSON.stringify(t)).join(', ')}, got ${JSON.stringify(memoryType)}`,
    );
  }
}

function assertValidValue(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AiMemoryValidationError('value is required and must be a non-empty string');
  }
  if (value.length > MAX_MEMORY_VALUE_CHARS) {
    throw new AiMemoryValidationError(`value must be at most ${MAX_MEMORY_VALUE_CHARS} characters`);
  }
}

async function getConsent(client, { actorUserId }) {
  const row = await aiMemoryRepository.getConsent(client, actorUserId);
  return { consented: Boolean(row && row.consented), consentedAt: row ? row.consented_at : null };
}

// The only place consent may change — see the file header. `consented`
// must be a real boolean, never coerced from a truthy string, since this
// is a real privacy decision, not a display toggle.
async function setConsent(client, consented, { actorUserId, collegeId }) {
  if (typeof consented !== 'boolean') {
    throw new AiMemoryValidationError('consented must be a boolean');
  }
  const row = await aiMemoryRepository.upsertConsent(client, { collegeId, userId: actorUserId, consented });
  if (!consented) {
    await aiMemoryRepository.removeAllMemoryForUser(client, actorUserId);
  }
  return { consented: row.consented, consentedAt: row.consented_at };
}

// Called from the ai_memory_remember AI tool handler — never from a human-
// driven route (a person can already write anything they want to their own
// account; this gate exists specifically to stop the AI from writing
// without an explicit prior "yes" from the human).
async function rememberPreference(client, memoryType, value, { actorUserId, collegeId }) {
  assertValidMemoryType(memoryType);
  assertValidValue(value);
  const consent = await getConsent(client, { actorUserId });
  if (!consent.consented) {
    throw new AiMemoryConsentRequiredError(
      'this user has not enabled AI memory yet — tell them they can turn it on in AI Memory settings, do not retry',
    );
  }
  return aiMemoryRepository.upsertMemory(client, {
    collegeId, userId: actorUserId, memoryType, value: value.trim(),
  });
}

async function recallPreferences(client, { actorUserId }) {
  return aiMemoryRepository.listMemoryByUser(client, actorUserId);
}

// Deletion is always allowed regardless of current consent state — a user
// must always be able to clear a specific remembered fact, consent gate or
// not (mirrors userPreferenceService.deletePreference's own no-gate shape).
async function forgetPreference(client, memoryType, { actorUserId }) {
  assertValidMemoryType(memoryType);
  await aiMemoryRepository.removeMemory(client, actorUserId, memoryType);
}

module.exports = {
  AiMemoryValidationError,
  AiMemoryConsentRequiredError,
  ALLOWED_MEMORY_TYPES,
  getConsent,
  setConsent,
  rememberPreference,
  recallPreferences,
  forgetPreference,
};
