'use strict';

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const documentService = require('../src/services/documentService');
const documentTextExtractionService = require('../src/services/documentTextExtractionService');
const { analyzeAttachment, DocumentAnalysisValidationError } = require('../src/services/documentAnalysisService');

const IDENTITY = { userId: 'u1', collegeId: 'college-a', role: 'principal' };
const ATTACHMENT_ID = '7768852f-e9e6-4a18-a6ea-e9c9137a89fe';

function ownedChatAttachment(overrides = {}) {
  return {
    document: {
      id: ATTACHMENT_ID,
      doc_type: documentService.CHAT_ATTACHMENT_DOC_TYPE,
      uploaded_by_user_id: 'u1',
      mime_type: documentTextExtractionService.PDF_MIME_TYPE,
      ...overrides,
    },
    buffer: Buffer.from('irrelevant — extractPlainText is mocked'),
  };
}

test.afterEach(() => mock.restoreAll());

// Caught live: the model calling analyze_document_table sometimes echoes
// its own param schema description back as the value instead of a real
// id (e.g. "the chat attachment id of the uploaded file"). Without this
// guard, that string reached a raw `SELECT ... WHERE id = $1` and threw
// "invalid input syntax for type uuid", which poisoned the rest of that
// request's DB transaction — every later query failed with the unhelpful
// "current transaction is aborted" instead of a clean, catchable error.
test('analyzeAttachment: a non-UUID attachmentId (e.g. the model echoing its own param description) throws a clean validation error, never reaches the DB', async () => {
  const downloadMock = mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  await assert.rejects(
    () => analyzeAttachment({}, {
      attachmentId: 'the chat attachment id of the uploaded file', filter: { pattern: 'RA' }, operation: 'count',
    }, IDENTITY),
    DocumentAnalysisValidationError,
  );
  assert.equal(downloadMock.mock.callCount(), 0);
});

test('analyzeAttachment: an attachment not owned by this user throws DocumentAnalysisValidationError, never silently proceeds', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment({ uploaded_by_user_id: 'someone-else' }));
  await assert.rejects(
    () => analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY),
    DocumentAnalysisValidationError,
  );
});

test('analyzeAttachment: a non-chat-attachment document (wrong doc_type) is rejected the same way', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment({ doc_type: 'institutional_document' }));
  await assert.rejects(
    () => analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY),
    DocumentAnalysisValidationError,
  );
});

test('analyzeAttachment: extraction failure (corrupt/password-protected) degrades honestly, never throws', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: null, failureReason: 'corrupt_or_unreadable' }));
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.deepEqual(result, { status: 'extraction_failed', reason: 'corrupt_or_unreadable' });
});

test('analyzeAttachment: a document with no recognizable tabular layout degrades to unrecognized_layout, not a guessed answer', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: 'Just an ordinary letter, no table.', method: 'text_layer' }));
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.deepEqual(result, { status: 'unrecognized_layout' });
});

test('analyzeAttachment: happy path — real result-sheet-shaped text is structured and aggregated end to end', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({
    text: '819 25400122 ANBARASAN V\nDoB: 24.04.2008 2 R2023 Absent\nRA RA\n3 R2023 RA\n4 R2023 RA B A+ A+ A O O',
    method: 'text_layer',
  }));
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.equal(result.status, 'ok');
  assert.equal(result.strategy, 'sequential_id');
  // The deterministic cross-record answer, computed here and not left for
  // the LLM to obtain by adding up rows it was handed.
  assert.equal(result.total, 4);
  assert.equal(result.matchedCount, 1);
  assert.deepEqual(result.sample, [{
    key: '819:25400122', serialNo: '819', regNo: '25400122', count: 4,
  }]);
  assert.equal(result.sampleShown, 1);
  assert.equal(result.sampleOmitted, 0);
});

test('analyzeAttachment: serialRange narrows results to the requested range, matching a real "consolidate serial X to Y" question', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({
    text: '818 25400121 AKASH B\n4 R2023 B\n\n819 25400122 ANBARASAN V\n4 R2023 RA',
    method: 'text_layer',
  }));
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count', serialRange: { from: 819, to: 819 },
  }, IDENTITY);
  assert.equal(result.status, 'ok');
  assert.equal(result.sample.length, 1);
  assert.equal(result.sample[0].serialNo, '819');
  // 818 is inside the scoped set but matches nothing, so it counts toward
  // scopedCount and not matchedCount — the distinction the answer needs to
  // say "1 of 2 students", not "1 of 1".
  assert.equal(result.matchedCount, 1);
  assert.equal(result.total, 1);
});

test('analyzeAttachment: a serialRange matching nothing degrades to no_matching_records, never a hallucinated table', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({
    text: '818 25400121 AKASH B\n4 R2023 B',
    method: 'text_layer',
  }));
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count', serialRange: { from: 9000, to: 9001 },
  }, IDENTITY);
  assert.deepEqual(result, { status: 'no_matching_records' });
});

