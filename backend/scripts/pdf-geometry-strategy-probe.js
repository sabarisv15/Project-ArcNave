'use strict';

// Item 1 slice 2 pass — the structural question the cost probe surfaced.
//
// Geometric reconstruction naturally emits one line per printed row with
// cells joined. If those lines are joined with ' | ', they hit
// documentTableExtractionService's DELIMITER exactly, so extractRecords
// takes the `delimited` branch instead of `sequential_id`. That branch
// carries NO coverage assessment (coverage: null) and produces key: null
// rows — i.e. feeding geometry through the existing pipeline unchanged
// would move the working reference document off the trust-checked path.
//
// This measures whether that actually happens, for three separators, on
// both real documents. Read-only, no LLM, no database.

const fs = require('fs');
const path = require('path');
const documentTextExtractionService = require('../src/services/documentTextExtractionService');
const documentTableExtractionService = require('../src/services/documentTableExtractionService');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';
const FILES = ['EXAM FEES ece(sw) III YR 7 SEM.pdf', '111_cons_result_apr2026.pdf'];
const Y_TOLERANCE = 3;
const SEPARATORS = { "' | ' (DELIMITER)": ' | ', "tab": '\t', "single space": ' ' };

async function geometryRows(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const rows = [];
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
      .forEach((b) => rows.push(b.items.sort((p1, q) => p1.x - q.x).map((it) => it.str)));
  }
  return rows;
}

function describe(label, text) {
  const r = documentTableExtractionService.extractRecords(text);
  const cov = r.coverage
    ? `${r.coverage.reliable ? 'reliable' : 'UNRELIABLE'} ${r.coverage.accountedCount}/${r.coverage.markerCount}`
    : 'none (no check runs)';
  const anonymous = r.records.filter((rec) => !rec.key).length;
  console.log(
    `  ${label.padEnd(20)} strategy=${String(r.strategy).padEnd(14)} records=${String(r.records.length).padStart(5)}`
    + `  coverage=${cov.padEnd(24)} key:null rows=${anonymous}`,
  );
}

async function main() {
  for (const name of FILES) {
    const file = path.join(DOWNLOADS, name);
    if (!fs.existsSync(file)) { console.log(`${name} — MISSING`); continue; }
    const buffer = fs.readFileSync(file);
    console.log(`\n${name}`);

    const flat = await documentTextExtractionService.extractPlainText(buffer, 'application/pdf');
    describe('TODAY (flat text)', flat.text);

    const rows = await geometryRows(buffer);
    for (const [label, sep] of Object.entries(SEPARATORS)) {
      describe(`geometry, ${label}`, rows.map((cells) => cells.join(sep)).join('\n'));
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
