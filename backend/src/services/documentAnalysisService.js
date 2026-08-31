'use strict';

// Orchestrating Business Service for ADR-029's Deterministic Analysis path
// — the ONE service the analyze_document_table AI tool wraps (RS-AIG-002:
// every tool wraps exactly one Business Service method). Composes three
// pieces, none of which know about each other's callers:
//   documentService              -> ownership-checked byte download
//   documentTextExtractionService -> existing plain-text extraction (unchanged)
//   documentTableExtractionService -> structural record detection (new)
//   documentAggregateService      -> fixed count/sum operations (new)
// Never persists an analysis RESULT — every answer here is transient,
// scoped to one /ai/ask turn, same lifecycle images/documents already have
// in aiService.resolveChatAttachments (ADR-029's "no schema changes"
// call). Review Finding #6 (2026-08-29) adds exactly one audit-log entry
// for the pdfplumber fallback's own lifecycle (attempted/skipped/
// completed/failed) — an operational trail, not a persisted result, same
// category as resolveChatAttachments' own ai_attachment_analyzed/
// ai_attachment_extraction_failed entries via the same
// auditLogRepository.createAuditLogEntry this file now also calls
// directly (an established Business Service convention — see e.g.
// documentService.js, staffService.js, ~28 other services in this repo).

const documentService = require('./documentService');
const documentTextExtractionService = require('./documentTextExtractionService');
const documentTableExtractionService = require('./documentTableExtractionService');
const documentAggregateService = require('./documentAggregateService');
const documentRowIntegrityService = require('./documentRowIntegrityService');
const sandboxExecutionService = require('./sandboxExecutionService');
const auditLogRepository = require('../repositories/auditLogRepository');
const config = require('../config');

class DocumentAnalysisValidationError extends Error {}

// ADL-063 — the pdfplumber fallback, credential-less (ADL-059), invoked
// only for application/pdf attachments and only after flat text has
// already failed reliability (see the two call sites in analyzeAttachment
// below). extract_tables() with NO table_settings override — the
// library's default 'lines' strategy. Passing
// {'vertical_strategy': 'text', 'horizontal_strategy': 'text'} must never
// happen here: ADL-058 addendum 2 measured it reproducing the exact
// original defect (floats the numeric block above the wrong student).
// Each row's cells are rejoined with a SINGLE SPACE, never '|' and never
// a tab — the same load-bearing separator rule ADL-058 Finding 2
// established for geometry, reused unchanged: joining with '|' would
// silently move the reconstruction onto the 'delimited' strategy and
// switch coverage checking off entirely.
const PDFPLUMBER_RECONSTRUCT_SCRIPT = `
import pdfplumber

with pdfplumber.open("attachment.pdf") as pdf:
    lines = []
    for page in pdf.pages:
        for table in page.extract_tables():
            for row in table:
                cells = [str(cell).strip() for cell in row if cell is not None and str(cell).strip() != '']
                if cells:
                    lines.append(' '.join(cells))
print('\\n'.join(lines))
`.trim();

// Returns the reconstructed text, or null if the sandbox itself is
// unavailable, misconfigured, or the buffer exceeds its size limit.
// Deliberately swallows exactly those three cases rather than letting
// them throw out of analyzeAttachment: a capability being unavailable and
// a document being unreadable are different facts (ADL-056's own
// discipline), and the caller below falls through to today's existing
// per-document status on null rather than ending the turn as an HTTP 500.
// Any OTHER error (a real bug in this code, a malformed script) is not
// swallowed — it should surface loudly, not be silently treated as "no
// fallback available".
async function reconstructViaPdfplumber(buffer) {
  try {
    const result = await sandboxExecutionService.executeCode({
      code: PDFPLUMBER_RECONSTRUCT_SCRIPT,
      files: [{ name: 'attachment.pdf', contentBase64: buffer.toString('base64') }],
    });
    return result.stdout;
  } catch (err) {
    if (
      err instanceof sandboxExecutionService.SandboxNotConfiguredError ||
      err instanceof sandboxExecutionService.SandboxExecutionError ||
      err instanceof sandboxExecutionService.SandboxValidationError
    ) {
      return null;
    }
    throw err;
  }
}

// True exactly when flat text already failed reliability on a PDF — the
// only condition under which the fallback runs at all. Not extracted
// beyond this one call site because it reads directly against the same
// strategy/coverage values analyzeAttachment already has in scope.
function pdfFallbackApplies(mimeType, strategy, coverage) {
  return (
    mimeType === 'application/pdf' && (strategy === 'none' || (coverage && coverage.applicable && !coverage.reliable))
  );
}

