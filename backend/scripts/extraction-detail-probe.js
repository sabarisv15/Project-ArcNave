'use strict';

// Follow-up to extraction-coverage-probe.js — two specific things the first
// pass surfaced that need confirming before any spec is written:
//   (1) the exam-fees PDF returns strategy 'sequential_id' with 4 records,
//       but the document has 23 students. A silent false positive is a
//       different (worse) failure than the day book's honest 'none'.
//   (2) the result sheet's section list: 20 entries, but the service's own
//       comment says 10 distinct real sections.
// Read-only. No LLM, no database.

const fs = require('fs');
const path = require('path');
const textExtraction = require('../src/services/documentTextExtractionService');
const tableExtraction = require('../src/services/documentTableExtractionService');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';

async function main() {
  const feesBuf = fs.readFileSync(path.join(DOWNLOADS, 'EXAM FEES ece(sw) III YR 7 SEM.pdf'));
  const fees = await textExtraction.extractPlainText(feesBuf, 'application/pdf');
  const feesTable = tableExtraction.extractRecords(fees.text);

  console.log('=== exam fees PDF ===');
  console.log(`strategy=${feesTable.strategy} records=${feesTable.records.length}`);
  feesTable.records.forEach((r) => {
    console.log(`  key=${r.key} blockChars=${r.block.length}`);
    console.log(`    ${r.block.slice(0, 200).replace(/\n/g, ' / ')}`);
  });

  // How many real students does the flat text actually mention? Count the
  // DoB markers — every genuine student row in this document carries one.
  const dobCount = (fees.text.match(/DoB\s*:/gi) || []).length;
  console.log(`\nDoB markers in flat text (= real students): ${dobCount}`);
  console.log(`records the detector produced               : ${feesTable.records.length}`);

  console.log('\n--- full flat text, first 1200 chars ---');
  console.log(fees.text.slice(0, 1200));

  const resBuf = fs.readFileSync(path.join(DOWNLOADS, '111_cons_result_apr2026.pdf'));
  const res = await textExtraction.extractPlainText(resBuf, 'application/pdf');
  const resTable = tableExtraction.extractRecords(res.text);
  const distinct = [...new Set(resTable.sections.map((s) => s.courseName))];
  console.log('\n=== consolidated result sheet ===');
  console.log(`records=${resTable.records.length} sectionEntries=${resTable.sections.length} distinctNames=${distinct.length}`);
  distinct.forEach((n) => console.log(`  ${n.slice(0, 90)}`));
}

main().catch((err) => { console.error(err); process.exit(1); });
