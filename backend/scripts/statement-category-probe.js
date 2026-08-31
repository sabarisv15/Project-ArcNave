'use strict';

// Read-only measurement probe: what does ARCNAVE's deterministic document
// path actually return for a real bank/ledger STATEMENT PDF whose question
// is "per-category, per-month debit and credit totals"?
// Writes nothing, calls no LLM, touches no database.

const fs = require('fs');
const path = require('path');

const textExtraction = require('../src/services/documentTextExtractionService');
const tableExtraction = require('../src/services/documentTableExtractionService');

const FILE = process.argv[2] || path.join('C:\\Users\\HAI\\Downloads', 'TN02T0478 (STATEMENT).pdf');

async function main() {
  const buffer = fs.readFileSync(FILE);
  const out = await textExtraction.extractPlainText(buffer, 'application/pdf');
  console.log('=== STEP 1: documentTextExtractionService.extractPlainText');
  console.log('  method       :', out.method || '-');
  console.log('  failureReason:', out.failureReason || '-');
  console.log('  textChars    :', out.text ? out.text.length : 0);
  if (!out.text) return;

  const lines = out.text.split('\n');
  console.log('  lines        :', lines.length);
  console.log('  lines w/ tab :', lines.filter((l) => l.includes('\t')).length);
  console.log('  lines w/ " | ":', lines.filter((l) => l.includes(' | ')).length);

  console.log('\n--- first 40 non-empty lines (tabs shown as <TAB>) ---');
  lines
    .filter((l) => l.trim() !== '')
    .slice(0, 40)
    .forEach((l, i) => console.log(String(i).padStart(3), JSON.stringify(l).slice(0, 220)));

  console.log('\n=== STEP 2: documentTableExtractionService.extractRecords');
  const result = tableExtraction.extractRecords(out.text);
  console.log('  strategy :', result.strategy);
  console.log('  records  :', result.records.length);
  console.log('  sections :', result.sections.length);
  console.log('  coverage :', JSON.stringify(result.coverage));

  if (result.records.length > 0) {
    const counts = new Map();
    result.records.forEach((r) => {
      const n = r.cells ? r.cells.length : -1;
      counts.set(n, (counts.get(n) || 0) + 1);
    });
    console.log(
      '  cell-count distribution:',
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([n, c]) => `${n} cells x${c}`)
        .join(', '),
    );
    console.log('\n--- first 12 records as ARCNAVE sees them ---');
    result.records.slice(0, 12).forEach((r, i) => {
      console.log(String(i).padStart(3), JSON.stringify(r.cells || r.block).slice(0, 260));
    });
  }

  fs.writeFileSync(path.join(__dirname, 'statement-extracted.txt'), out.text, 'utf8');
  console.log('\n(raw text written to scripts/statement-extracted.txt for inspection)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