// Review Finding #6 — the ONE structured, non-sensitive audit trail for
// this fallback's own lifecycle, distinct from the RETURNED provenance
// fields below (this is "what happened," not "what the caller got back").
// action mirrors the finding's own vocabulary (skipped/attempted-and-
// failed/attempted-and-completed); resultStatus/reason, when present,
// describe the fallback's OWN verdict at the point it resolved, never the
// unrelated business-logic status a turn might later return (e.g.
// no_matching_records). Never logs document text, extracted values,
// student names/DoBs/marks/fees, or a stack trace — attachmentId is the
// same document-row UUID resolveChatAttachments' own ai_attachment_analyzed
// entry already logs as entityId, not new exposure.
async function logPdfFallbackEvent(client, identityContext, attachmentId, fields) {
  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: identityContext.collegeId,
    userId: identityContext.userId,
    action: 'ai_pdf_table_fallback',
    entity: 'ai_attachments',
    entityId: attachmentId,
    metadata: {
      event: 'pdf_table_fallback',
      enabled: config.pdfPlumberFallbackEnabled,
      fallbackProvider: 'pdfplumber',
      ...fields,
    },
  });
}

// Review Finding #6 — structured provenance for BACKEND/downstream
// consumers, distinct from logPdfFallbackEvent's audit trail above (that
// is "what happened"; this is "what the caller got back"). Deliberately
// never exposes the raw 'pdfplumber' provider name or the '_pdfplumber'
// strategy suffix to a user — those stay internal implementation detail;
// aiToolRegistry's tool description already explains 'unreliable_
// extraction'/'row_integrity_unverified' to the model in user-safe terms
// without naming either. trustReason is only ever attached when a fallback
// result did NOT reach full trust — a verified fallback (pdfplumberReconstructed
// true, reaching this point at all means Finding #3's gate already passed)
// carries no trustReason, since there is no refusal to explain.
function fallbackProvenance(pdfplumberReconstructed, extra = {}) {
  if (!pdfplumberReconstructed) return { fallbackUsed: false };
  return {
    fallbackUsed: true,
    fallbackProvider: 'pdfplumber',
    reconstructionType: 'layout_based',
    primaryExtractionReliable: false,
    ...extra,
  };
}

// Same ownership chain as aiService.resolveChatAttachments — repeated
// rather than imported to avoid a circular require (aiService depends on
// this file's caller, aiToolRegistry, not the other way around) and
// because CLAUDE.md rule 4 (repositories never call other repositories)
// implies the equivalent discipline one layer up: this service owns its
// own authorization check rather than reaching into aiService's.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOwnedAttachment(client, attachmentId, identityContext) {
  // A malformed id (caught live: the model echoing its own param
  // description back as the value instead of a real uuid) must fail as
  // a clean, catchable validation error here — not as a raw Postgres
  // "invalid input syntax for type uuid" that poisons the rest of this
  // request's transaction (every subsequent query in the same
  // transaction then fails with the unhelpful "current transaction is
  // aborted" until the caller rolls back).
  if (typeof attachmentId !== 'string' || !UUID_PATTERN.test(attachmentId)) {
    throw new DocumentAnalysisValidationError(`attachmentId ${JSON.stringify(attachmentId)} is not a valid id`);
  }
  const downloaded = await documentService.downloadDocument(client, attachmentId);
  const document = downloaded && downloaded.document;
  const isOwnedChatAttachment =
    document &&
    document.doc_type === documentService.CHAT_ATTACHMENT_DOC_TYPE &&
    document.uploaded_by_user_id === identityContext.userId &&
    typeof document.mime_type === 'string';
  if (!isOwnedChatAttachment) {
    throw new DocumentAnalysisValidationError(
      `attachment ${JSON.stringify(attachmentId)} is not a valid attachment for this user`,
    );
  }
  return downloaded;
}

// Serial-number range filter (params.serialRange: { from, to }) is applied
// against sequential_id records' own serialNo — the one field the
// structural extractor already knows the meaning of by construction (it IS
// the record boundary), not a semantic mapping the caller invented.
function filterBySerialRange(records, serialRange) {
  if (!serialRange) return records;
  const from = Number(serialRange.from);
  const to = Number(serialRange.to);
  return records.filter((r) => {
    if (r.serialNo === undefined || r.serialNo === null) return true;
    const n = Number(r.serialNo);
    return n >= from && n <= to;
  });
}

