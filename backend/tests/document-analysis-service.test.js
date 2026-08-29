'use strict';

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const documentService = require('../src/services/documentService');
const documentTextExtractionService = require('../src/services/documentTextExtractionService');
const sandboxExecutionService = require('../src/services/sandboxExecutionService');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const config = require('../src/config');
const { analyzeAttachment, DocumentAnalysisValidationError } = require('../src/services/documentAnalysisService');

// Review Finding #6 — every test in this file was written before the
// pdfplumber fallback had a kill switch, so every one of them assumes the
// fallback attempts whenever primary extraction is unreliable on a PDF.
// The new safe default (config.pdfPlumberFallbackEnabled = false) would
// silently change every one of those tests' meaning to "the flag is off,
// so of course the fallback never ran" — not what they were written to
// prove. Defaulting THIS FILE's tests to the flag enabled preserves their
// original intent unchanged; the flag's own disabled-by-default behavior
// gets its own explicit tests instead (see the "Finding #6" section below).
// auditLogRepository.createAuditLogEntry is mocked here too because every
// test in this file calls analyzeAttachment with a bare `{}` as `client`
// (documentService.downloadDocument is mocked, so the fake client was
// never actually used before) — logPdfFallbackEvent's real
// createAuditLogEntry would call client.query and throw on that fake
// client otherwise.
const DEFAULT_PDF_PLUMBER_FALLBACK_ENABLED = config.pdfPlumberFallbackEnabled;
test.beforeEach(() => {
  config.pdfPlumberFallbackEnabled = true;
  mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
});

// The default PDF mime type in ownedChatAttachment() means every test whose
// flat-text extraction yields 'none' or an unreliable coverage would, since
// ADL-063, reach for the pdfplumber sandbox fallback — a REAL network call
// if this is not mocked, regardless of whether this environment happens to
// have SANDBOX_SERVICE_URL/TOKEN set (docker-compose's app service does).
// Explicit and deterministic beats "happens to work because the test env
// is unconfigured" — every pre-ADL-063 test that reaches the fallback
// trigger mocks the sandbox as unavailable, which is also itself the
// regression pin for "sandbox unavailable degrades to today's behaviour".
function mockSandboxUnavailable() {
  return mock.method(sandboxExecutionService, 'executeCode', async () => {
    throw new sandboxExecutionService.SandboxNotConfiguredError('not configured in tests');
  });
}

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

test.afterEach(() => {
  mock.restoreAll();
  config.pdfPlumberFallbackEnabled = DEFAULT_PDF_PLUMBER_FALLBACK_ENABLED;
});

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
  mockSandboxUnavailable();
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.deepEqual(result, { status: 'unrecognized_layout', fallbackUsed: false });
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
  assert.deepEqual(result, { status: 'no_matching_records', fallbackUsed: false });
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
  assert.deepEqual(result, { status: 'no_matching_records', fallbackUsed: false });
});

// --- ADL-056: an uncompilable LLM-supplied pattern fails the TOOL, not the
// TURN. Measured live: the model supplied a Python inline flag,
// filterBySection threw, and mapAiToolError does not know
// DocumentAnalysisValidationError — so the user's whole /ai/ask turn ended
// as an HTTP 500. These assert the throw is gone and that the replacement
// says which of the two regex parameters was rejected.
test('analyzeAttachment: an uncompilable sectionPattern returns invalid_pattern instead of throwing out of the turn', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: TWO_SECTION_DOC, method: 'text_layer' }));
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count', sectionPattern: '(?i)SANDWICH',
  }, IDENTITY);
  assert.equal(result.status, 'invalid_pattern');
  assert.equal(result.parameter, 'sectionPattern');
});

// The exact pattern from the live run recorded in ADL-056.
test('analyzeAttachment: the measured live (?i) sectionPattern is explained as a JS-syntax fault, and the redundant flag is called out', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: TWO_SECTION_DOC, method: 'text_layer' }));
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID,
    filter: { pattern: 'RA' },
    operation: 'count',
    sectionPattern: '(?i)ELECTRONICS AND COMMUNICATION ENGINEERING \\(SANDWICH\\)|2040',
  }, IDENTITY);
  assert.equal(result.status, 'invalid_pattern');
  assert.match(result.reason, /JavaScript/);
  assert.match(result.reason, /already matched\s+case-insensitively/);
});

