'use strict';

// Orchestrating Business Service for ADR-029's Deterministic Analysis path
// — the ONE service the analyze_document_table AI tool wraps (RS-AIG-002:
// every tool wraps exactly one Business Service method). Composes three
// pieces, none of which know about each other's callers:
//   documentService              -> ownership-checked byte download
//   documentTextExtractionService -> existing plain-text extraction (unchanged)
//   documentTableExtractionService -> structural record detection (new)
//   documentAggregateService      -> fixed count/sum operations (new)
// Never persists anything — every result here is transient, scoped to one
// /ai/ask turn, same lifecycle images/documents already have in
// aiService.resolveChatAttachments (ADR-029's "no schema changes" call).

const documentService = require('./documentService');
const documentTextExtractionService = require('./documentTextExtractionService');
const documentTableExtractionService = require('./documentTableExtractionService');
const documentAggregateService = require('./documentAggregateService');

class DocumentAnalysisValidationError extends Error {}

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
  const isOwnedChatAttachment = document
    && document.doc_type === documentService.CHAT_ATTACHMENT_DOC_TYPE
    && document.uploaded_by_user_id === identityContext.userId
    && typeof document.mime_type === 'string';
  if (!isOwnedChatAttachment) {
    throw new DocumentAnalysisValidationError(`attachment ${JSON.stringify(attachmentId)} is not a valid attachment for this user`);
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
function filterBySection(records, sections, sectionPattern) {
  if (!sectionPattern) return records;
  let re;
  try {
    re = new RegExp(sectionPattern, 'i');
  } catch {
    throw new DocumentAnalysisValidationError(`sectionPattern is not a valid pattern: ${JSON.stringify(sectionPattern)}`);
  }
  const matchingStartLines = new Set(sections.filter((s) => re.test(s.courseName)).map((s) => s.startLine));
  if (matchingStartLines.size === 0) return [];
  return records.filter((record) => {
    let active = null;
    for (const section of sections) {
      if (section.startLine <= record.startLine) active = section; else break;
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
async function analyzeAttachment(client, {
  attachmentId, groupBy, filter, operation, serialRange, sectionPattern,
} = {}, identityContext) {
  const downloaded = await loadOwnedAttachment(client, attachmentId, identityContext);
  const { document, buffer } = downloaded;

  const extraction = await documentTextExtractionService.extractPlainText(buffer, document.mime_type);
  if (extraction.text === null) {
    return { status: 'extraction_failed', reason: extraction.failureReason };
  }

  const { strategy, records, sections } = documentTableExtractionService.extractRecords(extraction.text);
  if (strategy === 'none') {
    return { status: 'unrecognized_layout' };
  }

  const bySerial = filterBySerialRange(records, serialRange);
  const scoped = filterBySection(bySerial, sections, sectionPattern);
  if (scoped.length === 0) {
    return { status: 'no_matching_records' };
  }

  const rows = documentAggregateService.aggregate(scoped, { groupBy, filter, operation });
  // Returns the deterministic cross-record answer plus a bounded sample of
  // the rows behind it — never the whole row set. Handing back every row
  // made one real 278,403-char attachment produce a 125,927-input-token
  // request (ADL-055) and, worse, left the LLM to do the very arithmetic
  // this service exists to perform. See
  // ai-chat-document-analysis-payload-bounds-approved-spec.md.
  return { status: 'ok', strategy, ...documentAggregateService.summarize(rows) };
}

module.exports = { analyzeAttachment, DocumentAnalysisValidationError };