// sectionPattern: a plain regex the caller supplies to name a course/
// section by its header text (e.g. "Sandwich") instead of a numeric
// serial range it may not already know — see
// documentTableExtractionService.detectSections' own comment for why
// this exists (a real document was found to have a named section outside
// any range the caller could have guessed). A record belongs to whichever
// detected section most recently precedes it by line position; sections
// is already sorted by startLine, so the loop below just needs the last
// one at or before the record's own startLine. Never evaluated as code,
// same discipline as documentAggregateService's filter.pattern.
// See documentAggregateService's INLINE_FLAG_PATTERN comment for why this
// is duplicated rather than shared: sectionPattern and filter.pattern need
// OPPOSITE remedies (the flag is redundant here, and would invert meaning
// there), so a helper common to both is the defect ADL-056 identified, not
// a tidy-up. Detection only — the pattern is rejected, never rewritten.
const INLINE_FLAG_PATTERN = /\(\?[a-zA-Z]+\)/;

// The sectionPattern counterpart of documentAggregateService.
// validateFilterPattern — the precondition that turns an uncompilable
// LLM-supplied pattern into a tool-level failure instead of a thrown
// DocumentAnalysisValidationError that ends the whole /ai/ask turn as an
// HTTP 500 (ADL-056). Returns { regex } or { reason }, never throws.
function compileSectionPattern(sectionPattern) {
  if (!sectionPattern) return { regex: null };
  try {
    return { regex: new RegExp(sectionPattern, 'i') };
  } catch {
    const shown = JSON.stringify(sectionPattern);
    const flagNote = INLINE_FLAG_PATTERN.test(sectionPattern)
      ? ' JavaScript does not support inline flags such as (?i), and sectionPattern is already matched' +
        ' case-insensitively, so that flag is not needed here.'
      : '';
    return { reason: `sectionPattern is not valid JavaScript regular expression syntax: ${shown}.${flagNote}` };
  }
}

// Takes an ALREADY-COMPILED regex (or null), not the raw pattern string —
// which is what makes this function structurally incapable of throwing.
// Compilation is compileSectionPattern's job, performed once as a
// precondition in analyzeAttachment.
function filterBySection(records, sections, re) {
  if (!re) return records;
  const matchingStartLines = new Set(sections.filter((s) => re.test(s.courseName)).map((s) => s.startLine));
  if (matchingStartLines.size === 0) return [];
  return records.filter((record) => {
    let active = null;
    for (const section of sections) {
      if (section.startLine <= record.startLine) active = section;
      else break;
    }
    return active !== null && matchingStartLines.has(active.startLine);
  });
}

