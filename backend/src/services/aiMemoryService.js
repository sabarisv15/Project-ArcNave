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

// General freeform facts (product decision, this round — see the
// ai-general-memory migration's own comment for the full "why a second
// table" reasoning). Content is no longer restricted to a fixed
// allowlist of TYPES, so the two properties that previously came for
// free from that allowlist have to be held some other way:
//   - MAX_GENERAL_FACTS bounds total accumulation per user — an
//     unbounded store was exactly the risk the original narrower design
//     avoided; a hard cap keeps that property even though the content
//     itself is now freeform. Once reached, rememberFact refuses (asks
//     the user to forget something first) rather than silently evicting
//     the oldest fact — silent eviction would itself be the kind of
//     "hard to audit" behavior this feature has to avoid.
//   - GENERAL_FACT_IDENTIFIER_PATTERN is a narrow, deterministic
//     backstop for the single most damaging class of accidental PII
//     capture: a bare 5-12 digit identifier-shaped number (a roll
//     number, EMIS number, admission number, phone number — this
//     codebase's own roll_no/regNo values are exactly this shape,
//     documentTableExtractionService.js's own RECORD_START_PATTERN
//     comment). This is not a general PII filter — it cannot catch "the
//     student who sits in the back struggles with algebra," no regex
//     can — the tool's own description (aiToolRegistry.js) is the
//     primary defense for that broader case, same as ai_memory_remember
//     already relies on instruction text alone for it. This guard only
//     ever adds a second, narrower, deterministic layer under the one
//     class of leak a plain digit-count regex genuinely can catch.
const MAX_GENERAL_FACTS = 30;
const GENERAL_FACT_IDENTIFIER_PATTERN = /\b\d{5,12}\b/;

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

function assertValidFact(fact) {
  if (typeof fact !== 'string' || !fact.trim()) {
    throw new AiMemoryValidationError('fact is required and must be a non-empty string');
  }
  if (fact.length > MAX_MEMORY_VALUE_CHARS) {
    throw new AiMemoryValidationError(`fact must be at most ${MAX_MEMORY_VALUE_CHARS} characters`);
  }
  if (GENERAL_FACT_IDENTIFIER_PATTERN.test(fact)) {
    throw new AiMemoryValidationError(
      'this looks like it contains an identifier number (roll number, admission number, phone number, or similar) '
      + 'rather than a plain preference — AI Memory never stores identifier numbers or facts about a specific '
      + 'other person, only the acting user\'s own preferences; rephrase without the number',
    );
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
    await aiMemoryRepository.removeAllGeneralFactsForUser(client, actorUserId);
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

// Called from the ai_memory_remember_fact AI tool handler only — same
// consent gate as rememberPreference, plus the bounded-count check
// MAX_GENERAL_FACTS' own comment explains. Refuses outright at the cap
// rather than evicting silently.
async function rememberFact(client, fact, { actorUserId, collegeId }) {
  assertValidFact(fact);
  const consent = await getConsent(client, { actorUserId });
  if (!consent.consented) {
    throw new AiMemoryConsentRequiredError(
      'this user has not enabled AI memory yet — tell them they can turn it on in AI Memory settings, do not retry',
    );
  }
  const count = await aiMemoryRepository.countGeneralFacts(client, actorUserId);
  if (count >= MAX_GENERAL_FACTS) {
    throw new AiMemoryValidationError(
      `already remembering the maximum of ${MAX_GENERAL_FACTS} things — tell the user AI Memory is full and ask `
      + 'them to forget something first (in AI Memory settings) before adding another',
    );
  }
  return aiMemoryRepository.insertGeneralFact(client, { collegeId, userId: actorUserId, fact: fact.trim() });
}

async function recallGeneralFacts(client, { actorUserId }) {
  return aiMemoryRepository.listGeneralFacts(client, actorUserId);
}

// Revision, not deletion — so unlike forgetFact below, consent IS
// required: rewriting a fact stores new content, and the consent gate
// exists to cover storing, not to cover the row already being there.
// assertValidFact runs on the replacement exactly as it does on a fresh
// one, which is the point of routing this through the service rather
// than letting a caller UPDATE the row: the identifier-number guard
// would otherwise be trivially bypassable by remembering a clean fact
// and then editing a roll number into it.
//
// No MAX_GENERAL_FACTS check here on purpose: an edit replaces one row
// and cannot grow the count, so re-checking a full store would block a
// user from correcting a fact precisely when they are at the cap.
async function reviseFact(client, factId, newFact, { actorUserId }) {
  assertValidFact(newFact);
  const consent = await getConsent(client, { actorUserId });
  if (!consent.consented) {
    throw new AiMemoryConsentRequiredError(
      'this user has not enabled AI memory yet — tell them they can turn it on in AI Memory settings, do not retry',
    );
  }
  const updated = await aiMemoryRepository.updateGeneralFact(client, actorUserId, factId, newFact.trim());
  if (updated === null) {
    throw new AiMemoryValidationError(
      `no remembered fact with id ${JSON.stringify(factId)} belongs to this user — list them first, do not retry with a guessed id`,
    );
  }
  return updated;
}

// Deletion is always allowed regardless of current consent state, same
// reasoning forgetPreference already documents.
async function forgetFact(client, factId, { actorUserId }) {
  await aiMemoryRepository.removeGeneralFact(client, actorUserId, factId);
}

module.exports = {
  AiMemoryValidationError,
  AiMemoryConsentRequiredError,
  ALLOWED_MEMORY_TYPES,
  MAX_GENERAL_FACTS,
  getConsent,
  setConsent,
  rememberPreference,
  recallPreferences,
  forgetPreference,
  rememberFact,
  recallGeneralFacts,
  reviseFact,
  forgetFact,
};
