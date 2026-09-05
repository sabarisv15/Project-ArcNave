'use strict';

// ARCNAVE modernization P2 (PDF 1.3 / clash C1) — the greeting / small-talk
// classifier.
//
// Today a bare "hi" runs the entire Curriculum pipeline: an embedding
// lookup to shortlist tools (PDF 1.10 — one extra network call every
// turn), the ~2,176-token always-on tool catalogue, and the describe_tools
// recovery meta-tool, all so the model can decide it needs none of them
// to say "Hello!". This classifier lets askAgent recognise that class of
// turn up front and take the same structural no-tool path the
// experimentalZeroToolFastPath / Research mode already use — WITHOUT the
// embedding call, and without ever depending on a similarity threshold
// happening to return an empty set.
//
// Clash C1 discipline (written into the approved spec): ARCNAVE's
// no-meaning-based-routing rule is about choosing RULE/INSTRUCTION chunks
// — a missed rule chunk is a silent governance regression. This
// classifier chooses TOOLS ONLY. The decision LLM call still happens with
// the full, unchanged policy segments (aiPolicyAssembly.buildPolicy), so
// rule-following is byte-identical to a non-greeting turn; the only thing
// that changes is that zero tools + no catalogue + no describe_tools are
// offered. It is also NOT an AI classification step — it is a deterministic
// whitelist match, no model call, no I/O.
//
// Design bias: FALSE POSITIVES are the only real harm (a genuine task
// misread as chit-chat would lose its tools for that turn — describe_tools
// is gone too, so there is no in-turn recovery). So this is whitelist-only:
// the ENTIRE normalised message must match one of a small, fixed set of
// patterns. Anything longer, anything with a digit, anything with an
// embedded question — not conversational, full pipeline runs.

// Strip leading/trailing whitespace, collapse internal runs, lowercase,
// and drop trailing punctuation / common emoji so "Hi!!", "hello 🙂" and
// "  Hello  " all normalise to the same token. A question mark is only
// tolerated when trailing (kept out of the middle by the anchored
// patterns below).
function normalise(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[!.?…]+$/u, '')
    .trim();
}

// Each pattern is anchored to the whole string. Kept deliberately short —
// every one is a complete utterance that carries no task, no entity, no
// question ARCNAVE data could answer.
const CONVERSATIONAL_PATTERNS = [
  // greetings
  /^(hi+|hey+|hello+|hiya|yo|sup|hai|helo)( there| everyone| team| all)?$/,
  /^good (morning|afternoon|evening|day|night)( to you)?$/,
  /^(howdy|greetings)$/,
  // "how are you" family (no ARCNAVE-answerable content)
  /^how (are|r) (you|u|ya)( doing| going)?$/,
  /^how's it going$/,
  /^hope you('re| are) (well|doing well|good)$/,
  /^how have you been$/,
  // acknowledgements / closings
  /^(thanks|thank you|thanks a lot|thank you so much|thx|ty|tysm|cheers|much appreciated)$/,
  /^(ok|okay|kk|cool|nice|great|awesome|perfect|got it|understood|noted|sounds good|fair enough|alright|all right)$/,
  /^(bye|goodbye|good bye|see you|see ya|see you later|cya|take care|talk later|catch you later)$/,
  /^(no worries|np|you're welcome|welcome)$/,
  // Tamil / Tanglish small talk
  /^vanakkam$/,
  /^nandri( nanba| thala)?$/,
  /^(epdi|eppadi|epadi) (irukinga|irukkinga|iruken|irukeenga|irukkeenga|iruka)$/,
  /^nalla iruken$/,
  /^(sari|seri|paravayillai|parava illa)$/,
];

// Returns { isConversational, reason }. `reason` is a short machine token
// for audit/telemetry, never shown to a user.
function classify(question) {
  if (!question || typeof question !== 'string') {
    return { isConversational: false, reason: 'empty' };
  }
  const text = normalise(question);
  if (!text) return { isConversational: false, reason: 'empty' };
  // Hard disqualifiers before any pattern check: a digit almost always
  // means a real reference (a class, a year, an amount, an ID); more than
  // 6 words is past every whitelist phrase; an embedded question mark
  // means a real question follows the pleasantry.
  if (/\d/.test(text)) return { isConversational: false, reason: 'contains_number' };
  if (text.split(' ').length > 6) return { isConversational: false, reason: 'too_long' };
  if (text.includes('?')) return { isConversational: false, reason: 'embedded_question' };
  for (const pattern of CONVERSATIONAL_PATTERNS) {
    if (pattern.test(text)) return { isConversational: true, reason: 'whitelist_match' };
  }
  return { isConversational: false, reason: 'no_match' };
}

module.exports = { classify, normalise, CONVERSATIONAL_PATTERNS };