// attachmentId, filter ({ pattern, mode }), operation, serialRange,
// sectionPattern — see aiToolRegistry's analyze_document_table entry for
// the param schema an LLM actually sees (this function's own params
// mirror it 1:1, thin wrapper per CLAUDE.md rule 1). groupBy is accepted
// but never exposed to the LLM in this slice — documentAggregateService
// only supports the default 'key' grouping (one group per extracted
// record) today, so there is nothing yet for a caller to usefully choose.
async function analyzeAttachment(
  client,
  { attachmentId, groupBy, filter, operation, serialRange, sectionPattern, comparison, identityPattern } = {},
  identityContext,
) {
  const downloaded = await loadOwnedAttachment(client, attachmentId, identityContext);
  const { document, buffer } = downloaded;

  // Both LLM-supplied regexes are validated here, once, before any
  // extraction work — after the ownership check above, never before it, so
  // an unowned attachment still fails on authorization rather than leaking
  // that its parameters were well-formed.
  //
  // 'invalid_pattern' is deliberately its own status and NOT folded into
  // no_matching_records: "your pattern was fine, the document has nothing"
  // and "your pattern was not a pattern" are different facts that need
  // different sentences to the user, and collapsing them would tell the
  // model to go looking for data when the real fix is its own argument.
  //
  // filter.pattern is checked first and only the first failure is
  // reported — a fixed, documented order rather than an arbitrary one, so
  // the same bad call always produces the same message.
  const filterPatternReason = documentAggregateService.validateFilterPattern(filter);
  if (filterPatternReason) {
    return { status: 'invalid_pattern', parameter: 'filter.pattern', reason: filterPatternReason };
  }
  const compiledSection = compileSectionPattern(sectionPattern);
  if (compiledSection.reason) {
    return { status: 'invalid_pattern', parameter: 'sectionPattern', reason: compiledSection.reason };
  }
  // The third LLM-supplied regex (ADL-057). Same treatment, its own
  // message, and deliberately not sharing a compile helper with the other
  // two — ADL-056's finding.
  const compiledIdentity = documentAggregateService.compileIdentityPattern(identityPattern);
  if (compiledIdentity.reason) {
    return { status: 'invalid_pattern', parameter: 'identityPattern', reason: compiledIdentity.reason };
  }
  // comparison is validated here too, so a malformed one costs no
  // extraction work and reaches the model as a clean message rather than
  // as a throw from deep inside the aggregate service.
  if (operation === 'compare') {
    try {
      documentAggregateService.validateComparison(comparison);
    } catch (err) {
      return { status: 'invalid_comparison', reason: err.message };
    }
  }

  const extraction = await documentTextExtractionService.extractPlainText(buffer, document.mime_type);
  if (extraction.text === null) {
    return { status: 'extraction_failed', reason: extraction.failureReason };
  }

  let { strategy, records, sections, coverage } = documentTableExtractionService.extractRecords(extraction.text);

  // ADL-063 — only reached when flat text already failed reliability on a
  // PDF. Re-extracts via pdfplumber in the sandbox and runs the result back
  // through the SAME extractRecords/assessCoverage pipeline flat text just
  // went through. If that reconstruction is at least as accounted-for as
  // flat text's own gate requires, it replaces strategy/records/sections/
  // coverage wholesale — but, per Review Finding #3 (2026-08-29), it does
  // NOT thereby earn full trust the way a reliable flat-text/native
  // extraction does. assessCoverage only proves every identity marker
  // (DoB) is accounted for once; it was never a check that the OTHER cell
  // values in each row are attached to the right identity — a layout-
  // reconstructed table can have every DoB present and unique while a
  // numeric column is still shifted onto the wrong student. ADL-063's
  // original "full trust because it passed the identical gate" reasoning
  // is exactly the false equivalence this finding corrects. If the sandbox
  // is unavailable or the reconstruction is still not reliable, these stay
  // exactly as flat text left them and the checks below fire as they do
  // today.
  //
  // Review Finding #6 (2026-08-29) — the whole block below only ever runs
  // when config.pdfPlumberFallbackEnabled is true, checked BEFORE
  // reconstructViaPdfplumber (a real sandbox round trip) is ever called —
  // the disabled path costs nothing beyond the boolean check itself.
  // fallbackTrustReason is computed here rather than re-deriving it lower
  // down, so ONE log call below can report the fallback's real terminal
  // verdict (Finding #3's own gate, a few lines down, only re-reads it).
  let pdfplumberReconstructed = false;
  let fallbackTrustReason = null;
  const fallbackApplicable = pdfFallbackApplies(document.mime_type, strategy, coverage);
  if (fallbackApplicable && !config.pdfPlumberFallbackEnabled) {
    await logPdfFallbackEvent(client, identityContext, attachmentId, { action: 'skipped' });
  } else if (fallbackApplicable) {
    const startedAt = Date.now();
    const reconstructed = await reconstructViaPdfplumber(buffer);
    if (!reconstructed) {
      await logPdfFallbackEvent(client, identityContext, attachmentId, {
        action: 'failed',
        durationMs: Date.now() - startedAt,
      });
    } else {
      const fallback = documentTableExtractionService.extractRecords(reconstructed);
      const fallbackReliable =
        fallback.strategy !== 'none' &&
        (!fallback.coverage || !fallback.coverage.applicable || fallback.coverage.reliable);
      if (fallbackReliable) {
        strategy = `${fallback.strategy}_pdfplumber`;
        ({ records, sections, coverage } = fallback);
        pdfplumberReconstructed = true;
        const integrity = documentRowIntegrityService.assessRowIntegrity(records);
        fallbackTrustReason = integrity.verified ? null : 'row_integrity_unverified';
      }
      await logPdfFallbackEvent(client, identityContext, attachmentId, {
        action: 'completed',
        resultStatus: pdfplumberReconstructed && !fallbackTrustReason ? 'ok' : 'unreliable_extraction',
        ...(fallbackTrustReason ? { reason: fallbackTrustReason } : {}),
        durationMs: Date.now() - startedAt,
      });
    }
  }

  if (strategy === 'none') {
    return { status: 'unrecognized_layout', ...fallbackProvenance(pdfplumberReconstructed) };
  }
  // Recognizing a layout is not the same as reading it correctly, and until
  // this check existed nothing told the two apart: a real exam-fees PDF
  // returned status 'ok' with a confident total computed over 4 of its 23
  // students. Kept as its own status rather than folded into
  // 'unrecognized_layout' because they are different facts and warrant
  // different sentences to the user — "I don't recognize this document's
  // layout" versus "I recognized it but couldn't read it reliably enough to
  // stand behind a number".
  if (coverage && coverage.applicable && !coverage.reliable) {
    return {
      status: 'unreliable_extraction',
      strategy,
      recordsDetected: records.length,
      rowsExpected: coverage.markerCount,
      rowsAccountedFor: coverage.accountedCount,
      ...fallbackProvenance(pdfplumberReconstructed),
    };
  }
  // Review Finding #3 — identity-marker coverage proves record presence,
  // not row-level value alignment. A pdfplumber/layout-reconstructed table
  // has no independent check yet for whether a numeric or other non-
  // identity cell landed on the correct row, so it is capped at the same
  // partial-trust signal an unreliable flat-text extraction already gets,
  // regardless of how clean its identity-marker coverage is — UNLESS
  // documentRowIntegrityService independently discovers a real,
  // document's-own arithmetic relation (e.g. a rate scaling, a running
  // total) that holds across every single record. That is the "independent
  // row-integrity check" this comment used to say did not exist yet; a
  // document with no such discoverable structure still falls through to
  // the same cap as before, unchanged. This rule is mandatory in every
  // enabled-fallback path — Review Finding #6 controls only whether the
  // fallback is ATTEMPTED at all, never whether a result earns trust once
  // it runs.
  if (pdfplumberReconstructed && fallbackTrustReason) {
    return {
      status: 'unreliable_extraction',
      strategy,
      recordsDetected: records.length,
      rowsExpected: coverage ? coverage.markerCount : records.length,
      rowsAccountedFor: coverage ? coverage.accountedCount : records.length,
      reason: fallbackTrustReason,
      ...fallbackProvenance(true, { trustReason: fallbackTrustReason }),
    };
  }

  const bySerial = filterBySerialRange(records, serialRange);
  const scoped = filterBySection(bySerial, sections, compiledSection.regex);
  if (scoped.length === 0) {
    return { status: 'no_matching_records', ...fallbackProvenance(pdfplumberReconstructed) };
  }

  // ADL-057 — a filtered list whose rows cannot say which entry they are is
  // not a shorter answer, it is a useless one. A delimited source emits
  // { key: null, cells } for every row (documentTableExtractionService's
  // splitOn), and neither aggregate nor summarize ever carried cell content
  // forward, so before this check "entries below ₹5000" over the day book
  // returned 839 rows of { key: null, serialNo: null, regNo: null }.
  // Refusing and naming the missing parameter is the honest form; the
  // caller supplies identityPattern and asks again.
  if (operation === 'compare') {
    const hasIntrinsicIdentity = scoped.some((record) => record.serialNo || record.regNo);
    if (!hasIntrinsicIdentity && !compiledIdentity.regex) {
      return { status: 'identity_required', ...fallbackProvenance(pdfplumberReconstructed) };
    }
    const compared = documentAggregateService.compareRecords(scoped, {
      filter,
      comparison,
      identityPattern: compiledIdentity.regex,
    });
    // No row cleared the threshold. Same fact as an empty scope, same
    // existing status — a valid question whose answer is "none", not a
    // failure of this system.
    if (compared.matchedCount === 0) {
      return { status: 'no_matching_records', ...fallbackProvenance(pdfplumberReconstructed) };
    }
    return {
      status: 'ok',
      strategy,
      ...compared,
      ...fallbackProvenance(pdfplumberReconstructed),
    };
  }

  const rows = documentAggregateService.aggregate(scoped, { groupBy, filter, operation });
  // Returns the deterministic cross-record answer plus a bounded sample of
  // the rows behind it — never the whole row set. Handing back every row
  // made one real 278,403-char attachment produce a 125,927-input-token
  // request (ADL-055) and, worse, left the LLM to do the very arithmetic
  // this service exists to perform. See
  // ai-chat-document-analysis-payload-bounds-approved-spec.md.
  return {
    status: 'ok',
    strategy,
    ...documentAggregateService.summarize(rows),
    ...fallbackProvenance(pdfplumberReconstructed),
  };
}

module.exports = { analyzeAttachment, DocumentAnalysisValidationError };