// A live comparison against a direct Gemini upload of the same real
// result sheet found a named cohort ("ECE Sandwich") at a serial range
// nowhere near the one the user actually knew ("818 to 872") — sectionPattern
// exists so the model can name the cohort instead of guessing a range.
const TWO_SECTION_DOC = `818 25400121 AKASH B
4 R2023 B

111 GOVERNMENT POLYTECHNIC COLLEGE, COIMBATORE 1040 ELECTRONICS AND COMMUNICATION ENGINEERING (FULL TIME) 10

111 GOVERNMENT POLYTECHNIC COLLEGE, COIMBATORE 2040 ELECTRONICS AND COMMUNICATION ENGINEERING (SANDWICH) 24

1133 24700311 ABINAV VISHAL R
1 R2023 RA`;

test('analyzeAttachment: sectionPattern scopes to a named cohort without the caller knowing its serial range', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: TWO_SECTION_DOC, method: 'text_layer' }));
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count', sectionPattern: 'sandwich',
  }, IDENTITY);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.sample.map((r) => r.serialNo), ['1133']);
});

test('analyzeAttachment: a sectionPattern matching no real section degrades to no_matching_records, never a hallucinated cohort', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: TWO_SECTION_DOC, method: 'text_layer' }));
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count', sectionPattern: 'no such cohort',
  }, IDENTITY);
  assert.deepEqual(result, { status: 'no_matching_records' });
});

test('analyzeAttachment: sectionPattern combines with serialRange as an AND, not an OR', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: TWO_SECTION_DOC, method: 'text_layer' }));
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID,
    filter: { pattern: 'RA' },
    operation: 'count',
    sectionPattern: 'sandwich',
    serialRange: { from: 1, to: 900 },
  }, IDENTITY);
  assert.deepEqual(result, { status: 'no_matching_records' });
});

test('analyzeAttachment: operation "breakdown" returns per-semester counts, not just a per-record total', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({
    text: '819 25400122 ANBARASAN V\nDoB: 24.04.2008 2 R2023 Absent\nRA RA\n3 R2023 RA\n4 R2023 RA B A+ A+ A O O',
    method: 'text_layer',
  }));
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'breakdown' }, IDENTITY);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.sample, [{
    key: '819:25400122',
    serialNo: '819',
    regNo: '25400122',
    breakdown: [{ semester: 2, count: 2 }, { semester: 3, count: 1 }, { semester: 4, count: 1 }],
    total: 4,
  }]);
  // The cross-record per-semester rollup — present only for 'breakdown',
  // never an empty array for count/sum (see rollupBySemester's comment).
  assert.deepEqual(result.bySemester, [
    { semester: 2, count: 2 }, { semester: 3, count: 1 }, { semester: 4, count: 1 },
  ]);
  assert.equal(result.total, 4);
});

// --- Item 1: the extraction trust boundary -----------------------------
// (ai-chat-document-extraction-trust-and-formats-approved-spec.md)
//
// Before this, analyzeAttachment guarded strategy 'none' and nothing else,
// so a layout that WAS recognized but read wrongly came back as
// status 'ok' with a confident total. Measured against a real exam-fees
// PDF: 4 records for a 23-student document, reported ok. That also slips
// past verifyNumericClaims, which compares the narration to the tool
// output and never the tool output to the document.

test('analyzeAttachment: a recognized-but-misread layout refuses instead of returning a confident total', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  // The shape a merged-cell PDF extraction actually produces: only the
  // first row starts with the serial+regNo pair, so the rest are swallowed
  // into its block and two students are never reached at all.
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({
    text: [
      '818 24700301 ANBARASAN V DoB: 23.12.2006 RA',
      'BHARATH K DoB: 19.06.2006 24700302 RA',
      'CHANDRU M DoB: 25.06.2002 24700303 RA',
    ].join('\n'),
    method: 'text_layer',
  }));
  const result = await analyzeAttachment(
    {}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY,
  );
  assert.equal(result.status, 'unreliable_extraction');
  // The shortfall is reported, not just the refusal — a caller (and the
  // user) should be able to see how far off the reading was.
  assert.equal(result.rowsExpected, 3);
  assert.equal(result.recordsDetected, 1);
  assert.ok(result.total === undefined, 'must not return a total it cannot stand behind');
});

test('analyzeAttachment: unreliable_extraction is distinct from unrecognized_layout', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: 'An ordinary letter.', method: 'text_layer' }));
  const result = await analyzeAttachment(
    {}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY,
  );
  assert.equal(result.status, 'unrecognized_layout');
});

// The reference document must be unaffected. A roster the detector reads
// correctly still answers, including one carrying the deliberate
// page-break merge that produces a second marker in the same record.
test('analyzeAttachment: a correctly-read roster still returns ok, page-break merge included', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({
    text: [
      '818 24700301 ANBARASAN V DoB: 23.12.2006 RA',
      '818 24700301 ANBARASAN V DoB: 23.12.2006 RA',
      '819 24700302 BHARATH K DoB: 19.06.2006',
    ].join('\n'),
    method: 'text_layer',
  }));
  const result = await analyzeAttachment(
    {}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY,
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.scopedCount, 2);
  assert.equal(result.total, 2);
});

// A document whose rows carry no identity marker gives no signal either
// way, and no signal must mean no judgement — never a refusal.
test('analyzeAttachment: a roster with no identity marker is not refused', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({
    text: '818 24700301 ANBARASAN V 1 R2023 RA\n819 24700302 BHARATH K 1 R2023 A',
    method: 'text_layer',
  }));
  const result = await analyzeAttachment(
    {}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY,
  );
  assert.equal(result.status, 'ok');
});