test('analyzeAttachment: an uncompilable filter.pattern returns invalid_pattern naming filter.pattern, a DIFFERENT parameter from sectionPattern', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: TWO_SECTION_DOC, method: 'text_layer' }));
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID, filter: { pattern: '(?i)RA' }, operation: 'count',
  }, IDENTITY);
  assert.equal(result.status, 'invalid_pattern');
  assert.equal(result.parameter, 'filter.pattern');
  // filter.pattern's remedy is the OPPOSITE of sectionPattern's — it is
  // deliberately case-sensitive, so the message must never suggest the flag
  // was merely redundant. Pins ADL-056's central correction.
  assert.match(result.reason, /case-sensitively by design/);
});

// "Your pattern was not a pattern" and "your pattern was fine, the document
// has nothing" are different facts. Collapsing them would send the model
// looking for data when the real fix is its own argument.
test('analyzeAttachment: invalid_pattern is distinct from no_matching_records', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: TWO_SECTION_DOC, method: 'text_layer' }));
  const invalid = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count', sectionPattern: '(?i)SANDWICH',
  }, IDENTITY);
  const empty = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count', sectionPattern: 'no such cohort',
  }, IDENTITY);
  assert.equal(invalid.status, 'invalid_pattern');
  assert.equal(empty.status, 'no_matching_records');
  assert.notEqual(invalid.status, empty.status);
});

// The pattern check must not run before the ownership check — an unowned
// attachment fails on authorization, never on the shape of its arguments.
test('analyzeAttachment: an unowned attachment with a bad pattern still fails on ownership, not invalid_pattern', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment({ uploaded_by_user_id: 'someone-else' }));
  await assert.rejects(
    () => analyzeAttachment({}, {
      attachmentId: ATTACHMENT_ID, filter: { pattern: '(?i)RA' }, operation: 'count',
    }, IDENTITY),
    DocumentAnalysisValidationError,
  );
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
  assert.deepEqual(result, { status: 'no_matching_records', fallbackUsed: false });
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
  mockSandboxUnavailable();
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
  mockSandboxUnavailable();
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

// --- ADL-057: operation 'compare' end to end through the analysis path ---

// Tab-separated, so extractRecords genuinely returns the `delimited`
// strategy — the whole point of the identity work below. Built as real
// text and run through the real extractor rather than hand-assembled
// records: hand-supplying a `key` is exactly what hid the anonymous-row
// defect (document-aggregate-service.test.js:25) until ADL-057's pass.
const DAYBOOK_TEXT = [
  'Date\tParticulars\tVoucher\tDebit',
  '01-04-2026\tANBU TRADERS\tPayment\t4500',
  '02-04-2026\tBHARATH STORES\tReceipt\t12000',
  '03-04-2026\tDEEPA SUPPLIES\tPayment\t1250',
].join('\n');

const AMOUNT = '([\\d,]+)$';
const PARTY = '([A-Z]{2,}(?: [A-Z]{2,})*)';

function daybookAttachment() {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: DAYBOOK_TEXT, method: 'text_layer' }));
}

test('analyzeAttachment: compare over a delimited source returns only the rows under the threshold, each identified', async () => {
  daybookAttachment();
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID,
    filter: { pattern: AMOUNT },
    operation: 'compare',
    comparison: { operator: 'lt', value: 5000 },
    identityPattern: PARTY,
  }, IDENTITY);
  assert.equal(result.status, 'ok');
  assert.equal(result.strategy, 'delimited');
  assert.equal(result.matchedCount, 2);
  assert.deepEqual(result.sample.map((r) => r.identity), ['ANBU TRADERS', 'DEEPA SUPPLIES']);
  assert.deepEqual(result.sample.map((r) => r.value), [4500, 1250]);
  assert.equal(result.total, 5750);
});

// The defect ADL-057's pass found by reading the code: every delimited row
// carries key: null, and nothing ever carried cell content forward, so a
// filtered list came back as rows of nulls. Refusing is the honest form.
test('analyzeAttachment: compare on a delimited source with no identityPattern returns identity_required, never a list of anonymous rows', async () => {
  daybookAttachment();
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID,
    filter: { pattern: AMOUNT },
    operation: 'compare',
    comparison: { operator: 'lt', value: 5000 },
  }, IDENTITY);
  assert.deepEqual(result, { status: 'identity_required', fallbackUsed: false });
});

