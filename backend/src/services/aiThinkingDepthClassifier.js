'use strict';

// ARCNAVE modernization P3 (1.11) — "AI settings are fixed in code ->
// 'low thinking' for everything -> Adjust depth to how hard the
// question is." Before this module, `routes/ai.js`'s
// `resolveThinkingLevel` always fell through to `DEFAULT_THINKING_LEVEL`
// ('fast' -> LOW) whenever the frontend composer's own thinkingLevel was
// unset (see `EMPTY_COMPOSER.thinkingLevel`, now `null` by default,
// frontend/src/store/ComposerProvider.jsx) — i.e. every question the
// user hasn't manually escalated got the cheapest setting regardless of
// how hard it actually was.
//
// Deterministic, bounded scoring — same discipline
// COUNT_CLAIM_PATTERN/aiGreetingClassifier.js already use for this
// codebase's other "decide something about a question without an extra
// LLM call" problems: a curated keyword list + length/structure
// signals, not a general NLP difficulty model. Conservative on purpose,
// same asymmetry aiGreetingClassifier's own comment reasons through
// (there, false-positive-biased toward SKIPPING the expensive path;
// here, biased toward NOT escalating) — HIGH/MEDIUM thinking costs real
// money and latency on every turn it fires for, so an ambiguous
// question stays 'fast' rather than being guessed into a more expensive
// tier it didn't clearly ask for. An explicit user choice (clicking the
// toggle) always wins over this and is never reached — see
// routes/ai.js's resolveThinkingLevel for where that boundary is drawn.

// Capped contribution per signal — no single very long keyword list or
// a pathologically long question can alone push a question past
// 'balanced' without also tripping the length signal for real.
const MAX_KEYWORD_SCORE = 2;

// Curated analytical/reasoning vocabulary — comparison, causal
// explanation, recommendation, and multi-step-reasoning language. Not
// exhaustive; a missed real signal degrades to 'fast' (same as any
// question this classifier has never seen before), never a wrong,
// expensive escalation.
const ANALYTICAL_KEYWORDS = [
  'compare',
  'comparison',
  'analyze',
  'analysis',
  'analyse',
  'why',
  'recommend',
  'recommendation',
  'strategy',
  'trend',
  'root cause',
  'pros and cons',
  'evaluate',
  'evaluation',
  'which is better',
  'step by step',
  'in detail',
  'correlate',
  'correlation',
  'predict',
  'forecast',
  'optimize',
  'optimise',
  'summarize and',
  'summarise and',
];

const LONG_QUESTION_CHARS = 400;
const MEDIUM_QUESTION_CHARS = 150;

const LEVELS = { FAST: 'fast', BALANCED: 'balanced', DEEP: 'deep' };

function countKeywordHits(lowerText) {
  let hits = 0;
  for (const keyword of ANALYTICAL_KEYWORDS) {
    if (lowerText.includes(keyword)) hits += 1;
  }
  return Math.min(hits, MAX_KEYWORD_SCORE);
}

function countQuestionMarks(text) {
  return (text.match(/\?/g) || []).length;
}

// Returns one of 'fast' | 'balanced' | 'deep' — the SAME label
// vocabulary `THINKING_LEVEL_BY_LABEL` (routes/ai.js) already maps to
// LOW/MEDIUM/HIGH, so this slots in as a drop-in source for that
// mapping rather than introducing a second enum. Non-string/empty input
// is always 'fast' — nothing to measure difficulty from.
function classifyThinkingDepth(question) {
  if (typeof question !== 'string') return LEVELS.FAST;
  const trimmed = question.trim();
  if (trimmed.length === 0) return LEVELS.FAST;

  let score = 0;

  if (trimmed.length > LONG_QUESTION_CHARS) score += 2;
  else if (trimmed.length > MEDIUM_QUESTION_CHARS) score += 1;

  score += countKeywordHits(trimmed.toLowerCase());

  // More than one question mark reads as a compound, multi-part ask
  // ("What's our attendance trend, and why did it drop in March?") —
  // one lone '?' is the ordinary shape of nearly every question and
  // carries no signal on its own.
  if (countQuestionMarks(trimmed) > 1) score += 1;

  if (score >= 3) return LEVELS.DEEP;
  if (score >= 1) return LEVELS.BALANCED;
  return LEVELS.FAST;
}

module.exports = { classifyThinkingDepth, LEVELS };
