'use strict';

// Evidence/provenance + verification (P0.4 of the AI capability roadmap)
// and the Research-mode numeric-claim verification boundary (Review
// Finding #10). Split out of aiService.js — see that file's own header
// comment for the full split; moved verbatim, no behavior change. Mostly
// pure, self-contained data functions (only aiNumericClaimLocaleSupport
// is an external dependency) — consumed by services/ai/toolInvocation.js
// (askAboutTool), services/ai/workflowPlan.js (executeWorkflowPlan),
// services/ai/askGeneralChat.js, and services/ai/agentLoop.js
// (act/verify/writeUp).

const aiNumericClaimLocaleSupport = require('../aiNumericClaimLocaleSupport');

// --- Evidence/provenance + verification (P0.4) ----------------------
//
// One mechanism, two outputs (CHECKPOINT.md's own merge of what were
// originally two separate roadmap items): every tool result this
// pipeline already fetched is deterministic, already-Policy-Gated
// ground truth — re-reading it costs nothing (no fresh query, just
// looking at data already in hand), so there is no reason to trust the
// LLM's own restatement of a count when the real count is sitting
// right there. (a) buildEvidence/buildEvidenceTrail expose it as a
// human-readable "based on" trail; (b) verifyNumericClaims diffs any
// explicit count claim in the LLM's own answer against it. This is
// ARCNAVE's real structural advantage over a generic chatbot (round 3:
// "authoritative ground truth... can verify its own model's claims
// cheaply") — never a second LLM call, and never authoritative on its
// own: a CONFLICT is surfaced for the caller/UI to show, not silently
// corrected and not blocked (round 2/Bucket B: advisory only).

// Derives a lightweight evidence descriptor per tool result from data
// this request already fetched — entry.data is the same
// JSON.stringify'd payload aiPromptSafetyLayer.wrapEntry already
// produced (see its own comment), so parsing it back here reads this
// request's own already-Policy-Gated result, never new/untrusted
// content and never a fresh query.
// A tool's real array is sometimes the top-level result (existing tools:
// academic_class_timetable, students_roster, ...) and sometimes nested in
// a status envelope (analyze_document_table's { status, strategy, results }
// — ADR-029's honest-degradation shape: status alone tells the caller
// unrecognized_layout/no_matching_records/extraction_failed without
// forcing a thrown error for an expected, non-exceptional outcome).
// Checking a small set of conventional envelope keys is a generic
// extension, not special-cased to this one tool — any future tool
// wrapping its array this way benefits the same way.
const ARRAY_ENVELOPE_KEYS = ['results', 'records', 'items', 'data'];
function extractResultArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    for (const key of ARRAY_ENVELOPE_KEYS) {
      if (Array.isArray(parsed[key])) return parsed[key];
    }
  }
  return undefined;
}

// execute_code's own JSON envelope ({stdout, stderr, exitCode, files,
// verification}) never carries a computed count/sum/average itself — the
// sandbox output contract (file-reading/SKILL.md) asks the model's own
// code to print exactly one `FINAL_RESULT_JSON:<json>` line for that, so
// a narrated answer over an attachment can be checked the same way a
// native tool's structured result already is. Scanned from the BOTTOM so
// ordinary print()/progress output already in stdout is never mistaken
// for the answer, and only the LAST such line is read (a script that
// reprints a corrected final answer after an earlier mistake). That last
// line is either a well-formed JSON object or the whole thing is treated
// as absent — never falls back to an earlier line, and never a loose
// "any JSON found in stdout" scan (debug output that happens to look
// like JSON must never be read as a verified answer).
const FINAL_SANDBOX_RESULT_PREFIX = 'FINAL_RESULT_JSON:';
function extractFinalSandboxResult(stdout) {
  if (typeof stdout !== 'string' || stdout.length === 0) return null;
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith(FINAL_SANDBOX_RESULT_PREFIX)) continue;
    const jsonText = trimmed.slice(FINAL_SANDBOX_RESULT_PREFIX.length).trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  }
  return null;
}