// A roster already has serialNo/regNo, so it needs no identityPattern —
// the refusal is about rows that would be anonymous, not about the
// parameter being mandatory.
test('analyzeAttachment: compare on a sequential_id source needs no identityPattern — it already has serial/reg numbers', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({
    text: '819 25400122 ANBARASAN V\nDoB: 24.04.2008 Fee 4500\n820 25400123 BHARATH K\nDoB: 11.02.2008 Fee 9000',
    method: 'text_layer',
  }));
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID,
    filter: { pattern: 'Fee\\s+(\\d+)' },
    operation: 'compare',
    comparison: { operator: 'lt', value: 5000 },
  }, IDENTITY);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.sample.map((r) => r.serialNo), ['819']);
});

test('analyzeAttachment: compare where no row clears the threshold degrades to no_matching_records', async () => {
  daybookAttachment();
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID,
    filter: { pattern: AMOUNT },
    operation: 'compare',
    comparison: { operator: 'lt', value: 10 },
    identityPattern: PARTY,
  }, IDENTITY);
  assert.deepEqual(result, { status: 'no_matching_records', fallbackUsed: false });
});

// Same posture ADL-056 established for the other two regexes: a clean
// tool-level status naming the parameter, never a throw out of the turn.
test('analyzeAttachment: an uncompilable identityPattern returns invalid_pattern naming identityPattern', async () => {
  daybookAttachment();
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID,
    filter: { pattern: AMOUNT },
    operation: 'compare',
    comparison: { operator: 'lt', value: 5000 },
    identityPattern: '(?i)ANBU',
  }, IDENTITY);
  assert.equal(result.status, 'invalid_pattern');
  assert.equal(result.parameter, 'identityPattern');
});

// A malformed comparison must not throw DocumentAggregateValidationError
// out of the turn either — the ADL-056 rule applied to the new param.
test('analyzeAttachment: a malformed comparison returns invalid_comparison instead of throwing out of the turn', async () => {
  daybookAttachment();
  const missing = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID, filter: { pattern: AMOUNT }, operation: 'compare', identityPattern: PARTY,
  }, IDENTITY);
  assert.equal(missing.status, 'invalid_comparison');
  const badOperator = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID,
    filter: { pattern: AMOUNT },
    operation: 'compare',
    comparison: { operator: 'roughly', value: 5000 },
    identityPattern: PARTY,
  }, IDENTITY);
  assert.equal(badOperator.status, 'invalid_comparison');
  assert.match(badOperator.reason, /comparison\.operator/);
});

// Validation runs before extraction, so a malformed call costs no work —
// and, as with the pattern checks, after the ownership check.
test('analyzeAttachment: comparison is validated before the document is extracted', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  const extractMock = mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: DAYBOOK_TEXT, method: 'text_layer' }));
  await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID, filter: { pattern: AMOUNT }, operation: 'compare',
  }, IDENTITY);
  assert.equal(extractMock.mock.callCount(), 0);
});

test('analyzeAttachment: compare reports what it could not read, so a partial total is never presented as complete', async () => {
  daybookAttachment();
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID,
    filter: { pattern: '(\\S+)$' },
    operation: 'compare',
    comparison: { operator: 'lt', value: 5000 },
    identityPattern: PARTY,
  }, IDENTITY);
  assert.equal(result.status, 'ok');
  assert.ok(result.nonNumericRows > 0);
  assert.equal(typeof result.unmatchedRows, 'number');
  assert.equal(typeof result.multiMatchRows, 'number');
  assert.equal(result.scopedCount, 4);
});

// The existing operations must be byte-unchanged by this slice.
test('analyzeAttachment: count/sum/breakdown are unaffected by the compare additions', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({
    text: '819 25400122 ANBARASAN V\nDoB: 24.04.2008 2 R2023 RA\n3 R2023 RA',
    method: 'text_layer',
  }));
  const counted = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count',
  }, IDENTITY);
  assert.equal(counted.status, 'ok');
  assert.equal(counted.total, 2);
  assert.equal(counted.sample[0].identity, undefined);
});

