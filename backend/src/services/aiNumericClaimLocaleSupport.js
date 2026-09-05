'use strict';

// ARCNAVE modernization P3 (1.13) — "Number-checking is pattern-based,
// English only ... misses Tamil / mixed-language numbers." Today's
// numeric-claim safety net (aiService.js's `verifyNumericClaims` /
// `COUNT_CLAIM_PATTERN`) matches ONLY ASCII digits (`\d`, which never
// matches the Tamil numeral block) followed by an English count-noun —
// a claim phrased as "10 மாணவர்கள்" (10 students) or using Tamil digit
// glyphs (௧௦ மாணவர்கள்) silently never enters `COUNT_CLAIM_PATTERN` at
// all, so a wrong number in that phrasing is never flagged CONFLICT —
// a false negative in the safety net, not a crash.
//
// Deliberately standalone, NOT wired into aiService.js yet — that file
// is being edited by a separate, concurrent session this same day (see
// bka/70-checkpoint/CURRENT-STATE.md's P3 banner). This module is the
// ready-to-wire safety-check layer the plan calls for; wiring it into
// `verifyNumericClaims`/`COUNT_CLAIM_PATTERN` is a one-line follow-up
// once that session's changes land (see `extractCountClaims`'s own
// comment below for the exact drop-in shape).
//
// Same bounded-pattern discipline `COUNT_CLAIM_PATTERN` already uses
// (see aiService.js's own comment on it): a curated noun vocabulary,
// NOT a general Tamil NLP number-word parser. Spelled-out Tamil number
// words ("ஏழு" for seven) are explicitly out of scope — same reasoning
// as English spelled-out numbers ("seven") already being out of scope
// for COUNT_CLAIM_PATTERN: an open-ended word-to-number mapping problem,
// not a bounded pattern, and a wrong guess there would be a worse
// failure mode (silently mis-parsing a claim) than the current
// behavior (not checking it at all, same "false CONFLICT is worse than
// missing a real one" asymmetry).

// Tamil numeral glyphs (U+0BE6–U+0BEF), literal-order mapped to ASCII
// '0'-'9'. A digit string may freely mix Tamil and ASCII glyphs
// (normalizeTamilDigits handles either, or both in the same string) —
// OCR'd or hand-typed mixed-script text is the realistic case this
// exists for, not a purity assumption that a whole claim is one script.
const TAMIL_DIGITS = '௦௧௨௩௪௫௬௭௮௯';

function normalizeTamilDigits(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let result = '';
  for (const ch of text) {
    const tamilIndex = TAMIL_DIGITS.indexOf(ch);
    result += tamilIndex === -1 ? ch : String(tamilIndex);
  }
  return result;
}

// Curated Tamil count-noun vocabulary — the Tamil-script equivalents of
// COUNT_CLAIM_PATTERN's English noun list (aiService.js), covering the
// same ARCNAVE domain concepts (students/staff/records/fees/etc), not a
// general dictionary. Plural/singular Tamil forms both included where
// they differ; Tamil doesn't inflect the way English does, so several
// entries cover what English needs two regex alternatives for.
const TAMIL_COUNT_NOUNS = [
  'மாணவர்கள்', // students
  'மாணவர்', // student (singular, still countable in "5 மாணவர்")
  'பணியாளர்கள்', // staff
  'ஆசிரியர்கள்', // teachers/faculty
  'பதிவுகள்', // records/entries
  'பதிவு', // record/entry (singular)
  'முடிவுகள்', // results
  'வகுப்புகள்', // classes
  'காலப்பகுதிகள்', // periods
  'துறைகள்', // departments
  'அறிவிப்புகள்', // notifications/alerts
  'ஆவணங்கள்', // documents
  'மதிப்பெண்கள்', // marks
  'கட்டணங்கள்', // fees
  'கொடுப்பனவுகள்', // payments
  'ஒப்புதல்கள்', // approvals
  'கோரிக்கைகள்', // requests
  'செய்திகள்', // messages
];

// Matches ASCII-or-Tamil digits directly followed (after optional
// whitespace) by one of the curated Tamil nouns above. Digits are
// matched as `[0-9]+` (not `\d+`) deliberately — this pattern always
// runs AFTER normalizeTamilDigits has already converted any Tamil
// glyphs to ASCII, so there is never a live Tamil digit character left
// for this regex to see; keeping the character class ASCII-only avoids
// silently also matching some other script's digit block by accident.
const TAMIL_NOUN_ALTERNATION = TAMIL_COUNT_NOUNS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const TAMIL_COUNT_CLAIM_PATTERN = new RegExp(`([0-9]+)\\s*(?:${TAMIL_NOUN_ALTERNATION})`, 'g');

// Drop-in replacement shape for aiService.js's own:
//   [...answerText.matchAll(COUNT_CLAIM_PATTERN)].map((m) => Number(m[1]))
// — returns the same "array of claimed integer counts" shape, just
// sourced from BOTH English-noun and Tamil-noun claims in the same
// text, with Tamil digit glyphs normalized to ASCII first. Once wired,
// `verifyNumericClaims` would call this instead of matching
// COUNT_CLAIM_PATTERN directly; the English-only pattern stays exactly
// as it is today (re-exported here, not duplicated) so no existing
// behavior changes until that wiring happens.
function extractCountClaims(answerText, englishCountClaimPattern) {
  if (typeof answerText !== 'string') return [];
  const normalized = normalizeTamilDigits(answerText);

  const englishMatches = englishCountClaimPattern ? [...normalized.matchAll(englishCountClaimPattern)] : [];
  const tamilMatches = [...normalized.matchAll(TAMIL_COUNT_CLAIM_PATTERN)];

  return [...englishMatches, ...tamilMatches].map((m) => Number(m[1]));
}

module.exports = {
  TAMIL_DIGITS,
  TAMIL_COUNT_NOUNS,
  TAMIL_COUNT_CLAIM_PATTERN,
  normalizeTamilDigits,
  extractCountClaims,
};