// A structured sandbox result counts as evidence only when it's a real
// computed answer — never a `result_type: 'error'` report (the code
// itself said it couldn't compute this), and never the absence of a
// FINAL_RESULT_JSON line at all (extractFinalSandboxResult already
// returns null for that). Both cases fall through to the same safe
// "nothing to verify against" path buildEvidence already has for any
// other single-object, non-countable tool result.
function sandboxEvidenceSource(rawResult) {
  const structured = extractFinalSandboxResult(rawResult && rawResult.stdout);
  if (!structured || structured.result_type === 'error') return null;
  return structured;
}

// fieldValues (ADR-029): a tool result that's an array of per-row objects
// (e.g. analyze_document_table's one-count-per-record output) carries its
// real numbers inside each row, not just in the array's own length —
// recordCount alone would only ever catch "wrong number of rows," never
// "right number of rows, wrong count on one of them" (the actual
// Muhammad-Ashik-arrears miscount this ADR exists to catch). Collecting
// every numeric field value here, generically, works for any current or
// future tool shaped this way — not special-cased to this one tool.
function collectFieldValues(array) {
  const values = array.flatMap((row) =>
    row && typeof row === 'object' ? Object.values(row).filter((v) => typeof v === 'number') : [],
  );
  return values.length > 0 ? values : undefined;
}

// A tool result that already carries its own DETERMINISTIC cross-record
// answer (documentAggregateService.summarize's shape) is verified against
// that answer, never against its rows. Collecting every numeric field of
// every row (collectFieldValues, below) is right for a small result and
// actively harmful for a large one: at 3,000 rows the knownSet reaches
// roughly 6,000 values, so almost any number the model states is present by
// coincidence and verifyNumericClaims degrades to a false PASS — the exact
// inverse of the false-CONFLICT risk COUNT_CLAIM_PATTERN's own comment
// guards against. Keyed on the shape, not on a tool name, so any future
// tool returning a deterministic summary gets the same treatment.
// See ai-chat-document-analysis-payload-bounds-approved-spec.md.
function extractDeterministicSummary(parsed) {
  if (!parsed || typeof parsed !== 'object') return undefined;
  if (typeof parsed.total === 'number' && typeof parsed.matchedCount === 'number') {
    const values = [parsed.total];
    if (typeof parsed.scopedCount === 'number') values.push(parsed.scopedCount);
    if (Array.isArray(parsed.bySemester)) {
      values.push(...parsed.bySemester.map((e) => e.count).filter((n) => typeof n === 'number'));
    }
    // The sample's own per-row values are still collected — bounded by the
    // sample cap, so ~100 values rather than ~6,000. This preserves exactly
    // what collectFieldValues was added for (ADR-029: catching "right number
    // of rows, wrong count on ONE of them" — the original Muhammad-Ashik
    // miscount) for every row the model was actually shown, while dropping
    // the thousands of values it never saw and could only have matched by
    // coincidence.
    if (Array.isArray(parsed.sample)) {
      values.push(...(collectFieldValues(parsed.sample) || []));
    }
    return { recordCount: parsed.matchedCount, fieldValues: values };
  }
  // Sandbox output contract (execute_code's FINAL_RESULT_JSON line, see
  // file-reading/SKILL.md) — a scalar deterministic answer (count, sum,
  // average, or a labeled breakdown of them) the model's own code
  // computed and printed, not narrated from memory. Keyed on the shape
  // (result_type + a numeric value), never on a tool name, same
  // convention as the total/matchedCount shape above.
  if (parsed.result_type === 'deterministic_summary' && typeof parsed.value === 'number') {
    const values = [parsed.value];
    if (Array.isArray(parsed.breakdown)) {
      values.push(...parsed.breakdown.map((e) => e && e.value).filter((n) => typeof n === 'number'));
    }
    return { recordCount: undefined, fieldValues: values };
  }
  return undefined;
}

