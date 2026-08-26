'use strict';

// Item 1 slice 2 pass — the decisive measurement.
//
// The strategy probe showed that geometry + a space separator keeps the
// result sheet on sequential_id with identical record/coverage counts, and
// lifts the exam-fees PDF from 4 UNRELIABLE records to 23 RELIABLE ones.
//
// Two things that must be checked before anyone builds on that:
//
//   1. REGRESSION — does the verified reference answer (77 arrears across
//      21 students in the ECE Sandwich section) survive geometry? The
//      record COUNT matching is not the same as the record TEXT matching;
//      geometry produces 22% more characters.
//
//   2. THE TRAP — coverage is a ROW-accounting check. Geometry fixes rows.
//      It does NOT fix COLUMN attribution: on the exam-fees PDF the
//      per-student figures print ABOVE their student inside a merged cell.
//      So coverage would report "reliable" for a document whose numbers
//      are attached to the wrong student — re-creating ADL-055's
//      silently-wrong-answer defect in a new place. This prints the actual
//      record blocks so that can be seen rather than argued about.
//
// Read-only, no LLM, no database.

const fs = require('fs');
const path = require('path');
const documentTextExtractionService = require('../src/services/documentTextExtractionService');
const documentTableExtractionService = require('../src/services/documentTableExtractionService');
const documentAggregateService = require('../src/services/documentAggregateService');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';
const Y_TOLERANCE = 3;

async function geometryText(buffer, separator = ' ') {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    // eslint-disable-next-line no-await-in-loop
    const content = await (await doc.getPage(p)).getTextContent();
    const items = content.items
      .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
      .map((it) => ({ x: it.transform[4], y: it.transform[5], str: it.str.trim() }));
    const buckets = [];
    items.forEach((it) => {
      const bucket = buckets.find((b) => Math.abs(b.y - it.y) <= Y_TOLERANCE);
      if (bucket) bucket.items.push(it);
      else buckets.push({ y: it.y, items: [it] });
    });
    buckets.sort((a, b) => b.y - a.y)
      .forEach((b) => lines.push(b.items.sort((p1, q) => p1.x - q.x).map((it) => it.str).join(separator)));
  }
  return lines.join('\n');
}

// The same scoping documentAnalysisService performs, replicated here so the
// probe measures the real answer rather than a proxy for it.
function referenceAnswer(text) {
  const { strategy, records, sections } = documentTableExtractionService.extractRecords(text);
  const re = new RegExp('SANDWICH', 'i');
  const matching = new Set(sections.filter((s) => re.test(s.courseName)).map((s) => s.startLine));
  const scoped = records.filter((record) => {
    let active = null;
    for (const section of sections) {
      if (section.startLine <= record.startLine) active = section; else break;
    }
    return active !== null && matching.has(active.startLine);
  });
  if (scoped.length === 0) return { strategy, sections: sections.length, total: 0, matchedCount: 0 };
  const rows = documentAggregateService.aggregate(scoped, { filter: { pattern: 'RA', mode: 'include' }, operation: 'count' });
  const s = documentAggregateService.summarize(rows);
  return {
    strategy, sections: sections.length, total: s.total, matchedCount: s.matchedCount,
  };
}

async function main() {
  console.log('=== 1. REGRESSION — the verified reference answer under geometry ===\n');
  const sheet = fs.readFileSync(path.join(DOWNLOADS, '111_cons_result_apr2026.pdf'));
  const flatSheet = await documentTextExtractionService.extractPlainText(sheet, 'application/pdf');
  const geomSheet = await geometryText(sheet, ' ');
  const flatAnswer = referenceAnswer(flatSheet.text);
  const geomAnswer = referenceAnswer(geomSheet);
  console.log('  today (flat text):', JSON.stringify(flatAnswer));
  console.log('  geometry (space) :', JSON.stringify(geomAnswer));
  const same = flatAnswer.total === geomAnswer.total && flatAnswer.matchedCount === geomAnswer.matchedCount;
  console.log(`  -> ${same ? 'IDENTICAL — no regression' : 'DIFFERENT — this is a regression'}`);
  console.log(`  (expected 77 arrears / 21 students; sections detected: flat ${flatAnswer.sections}, geometry ${geomAnswer.sections})`);

  console.log('\n=== 2. THE TRAP — coverage says "reliable" but the columns are misattributed ===\n');
  const fees = fs.readFileSync(path.join(DOWNLOADS, 'EXAM FEES ece(sw) III YR 7 SEM.pdf'));
  const geomFees = await geometryText(fees, ' ');
  const parsed = documentTableExtractionService.extractRecords(geomFees);
  console.log(`  strategy=${parsed.strategy} records=${parsed.records.length} coverage=${JSON.stringify(parsed.coverage)}\n`);
  parsed.records.slice(1, 5).forEach((r) => {
    console.log(`  --- serial ${r.serialNo} (${r.regNo}) ---`);
    r.block.split('\n').forEach((l) => console.log(`      ${l.slice(0, 100)}`));
  });

  // What a numeric operation would produce over those records, if the
  // coverage check let it through.
  const fee = documentAggregateService.aggregate(parsed.records, {
    operation: 'sum', filter: { pattern: '(\\d{3})$' },
  });
  console.log('\n  per-record "sum of a trailing 3-digit number" (i.e. the fee column):');
  fee.slice(0, 6).forEach((r) => console.log(`      serial ${r.serialNo}: ${r.sum}`));
}

main().catch((err) => { console.error(err); process.exit(1); });
