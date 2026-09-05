'use strict';

// ADL-057 live check — "which day-book entries are below ₹5000?", the
// question that was inexpressible before operation 'compare'.
//
// Runs the real deterministic analysis path over the real Tally day book,
// stubbing only the ownership-checked byte download, so extraction, the
// delimited detector and the comparison itself are all genuine. Writes
// nothing, calls no LLM, touches no database.
//
// Run (from backend/):
//   set -a && . ./.env.local.sh && set +a && node scripts/numeric-comparison-probe.js

const fs = require('fs');
const path = require('path');

const documentService = require('../src/services/documentService');
const documentAnalysisService = require('../src/services/documentAnalysisService');
const documentTextExtractionService = require('../src/services/documentTextExtractionService');
const documentTableExtractionService = require('../src/services/documentTableExtractionService');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';
const DAYBOOK = path.join(DOWNLOADS, 'APRDAYBOOK.pdf');
const RESULT_SHEET = path.join(DOWNLOADS, '111_cons_result_apr2026.pdf');

const ATTACHMENT_ID = '7768852f-e9e6-4a18-a6ea-e9c9137a89fe';
const IDENTITY = { userId: 'u1', collegeId: 'college-a', role: 'principal' };

// Anchored on the digits, not on ₹: compilePattern wraps every filter
// pattern as \b(?:...)\b, so a pattern starting with a non-word character
// can never match. Pinned by its own unit test.
const AMOUNT = '([\\d,]+\\.\\d{2})';
// Anchored between the date and the amount. Two earlier versions of this
// pattern were wrong in instructive ways, both kept in the comment because
// an implementer will hit the same two:
//   - "the first capitalised word" returned "Apr" for every row (from
//     "1-Apr-25") and still looked like a pass, because a non-null identity
//     is not the same as a USEFUL one. Hence the distinctness check below.
//   - anchoring on \s{2,} matched the raw PDF line but not what the matcher
//     actually sees: splitOn TRIMS each cell and recordText joins them with
//     a single space, so multi-space runs do not exist by the time a
//     pattern is applied.
const PARTY = '-\\d{2}\\s+(.+?)\\s+[\\d,]+\\.\\d{2}';

function useDocument(file) {
  const buffer = fs.readFileSync(file);
  documentService.downloadDocument = async () => ({
    document: {
      id: ATTACHMENT_ID,
      doc_type: documentService.CHAT_ATTACHMENT_DOC_TYPE,
      uploaded_by_user_id: IDENTITY.userId,
      mime_type: 'application/pdf',
    },
    buffer,
  });
  return buffer;
}

const run = (params) =>
  documentAnalysisService.analyzeAttachment(
    {},
    {
      attachmentId: ATTACHMENT_ID,
      ...params,
    },
    IDENTITY,
  );

async function main() {
  for (const file of [DAYBOOK, RESULT_SHEET]) {
    if (!fs.existsSync(file)) {
      console.error(`Missing ${file} — deliberately not in git (real PII).`);
      process.exit(2);
    }
  }

  let failures = 0;
  const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (detail) console.log(`      ${detail}`);
    if (!ok) failures += 1;
  };

  const buffer = useDocument(DAYBOOK);
  const extraction = await documentTextExtractionService.extractPlainText(buffer, 'application/pdf');
  // Printed as the MATCHER sees them (cells trimmed, joined with a single
  // space), not as raw PDF lines — the difference is what made an earlier
  // identityPattern silently match nothing.
  const { records } = documentTableExtractionService.extractRecords(extraction.text);
  console.log('Day book rows, as the matcher sees them:');
  records.slice(2, 6).forEach((r) => console.log(`      ${JSON.stringify(r.cells.join(' ').slice(0, 100))}`));
  console.log('');

  // 1 — the refusal that makes the list worth having. Without an
  // identityPattern a delimited source would return anonymous rows.
  const anonymous = await run({
    filter: { pattern: AMOUNT },
    operation: 'compare',
    comparison: { operator: 'lt', value: 5000 },
  });
  check(
    'no identityPattern on a delimited source -> identity_required, not a list of nulls',
    anonymous.status === 'identity_required',
    JSON.stringify(anonymous),
  );

  // 2 — the real question.
  const below = await run({
    filter: { pattern: AMOUNT },
    operation: 'compare',
    comparison: { operator: 'lt', value: 5000 },
    identityPattern: PARTY,
  });
  check('entries below 5000 returns status ok', below.status === 'ok', `strategy=${below.strategy}`);
  if (below.status === 'ok') {
    console.log(`      matched=${below.matchedCount} of scoped=${below.scopedCount}, total=${below.total}`);
    console.log(
      `      unmatched=${below.unmatchedRows} nonNumeric=${below.nonNumericRows} multiMatch=${below.multiMatchRows} withoutIdentity=${below.rowsWithoutIdentity}`,
    );
    check(
      'every returned row carries a value',
      below.sample.every((r) => typeof r.value === 'number'),
    );
    const identified = below.sample.filter((r) => r.identity);
    const distinct = new Set(identified.map((r) => r.identity));
    check(
      'every returned row is named',
      identified.length === below.sample.length,
      `${identified.length}/${below.sample.length} rows named`,
    );
    // A non-null identity is not the same as a useful one: an earlier run
    // of this probe returned "Apr" for all 100 rows and passed the naive
    // "is it non-null" check.
    //
    // The bar is deliberately > 1, not a percentage. A first attempt used
    // "more than a quarter of the rows" and failed on legitimate data —
    // 21 distinct parties across 100 day-book rows is normal, because a
    // real ledger bills the same supplier repeatedly. This check catches
    // the degenerate constant, which is the actual failure mode; judging
    // whether the names are GOOD is a human's job, so they are printed.
    check(
      'the names are actually distinguishing, not one constant repeated',
      distinct.size > 1,
      `${distinct.size} distinct names across ${below.sample.length} rows`,
    );
    check(
      'every returned value really is below the threshold',
      below.sample.every((r) => r.value < 5000),
    );
    console.log('      first 5 rows:');
    below.sample.slice(0, 5).forEach((r) => console.log(`        ${JSON.stringify(r.identity)} -> ${r.value}`));
  }

  // 3 — the other end, to show the operator is real and not a filter that
  // happens to pass everything.
  const above = await run({
    filter: { pattern: AMOUNT },
    operation: 'compare',
    comparison: { operator: 'gte', value: 5000 },
    identityPattern: PARTY,
  });
  if (below.status === 'ok' && above.status === 'ok') {
    check(
      'lt and gte partition the same numeric rows exactly',
      below.matchedCount + above.matchedCount === below.scopedCount - below.unmatchedRows - below.nonNumericRows,
      `${below.matchedCount} + ${above.matchedCount} vs ${below.scopedCount - below.unmatchedRows - below.nonNumericRows} numeric rows`,
    );
  }

  // 4 — the reference regression, on the other document. Nothing about
  // count/sum/breakdown may have shifted.
  useDocument(RESULT_SHEET);
  const reference = await run({
    filter: { pattern: 'RA', mode: 'include' },
    operation: 'count',
    sectionPattern: 'SANDWICH',
  });
  check(
    'reference regression: 77 arrears across 21 students',
    reference.status === 'ok' && reference.total === 77 && reference.matchedCount === 21,
    `status=${reference.status} total=${reference.total} matchedCount=${reference.matchedCount}`,
  );

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
