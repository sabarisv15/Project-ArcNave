'use strict';

// Read-only live check for ADL-056 — an uncompilable LLM-supplied pattern
// must fail the TOOL, not the TURN. Runs the real deterministic analysis
// path over the real consolidated result sheet, stubbing only the
// ownership-checked byte download (documentService.downloadDocument), so
// extraction, record detection, section detection and aggregation are all
// genuine. Writes nothing, calls no LLM, touches no database.
//
// Three checks, matching the Approved Spec's own "Live check" and
// "Regression" requirements:
//   1. the exact sectionPattern from the live run that produced the 500
//   2. an uncompilable filter.pattern (the other of the two regex params)
//   3. the reference regression — 77 arrears across 21 students

const fs = require('fs');
const path = require('path');

const documentService = require('../src/services/documentService');
const documentAnalysisService = require('../src/services/documentAnalysisService');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';
const RESULT_SHEET = path.join(DOWNLOADS, '111_cons_result_apr2026.pdf');

const ATTACHMENT_ID = '7768852f-e9e6-4a18-a6ea-e9c9137a89fe';
const IDENTITY = { userId: 'u1', collegeId: 'college-a', role: 'principal' };

// The pattern the model actually supplied on the live run recorded in the
// ADL-055 addendum — a Python inline flag JS RegExp rejects.
const LIVE_BAD_SECTION_PATTERN = '(?i)ELECTRONICS AND COMMUNICATION ENGINEERING \\(SANDWICH\\)|2040';

async function main() {
  if (!fs.existsSync(RESULT_SHEET)) {
    console.error(`Missing ${RESULT_SHEET} — this document is deliberately not in git (real student PII).`);
    process.exit(2);
  }
  const buffer = fs.readFileSync(RESULT_SHEET);
  documentService.downloadDocument = async () => ({
    document: {
      id: ATTACHMENT_ID,
      doc_type: documentService.CHAT_ATTACHMENT_DOC_TYPE,
      uploaded_by_user_id: IDENTITY.userId,
      mime_type: 'application/pdf',
    },
    buffer,
  });

  const run = (params) =>
    documentAnalysisService.analyzeAttachment(
      {},
      {
        attachmentId: ATTACHMENT_ID,
        ...params,
      },
      IDENTITY,
    );

  let failures = 0;
  const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (detail) console.log(`      ${detail}`);
    if (!ok) failures += 1;
  };

  // 1 — the measured case. Before this slice it threw out of the turn.
  let sectionResult;
  try {
    sectionResult = await run({
      filter: { pattern: 'RA' },
      operation: 'count',
      sectionPattern: LIVE_BAD_SECTION_PATTERN,
    });
  } catch (err) {
    check('uncompilable sectionPattern does not throw', false, `threw ${err.name}: ${err.message}`);
    sectionResult = null;
  }
  if (sectionResult) {
    check(
      'uncompilable sectionPattern returns invalid_pattern naming sectionPattern',
      sectionResult.status === 'invalid_pattern' && sectionResult.parameter === 'sectionPattern',
      JSON.stringify(sectionResult),
    );
  }

  // 2 — the other regex parameter, with its own distinct remedy.
  const filterResult = await run({ filter: { pattern: '(?i)RA' }, operation: 'count' });
  check(
    'uncompilable filter.pattern returns invalid_pattern naming filter.pattern',
    filterResult.status === 'invalid_pattern' && filterResult.parameter === 'filter.pattern',
    JSON.stringify(filterResult),
  );
  check(
    'the two messages differ — filter.pattern is described as case-SENSITIVE',
    /case-sensitively by design/.test(filterResult.reason || ''),
    filterResult.reason,
  );

  // 3 — the reference regression: a VALID sectionPattern still scopes
  // correctly. 77 arrears across 21 students, unchanged since ADL-055.
  const reference = await run({
    filter: { pattern: 'RA', mode: 'include' },
    operation: 'count',
    sectionPattern: 'SANDWICH',
  });
  check(
    'reference regression: 77 arrears across 21 students',
    reference.status === 'ok' && reference.total === 77 && reference.matchedCount === 21,
    `status=${reference.status} total=${reference.total} matchedCount=${reference.matchedCount} scopedCount=${reference.scopedCount}`,
  );

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