function buildEvidence(sanitizedContext) {
  return sanitizedContext.entries.map((entry) => {
    let recordCount;
    let fieldValues;
    try {
      const parsed = JSON.parse(entry.data);
      // execute_code's own envelope ({stdout, stderr, exitCode, files,
      // verification}) never carries a countable answer itself — any
      // computed number lives inside its stdout, recovered via the
      // sandbox output contract above. Falling back to `parsed` itself
      // when no structured result is found keeps the existing safe
      // "nothing to verify" behavior (extractDeterministicSummary/
      // extractResultArray both return undefined for that shape) rather
      // than introducing a new unverified-but-treated-as-PASS path.
      const evidenceSource = entry.toolName === 'execute_code' ? sandboxEvidenceSource(parsed) || parsed : parsed;
      const summary = extractDeterministicSummary(evidenceSource);
      const array = summary ? undefined : extractResultArray(evidenceSource);
      if (summary) {
        ({ recordCount, fieldValues } = summary);
      } else if (array) {
        recordCount = array.length;
        fieldValues = collectFieldValues(array);
      }
    } catch {
      // Not a JSON array (a single-object result, e.g. get_college_profile)
      // — no count to report, not an error.
    }
    return {
      toolName: entry.toolName,
      recordCount,
      fieldValues,
      retrievedAt: entry.retrievedAt,
    };
  });
}

function buildEvidenceTrail(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return null;
  return evidence
    .map(
      (e) =>
        `- ${e.toolName}${e.recordCount !== undefined ? ` — ${e.recordCount} record(s)` : ''} — retrieved ${e.retrievedAt}`,
    )
    .join('\n');
}

// Only matches a number immediately followed by a plural count-noun
// ("7 students", "12 records") — deliberately narrow. A broader
// "any standalone digit" match would false-positive on years, roll
// numbers, percentages — a false CONFLICT eroding trust in a real
// feature is worse than missing a real one, same asymmetry round 2
// already reasoned through for why embeddings-based tool retrieval
// stays deferred rather than shipped half-validated.
const COUNT_CLAIM_PATTERN =
  /\b(\d+)\s+(records?|students?|staff|results?|entries|entry|items?|rows?|classes?|periods?|sessions?|departments?|notifications?|documents?|teachers?|faculty|marks?|fees?|payments?|approvals?|requests?|absentees?|messages?|alerts?|arrears?)\b/gi;

// P3 1.13 (aiNumericClaimLocaleSupport.js) — every call site below that
// used to do `[...answerText.matchAll(COUNT_CLAIM_PATTERN)]` now goes
// through `extractCountClaims` instead, which ALSO catches the same
// claim phrased with Tamil digit glyphs (e.g. "௧௦") or a Tamil
// count-noun (e.g. "10 மாணவர்கள்") — COUNT_CLAIM_PATTERN itself is
// unchanged and still passed in, so a plain English claim matches
// exactly as before; this only adds coverage, never narrows it.
function extractCountClaims(answerText) {
  return aiNumericClaimLocaleSupport.extractCountClaims(answerText, COUNT_CLAIM_PATTERN);
}

function verifyNumericClaims(answerText, evidence) {
  const knownCounts = evidence.flatMap((e) => [
    ...(e.recordCount !== undefined ? [e.recordCount] : []),
    ...(e.fieldValues || []),
  ]);
  if (knownCounts.length === 0) return { status: 'INSUFFICIENT_EVIDENCE' };
  if (typeof answerText !== 'string') return { status: 'INSUFFICIENT_EVIDENCE' };

  const claimed = extractCountClaims(answerText);
  if (claimed.length === 0) return { status: 'PASS' };

  const knownSet = new Set(knownCounts);
  const conflicting = claimed.filter((n) => !knownSet.has(n));
  if (conflicting.length > 0) {
    return { status: 'CONFLICT', claimedNumbers: conflicting, knownCounts };
  }
  return { status: 'PASS' };
}