// --- ADL-063: the pdfplumber fallback replaces ADL-058's geometry design.
// Originally, a reconstruction that passed the SAME reliability gate flat
// text uses got FULL trust on the theory that passing assessCoverage a
// second time was equivalent to a reliable native extraction. Review
// Finding #3 (2026-08-29) corrected that: assessCoverage only proves every
// identity marker (DoB) is accounted for once, never that the OTHER cell
// values in each row are attached to the right identity — a real risk for
// a layout-reconstructed table specifically. Until an independent
// row-integrity check exists, a pdfplumber reconstruction is capped at
// the same unreliable_extraction tier a flat-text extraction gets when its
// own coverage fails, regardless of how clean its identity coverage is.

// Shaped exactly like the existing "recognized-but-misread layout" test
// above (same merged-cell defect: only the first row starts with a real
// serial+regNo pair), but this time pdfplumber's reconstruction — what the
// sandbox would actually return — recovers all three rows correctly.
const MISREAD_FLAT_TEXT = [
  '818 24700301 ANBARASAN V DoB: 23.12.2006 RA',
  'BHARATH K DoB: 19.06.2006 24700302 RA',
  'CHANDRU M DoB: 25.06.2002 24700303 RA',
].join('\n');

const PDFPLUMBER_RECONSTRUCTED_TEXT = [
  '818 24700301 ANBARASAN V DoB: 23.12.2006 RA',
  '819 24700302 BHARATH K DoB: 19.06.2006 RA',
  '820 24700303 CHANDRU M DoB: 25.06.2002 RA',
].join('\n');

function mockSandboxReturning(stdout) {
  return mock.method(sandboxExecutionService, 'executeCode', async () => ({
    stdout, stderr: '', exitCode: 0, files: [], verification: null,
  }));
}

test('ADL-063: a reliable flat-text extraction never invokes the sandbox', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({
    text: '819 25400122 ANBARASAN V\nDoB: 24.04.2008 2 R2023 RA\n3 R2023 RA',
    method: 'text_layer',
  }));
  const executeCodeMock = mockSandboxReturning('irrelevant');
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.equal(result.status, 'ok');
  assert.equal(executeCodeMock.mock.callCount(), 0);
});

test('ADL-063: a non-PDF attachment never invokes the sandbox, even with an unrecognized layout', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment({ mime_type: 'text/csv' }));
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: 'Just an ordinary letter, no table.', method: 'text_layer' }));
  const executeCodeMock = mockSandboxReturning('irrelevant');
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.deepEqual(result, { status: 'unrecognized_layout', fallbackUsed: false });
  assert.equal(executeCodeMock.mock.callCount(), 0);
});

// Test 1 (Review Finding #3) — the defect class: every identity marker is
// present exactly once, non-identity values (RA) exist, the strategy is a
// pdfplumber reconstruction, and there is no independent row-integrity
// check. Identity coverage alone must not upgrade this to full trust.
test('ADL-063 / Finding #3: a verified-by-coverage pdfplumber reconstruction is still capped at unreliable_extraction, never full trust', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  mockSandboxReturning(PDFPLUMBER_RECONSTRUCTED_TEXT);
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.equal(result.status, 'unreliable_extraction');
  assert.equal(result.reason, 'row_integrity_unverified');
  // The reconstruction strategy is still surfaced (metadata/audit), and
  // rowsExpected === rowsAccountedFor distinguishes this from a genuine
  // marker shortfall — coverage passed, row alignment is simply unproven.
  assert.equal(result.strategy, 'sequential_id_pdfplumber');
  assert.equal(result.rowsExpected, 3);
  assert.equal(result.rowsAccountedFor, 3);
  assert.ok(result.total === undefined, 'must not return a total it cannot stand behind');
});

test('ADL-063 / Finding #3: compare on a verified-by-coverage pdfplumber reconstruction is also capped, never reaches the aggregate service', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  mockSandboxReturning(PDFPLUMBER_RECONSTRUCTED_TEXT);
  const compared = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID,
    filter: { pattern: 'DoB: \\d{2}\\.(\\d{2})' },
    operation: 'compare',
    comparison: { operator: 'gte', value: 1 },
  }, IDENTITY);
  assert.equal(compared.status, 'unreliable_extraction');
  assert.equal(compared.reason, 'row_integrity_unverified');
  assert.ok(compared.matchedCount === undefined, 'must not return a compare result it cannot stand behind');
});

