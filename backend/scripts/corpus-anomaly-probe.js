'use strict';

// Two anomalies from the scoreboard, looked at closely:
//   1. a PROSE .docx that returns 11 "table records"
//   2. a real GST .csv that returns strategy 'none'
// Read-only: no LLM, no database, writes nothing.

const fs = require('fs');
const path = require('path');

const textExtraction = require('../src/services/documentTextExtractionService');
const tableExtraction = require('../src/services/documentTableExtractionService');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';

async function look(label, fileName, mime) {
  const out = await textExtraction.extractPlainText(fs.readFileSync(path.join(DOWNLOADS, fileName)), mime);
  const r = tableExtraction.extractRecords(out.text);
  console.log(`\n### ${label}`);
  console.log(`  strategy: ${r.strategy}  records: ${r.records.length}`);
  console.log('  first 5 records ARCNAVE would hand the model as table rows:');
  r.records.slice(0, 5).forEach((rec, i) => {
    console.log(`   ${i}`, JSON.stringify(rec.cells || rec.block).slice(0, 200));
  });
  return out.text;
}

async function main() {
  await look('PROSE DOCX', 'Microcontrollers - Complete Technical Overview.docx',
    textExtraction.DOCX_MIME_TYPE);

  const csvText = await look('REAL GST CSV', 'MyReport_Taxable_inward_supplies_received_from_registered_persons.csv',
    'text/csv');
  console.log('\n  why "none"? first 6 lines of the extracted text:');
  csvText.split('\n').slice(0, 6).forEach((l, i) => console.log(`   ${i}`, JSON.stringify(l).slice(0, 190)));
}

main().catch((err) => { console.error(err); process.exit(1); });