// --- Research-mode verification boundary (Review Finding #10) -----------
//
// verifyNumericClaims above already does exactly what a direct count
// claim ("124 students appeared") needs — a claimed integer must appear
// somewhere among known evidence values, or the answer is flagged. It is
// REUSED verbatim below (never duplicated) for that one case. It has no
// percentage/ranking awareness at all — a narrower job, built only for
// Curriculum's own count-noun claims — so this section adds exactly two
// more narrow, deterministic checks a Research-mode numeric claim can
// need: a percentage recomputation and a superlative/ranking membership
// check. Neither is a general NLP claim extractor — both are literal,
// bounded pattern/arithmetic checks, same spirit as COUNT_CLAIM_PATTERN
// itself.
//
// Research mode structurally never builds Curriculum's own `evidence`
// array — askGeneralChat offers no tool at all (see that function's own
// top comment), so there is no live analyze_document_table/tool-result
// pipeline to draw from today. The shape here is deliberately smaller
// and generic instead: a flat list of { label, value, trusted, status }
// facts a caller can supply once a real evidence source exists for this
// mode. `status: 'unreliable_extraction'` is the exact field/value
// Finding #3's own document-trust gate already uses (documentAnalysisService.js) —
// recognized here so a caller passing real analyze_document_table-shaped
// facts needs no translation layer, without this file re-deriving any
// extraction/trust logic itself. Today, in real production Research-mode
// traffic, this list is always empty ([]) — the correct, safe default
// per this finding's own product principle (no tool ran, so there is
// nothing to verify against), not a gap in this implementation.
const PERCENT_CLAIM_PATTERN = /(\d+(?:\.\d+)?)\s*%/g;
const SUPERLATIVE_PATTERN = /\b(highest|lowest|maximum|minimum|best|worst|top)\b/i;
// A value rounded to one decimal place (this codebase's own reporting
// convention, e.g. "82.5%") can be off from a raw division by up to
// 0.05 of a percentage point — the tolerance below, never looser.
const PERCENT_ROUNDING_TOLERANCE = 0.05;

const RESEARCH_VERIFICATION_STATUS = {
  NOT_APPLICABLE: 'not_applicable',
  VERIFIED: 'verified',
  PARTIALLY_VERIFIED: 'partially_verified',
  NOT_VERIFIABLE: 'not_verifiable',
  VERIFICATION_FAILED: 'verification_failed',
};

function extractPercentClaims(answerText) {
  if (typeof answerText !== 'string') return [];
  return [...answerText.matchAll(PERCENT_CLAIM_PATTERN)].map((m) => Number(m[1]));
}

// Whether this Research-mode answer makes ANY claim worth checking at
// all — a count-noun claim or a percentage. Deliberately NOT triggered
// by a bare superlative word alone ("best practices," "top priority,"
// "the worst approach" are ordinary English with zero data claim in
// them) — SUPERLATIVE_PATTERN is only ever consulted as a MODIFIER on an
// already-detected count/percent claim elsewhere in the same answer
// (see verifyResearchNumericClaims below), never as its own trigger.
// Anything with no count/percent claim at all (methodology advice, a
// rewritten abstract, "explain X") skips verification entirely:
// NOT_APPLICABLE, no disclaimer — the product principle this finding
// exists to enforce is "don't present an unverifiable NUMBER as fact,"
// never "refuse research assistance because nothing is verifiable."
function researchAnswerMakesNumericClaim(answerText) {
  if (typeof answerText !== 'string') return false;
  if (extractCountClaims(answerText).length > 0) return true;
  return extractPercentClaims(answerText).length > 0;
}

// Finding #3's own gate, respected rather than re-implemented: an entry
// marked untrusted (either convention — the boolean this file's own
// facts use, or the real 'unreliable_extraction' status string
// documentAnalysisService.js uses) is treated exactly as if it doesn't
// exist. Arithmetic performed on an uncertain PDF-row reconstruction
// must never be promoted to "verified" merely because the arithmetic
// itself is correct.
function trustedResearchFacts(evidence) {
  return (Array.isArray(evidence) ? evidence : []).filter(
    (f) => f && typeof f.value === 'number' && f.trusted !== false && f.status !== 'unreliable_extraction',
  );
}

// Every value a claimed percentage can legitimately match: either a
// fact's OWN value directly (a fact can already BE a percentage — e.g.
// a per-year pass-percentage figure) or a derivable ratio (i/j) between
// two facts, as a percentage (e.g. passed/appeared*100) — the smallest
// generic way to recompute a claim without hardcoding label names like
// "appeared"/"passed" (this codebase's real field names vary by tool/
// report). A claimed percentage is verified if it matches ANY of these
// within PERCENT_ROUNDING_TOLERANCE.
function derivablePercentages(facts) {
  const out = facts.map((f) => f.value);
  facts.forEach((a) => {
    facts.forEach((b) => {
      if (a === b || b.value === 0) return;
      out.push((a.value / b.value) * 100);
    });
  });
  return out;
}