// documentRowIntegrityService's own extension point, named directly in
// documentAnalysisService's Finding #3 comment: a reconstruction that
// passes coverage AND whose numbers carry two independent, non-hand-fit
// arithmetic relations (a rate scaling, a running total — the same shape
// measured against the real exam-fees PDF via
// backend/scripts/row-arithmetic-consistency-probe.js) earns full trust
// instead of staying capped forever. Fewer than 5 records or fewer than 2
// relations must still fall through to the cap unchanged — covered by
// documentRowIntegrityService's own unit tests, not repeated here.
const MISREAD_FEES_FLAT_TEXT = [
  '818 24700301 ANBARASAN V DoB: 23.12.2006 1 65 625 Total: 690',
  'BHARATH K DoB: 19.06.2006 24700302 0 0 625 Total: 625',
  'CHANDRU M DoB: 25.06.2002 24700303 2 130 625 Total: 755',
  'DEEPAK R DoB: 11.11.2001 24700304 0 0 625 Total: 625',
  'ESWAR S DoB: 09.09.2003 24700305 3 195 625 Total: 820',
].join('\n');

const PDFPLUMBER_RECONSTRUCTED_FEES_TEXT = [
  '818 24700301 ANBARASAN V DoB: 23.12.2006 1 65 625 Total: 690',
  '819 24700302 BHARATH K DoB: 19.06.2006 0 0 625 Total: 625',
  '820 24700303 CHANDRU M DoB: 25.06.2002 2 130 625 Total: 755',
  '821 24700304 DEEPAK R DoB: 11.11.2001 0 0 625 Total: 625',
  '822 24700305 ESWAR S DoB: 09.09.2003 3 195 625 Total: 820',
].join('\n');

test('ADL-063 / Finding #3 (row integrity extension): a pdfplumber reconstruction whose numbers verify earns full trust, count runs', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FEES_FLAT_TEXT, method: 'text_layer' }));
  mockSandboxReturning(PDFPLUMBER_RECONSTRUCTED_FEES_TEXT);
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'DoB' }, operation: 'count' }, IDENTITY);
  assert.equal(result.status, 'ok');
  assert.equal(result.strategy, 'sequential_id_pdfplumber');
  assert.equal(result.scopedCount, 5);
  assert.equal(result.total, 5);
});

test('ADL-063 / Finding #3 (row integrity extension): sum also runs on a row-integrity-verified reconstruction, not just count', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FEES_FLAT_TEXT, method: 'text_layer' }));
  mockSandboxReturning(PDFPLUMBER_RECONSTRUCTED_FEES_TEXT);
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'Total:\\s*(\\d+)' }, operation: 'sum' }, IDENTITY);
  assert.equal(result.status, 'ok');
  assert.equal(result.total, 690 + 625 + 755 + 625 + 820);
});

test('ADL-063: a pdfplumber reconstruction that is STILL not reliable leaves unreliable_extraction unchanged', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  // The sandbox ran, but its own reconstruction is just as misattributed
  // as the original — e.g. a scanned/garbled page pdfplumber cannot help
  // with either.
  mockSandboxReturning(MISREAD_FLAT_TEXT);
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.equal(result.status, 'unreliable_extraction');
  assert.equal(result.strategy, 'sequential_id');
  assert.ok(result.total === undefined);
  // Distinct from Finding #3's gate: this is a genuine marker shortfall
  // (rowsAccountedFor below rowsExpected), not "coverage passed but row
  // alignment is unproven" — the fallback was never adopted at all, so no
  // 'row_integrity_unverified' reason is attached.
  assert.equal(result.reason, undefined);
});

test('ADL-063: the sandbox being unreachable (SandboxExecutionError) degrades to today\'s status, never a thrown error out of the turn', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  mock.method(sandboxExecutionService, 'executeCode', async () => {
    throw new sandboxExecutionService.SandboxExecutionError('sandbox returned 503');
  });
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.equal(result.status, 'unreliable_extraction');
});

test('ADL-063: a PDF exceeding the sandbox size limit (SandboxValidationError) degrades to today\'s status, not a thrown error', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  mock.method(sandboxExecutionService, 'executeCode', async () => {
    throw new sandboxExecutionService.SandboxValidationError('file exceeds the 5MB limit');
  });
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.equal(result.status, 'unreliable_extraction');
});