// A superlative claim ("2024 had the highest pass percentage") is
// verified only when the label it names is BOTH present in the SAME
// SENTENCE as the superlative wording AND genuinely holds the extreme
// value — narrowed to the sentence, not the whole answer, precisely so
// a supporting rundown of every year's figure earlier in the same
// answer ("2022 was 70.1%, 2023 was 75.2%, 2024 was 82.5%.") doesn't
// make every other year's label look "named" by the ranking claim too.
// A literal label-substring check within that sentence, never free-text
// claim parsing. Returns null when there's nothing to check (no
// superlative wording, or zero facts) so the caller can tell "not
// applicable" apart from "checked and failed."
function superlativeClaimOutcome(answerText, facts) {
  const isHighest = /\b(highest|maximum|best|top)\b/i.test(answerText);
  const isLowest = /\b(lowest|minimum|worst)\b/i.test(answerText);
  if (!isHighest && !isLowest) return null;
  if (facts.length === 0) return false;
  const claimSentences = answerText.split(/(?<=[.!?])\s+/).filter((s) => SUPERLATIVE_PATTERN.test(s));
  const named = facts.filter((f) => claimSentences.some((s) => s.includes(String(f.label))));
  if (named.length === 0) return false;
  const values = facts.map((f) => f.value);
  const extreme = isHighest ? Math.max(...values) : Math.min(...values);
  return named.every((f) => f.value === extreme);
}

// The Research-mode verification boundary itself. `evidence` is the flat
// { label, value, trusted, status } fact list described above — [] in
// virtually all of today's real Research-mode traffic, which is exactly
// what routes every numeric-claim-bearing answer to NOT_VERIFIABLE
// rather than silently trusting it.
function verifyResearchNumericClaims(answerText, evidence = []) {
  if (!researchAnswerMakesNumericClaim(answerText)) {
    return { status: RESEARCH_VERIFICATION_STATUS.NOT_APPLICABLE };
  }

  const facts = trustedResearchFacts(evidence);
  const outcomes = [];

  // Count-noun claims — delegated verbatim to the existing Curriculum
  // verifier (never re-implemented), fed the same trusted facts wrapped
  // in ITS existing evidence shape ({fieldValues}).
  const countClaims = extractCountClaims(answerText);
  if (countClaims.length > 0) {
    const countResult = verifyNumericClaims(
      answerText,
      facts.length > 0 ? [{ fieldValues: facts.map((f) => f.value) }] : [],
    );
    if (countResult.status === 'PASS') outcomes.push('verified');
    else if (countResult.status === 'CONFLICT') outcomes.push('failed');
    else outcomes.push('unverifiable');
  }

  const percentClaims = extractPercentClaims(answerText);
  if (percentClaims.length > 0) {
    if (facts.length < 2) {
      outcomes.push('unverifiable');
    } else {
      const derived = derivablePercentages(facts);
      percentClaims.forEach((claimed) => {
        outcomes.push(derived.some((d) => Math.abs(d - claimed) <= PERCENT_ROUNDING_TOLERANCE) ? 'verified' : 'failed');
      });
    }
  }

  // Superlative wording is only ever consulted as a MODIFIER here, gated
  // behind an already-detected count/percent claim elsewhere in the same
  // answer — never a standalone trigger (researchAnswerMakesNumericClaim's
  // own comment explains why: "best," "top," "worst" are ordinary English
  // on their own). A ranking sentence itself rarely repeats a number
  // ("2024 had the highest pass percentage") — the supporting figures
  // are what the count/percent check above already found elsewhere in
  // the same text.
  if (countClaims.length > 0 || percentClaims.length > 0) {
    const superlativeOutcome = superlativeClaimOutcome(answerText, facts);
    if (superlativeOutcome !== null) {
      outcomes.push(superlativeOutcome ? 'verified' : 'failed');
    }
  }

  if (outcomes.length === 0) {
    // A claim pattern matched but nothing above could actually evaluate
    // it (shouldn't normally happen given researchAnswerMakesNumericClaim
    // gates entry, but conservative rather than assumed unreachable).
    return { status: RESEARCH_VERIFICATION_STATUS.NOT_VERIFIABLE };
  }
  if (outcomes.includes('failed')) {
    return { status: RESEARCH_VERIFICATION_STATUS.VERIFICATION_FAILED };
  }
  if (outcomes.every((o) => o === 'verified')) {
    return { status: RESEARCH_VERIFICATION_STATUS.VERIFIED };
  }
  if (outcomes.includes('verified') && outcomes.includes('unverifiable')) {
    return { status: RESEARCH_VERIFICATION_STATUS.PARTIALLY_VERIFIED };
  }
  return { status: RESEARCH_VERIFICATION_STATUS.NOT_VERIFIABLE };
}