// ADL-058's own separator finding, reused unchanged: joining pdfplumber's
// row cells with anything but a single space silently switches the
// reconstruction onto the anonymous 'delimited' strategy and turns
// coverage checking off. This pins the SCRIPT sent to the sandbox, not
// just its output — a future "helpful" edit to the join character would
// otherwise pass every other test here undetected.
test('ADL-063: the sandbox script joins row cells with a single space, never a pipe or tab', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  const executeCodeMock = mockSandboxReturning(PDFPLUMBER_RECONSTRUCTED_TEXT);
  await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  const sentCode = executeCodeMock.mock.calls[0].arguments[0].code;
  assert.match(sentCode, /' '\.join\(cells\)/);
  assert.doesNotMatch(sentCode, /\| '\.join/);
  assert.doesNotMatch(sentCode, /\\t/);
});

// ADL-058 addendum 2's own explicit warning: the 'text'/'text' strategy
// reproduces the exact original defect. Pinned so it can never be
// reintroduced as a "tuning" change.
test('ADL-063: the sandbox script never overrides pdfplumber\'s default table_settings', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  const executeCodeMock = mockSandboxReturning(PDFPLUMBER_RECONSTRUCTED_TEXT);
  await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  const sentCode = executeCodeMock.mock.calls[0].arguments[0].code;
  assert.doesNotMatch(sentCode, /vertical_strategy/);
  assert.doesNotMatch(sentCode, /table_settings/);
});

// The reference document (day book, delimited strategy, coverage always
// null) must never reach the sandbox — it already succeeds on flat text.
test('ADL-063: a delimited (day-book-shaped) source never invokes the sandbox', async () => {
  daybookAttachment();
  const executeCodeMock = mockSandboxReturning('irrelevant');
  const result = await analyzeAttachment({}, {
    attachmentId: ATTACHMENT_ID, filter: { pattern: AMOUNT }, operation: 'count',
  }, IDENTITY);
  assert.equal(result.status, 'ok');
  assert.equal(result.strategy, 'delimited');
  assert.equal(executeCodeMock.mock.callCount(), 0);
});

// --- Review Finding #6 (2026-08-29) — the pdfplumber fallback gained a
// kill switch (config.pdfPlumberFallbackEnabled). This file's own
// beforeEach defaults it to true so every test above keeps its original
// meaning ("the fallback always attempts") unchanged; these tests are the
// explicit disabled/enabled/native/audit-log coverage the flag itself
// needs, on top of that default.

function auditLogMock() {
  return mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
}

test('Finding #6: disabled flag never invokes the sandbox — the primary unreliable result is returned unchanged', async () => {
  config.pdfPlumberFallbackEnabled = false;
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  const executeCodeMock = mockSandboxReturning(PDFPLUMBER_RECONSTRUCTED_TEXT);
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.equal(executeCodeMock.mock.callCount(), 0, 'reconstructViaPdfplumber must never run when the flag is off');
  // Same status/strategy/reason a flat-text-only extraction has always
  // returned for this exact defect (see "a recognized-but-misread layout
  // refuses instead of returning a confident total" above) — Finding #6
  // must not change what an unreliable PRIMARY extraction returns, only
  // whether pdfplumber is ever reached for.
  assert.equal(result.status, 'unreliable_extraction');
  assert.equal(result.strategy, 'sequential_id');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.reason, undefined, 'this is the coverage-shortfall reason, never row_integrity_unverified — that reason only exists once a fallback actually ran');
});

test('Finding #6: disabled flag still logs the event, as "skipped" — never silently invisible', async () => {
  config.pdfPlumberFallbackEnabled = false;
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  mockSandboxReturning(PDFPLUMBER_RECONSTRUCTED_TEXT);
  const auditMock = auditLogMock();
  await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.equal(auditMock.mock.callCount(), 1);
  const [, fields] = auditMock.mock.calls[0].arguments;
  assert.equal(fields.action, 'ai_pdf_table_fallback');
  assert.equal(fields.entity, 'ai_attachments');
  assert.equal(fields.entityId, ATTACHMENT_ID);
  assert.equal(fields.metadata.enabled, false);
  assert.equal(fields.metadata.action, 'skipped');
  // Never the document's own content, values, or names.
  assert.ok(!JSON.stringify(fields.metadata).includes('ANBARASAN'));
});