// Composed here, deterministically, same "cannot be talked out of"
// reasoning buildCoverageRefusal above already documents — never asked
// of the model itself. Only the two statuses that must change what the
// user sees get a note; VERIFIED and NOT_APPLICABLE return null (no
// unnecessary disclaimer on an ordinary or already-supported answer).
function buildResearchVerificationNote(status) {
  if (status === RESEARCH_VERIFICATION_STATUS.NOT_VERIFIABLE) {
    return (
      'Note: I cannot verify the specific figures above against a trusted source in this mode, so treat any ' +
      'exact numbers as unconfirmed — ask in Curriculum mode for a verified figure.'
    );
  }
  if (status === RESEARCH_VERIFICATION_STATUS.VERIFICATION_FAILED) {
    return (
      'Note: at least one specific figure above does not match the available source data, so I cannot confirm ' +
      'it as accurate — please verify independently or ask in Curriculum mode.'
    );
  }
  if (status === RESEARCH_VERIFICATION_STATUS.PARTIALLY_VERIFIED) {
    return 'Note: some figures above could not be independently verified from a trusted source — treat those as unconfirmed.';
  }
  return null;
}

// Runs an already-resolved, already-confirmed-if-needed plan: each
// step through the real invokeTool (so Policy Gate/audit/Context
// Builder/Prompt Safety Layer all still apply exactly as a single-tool
// call would), fail-transparent (round 7: "report exactly what
// succeeded/failed", never a silent partial result or a whole-plan
// crash from one step's business error), then ONE synthesis call over
// every successful step's combined data plus a plain description of
// any failures. `resolvedSteps` is [{toolName, params}], already
// Policy-Gate-shaped safeParams (from resolvePlanSteps or, for a
// pre-confirmed plan replayed via /ai/workflow/execute, the exact
// params the user already saw and approved).
// `identityBlock`/`adapter`/`aiConfig` are optional pre-computed
// values — askAgent's plan branch already resolved all three for its
// own tool-select call and passes them through so this function
// doesn't re-run describeIdentityContext/getAiConfig a second time
// (describeIdentityContext itself queries collegeProfileService.getProfile,
// so recomputing it here would be a real extra DB round trip, not just
// a style nit). POST /ai/workflow/execute (a pre-confirmed plan replayed
// with no preceding tool-select call) has none of these yet, so it
// omits them and this function computes them itself, same as before.
// Parallel Read Workers (P2.5, CHECKPOINT.md's Bucket B design,
// correction #3 preserved: `Promise.all` over independent steps inside
// the SAME request/transaction/actor-identity, never a worker-pool/
// queue abstraction). A step's own tool.riskLevel (R0/R1 = L1, a pure
// read with no external effect — RISK_MATRIX) is what makes it safe to
// run concurrently with its neighbors: two reads can never race with
// each other the way two writes (or a read depending on a prior
// write's effect) could, so parallelizing is a pure latency win with
// no ordering semantics to protect. A write step (L2/L3) still runs
// alone, in its original position, never batched with anything else.

module.exports = {
  buildEvidence,
  buildEvidenceTrail,
  verifyNumericClaims,
  extractResultArray,
  extractFinalSandboxResult,
  sandboxEvidenceSource,
  collectFieldValues,
  extractDeterministicSummary,
  extractCountClaims,
  RESEARCH_VERIFICATION_STATUS,
  extractPercentClaims,
  researchAnswerMakesNumericClaim,
  trustedResearchFacts,
  derivablePercentages,
  superlativeClaimOutcome,
  verifyResearchNumericClaims,
  buildResearchVerificationNote,
  FINAL_SANDBOX_RESULT_PREFIX,
  ARRAY_ENVELOPE_KEYS,
};