test('Finding #6: enabled flag invokes the sandbox and the result carries structured fallback provenance, not just the _pdfplumber suffix', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  const executeCodeMock = mockSandboxReturning(PDFPLUMBER_RECONSTRUCTED_TEXT);
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.equal(executeCodeMock.mock.callCount(), 1);
  assert.equal(result.strategy, 'sequential_id_pdfplumber', 'the existing suffix is preserved for backward compatibility');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.fallbackProvider, 'pdfplumber');
  assert.equal(result.reconstructionType, 'layout_based');
  assert.equal(result.primaryExtractionReliable, false);
  // This document's coverage passes but row integrity is unverified
  // (Finding #3, unchanged by this task) — trustReason must say so, and
  // the top-level `reason` field (existing, backward-compatible) must
  // agree with it, never contradict it.
  assert.equal(result.trustReason, 'row_integrity_unverified');
  assert.equal(result.reason, 'row_integrity_unverified');
});

test('Finding #6: enabled flag logs "completed" with the fallback\'s own resultStatus/reason, no document content', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  mockSandboxReturning(PDFPLUMBER_RECONSTRUCTED_TEXT);
  const auditMock = auditLogMock();
  await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.equal(auditMock.mock.callCount(), 1);
  const [, fields] = auditMock.mock.calls[0].arguments;
  assert.equal(fields.metadata.enabled, true);
  assert.equal(fields.metadata.action, 'completed');
  assert.equal(fields.metadata.resultStatus, 'unreliable_extraction');
  assert.equal(fields.metadata.reason, 'row_integrity_unverified');
  assert.equal(typeof fields.metadata.durationMs, 'number');
  assert.ok(!JSON.stringify(fields.metadata).includes('ANBARASAN'), 'no document content in the audit trail');
});

test('Finding #6: a sandbox failure while enabled logs "failed" and degrades exactly as before, no fallbackUsed', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  mock.method(sandboxExecutionService, 'executeCode', async () => {
    throw new sandboxExecutionService.SandboxNotConfiguredError('not configured in tests');
  });
  const auditMock = auditLogMock();
  const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
  assert.equal(result.status, 'unreliable_extraction');
  assert.equal(result.fallbackUsed, false);
  const [, fields] = auditMock.mock.calls[0].arguments;
  assert.equal(fields.metadata.action, 'failed');
});

test('Finding #6 (Test 3 — Finding #3 remains enforced): even with the flag enabled, a verified-by-coverage-only reconstruction never reaches "ok", and aggregate/compare never run over it', async () => {
  mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
  mock.method(documentTextExtractionService, 'extractPlainText', async () => ({ text: MISREAD_FLAT_TEXT, method: 'text_layer' }));
  mockSandboxReturning(PDFPLUMBER_RECONSTRUCTED_TEXT);
  const [countResult, sumResult, compareResult] = await Promise.all([
    analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY),
    analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: '(\\d+)' }, operation: 'sum' }, IDENTITY),
    analyzeAttachment({}, {
      attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'compare', comparison: { operator: 'gte', value: 0 },
    }, IDENTITY),
  ]);
  for (const result of [countResult, sumResult, compareResult]) {
    assert.equal(result.status, 'unreliable_extraction');
    assert.equal(result.reason, 'row_integrity_unverified');
    assert.equal(result.total, undefined, 'no aggregate number may be returned over unverified fallback data');
    assert.equal(result.matchedCount, undefined, 'compare must not run over unverified fallback data either');
  }
});

test('Finding #6 (Test 4 — native extraction unaffected): a reliable flat-text extraction never invokes the sandbox, regardless of the flag', async () => {
  for (const flagValue of [false, true]) {
    config.pdfPlumberFallbackEnabled = flagValue;
    mock.method(documentService, 'downloadDocument', async () => ownedChatAttachment());
    mock.method(documentTextExtractionService, 'extractPlainText', async () => ({
      text: '819 25400122 ANBARASAN V\nDoB: 24.04.2008 2 R2023 RA\n3 R2023 RA',
      method: 'text_layer',
    }));
    const executeCodeMock = mockSandboxReturning('irrelevant');
    // eslint-disable-next-line no-await-in-loop
    const result = await analyzeAttachment({}, { attachmentId: ATTACHMENT_ID, filter: { pattern: 'RA' }, operation: 'count' }, IDENTITY);
    assert.equal(executeCodeMock.mock.callCount(), 0, `flag=${flagValue}: native extraction must never reach for the sandbox`);
    assert.equal(result.status, 'ok');
    assert.equal(result.fallbackUsed, false);
    mock.restoreAll();
    // eslint-disable-next-line no-await-in-loop
    mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
  }
});
