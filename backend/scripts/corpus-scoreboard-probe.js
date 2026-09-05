'use strict';

// "Can ARCNAVE read ANY document correctly, or only the ones it was built
// for?" — runs every available real document through the same deterministic
// path analyze_document_table uses, and reports what each one returns.
// Read-only: no LLM, no database, writes nothing.

const fs = require('fs');
const path = require('path');

const textExtraction = require('../src/services/documentTextExtractionService');
const tableExtraction = require('../src/services/documentTableExtractionService');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';

const MIME = {
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.xlsx': textExtraction.XLSX_MIME_TYPE,
  '.docx': textExtraction.DOCX_MIME_TYPE,
};

const FILES = [
  // known-good families (the ones slices were actually built against)
  ['result sheet (ADL-055 reference)', '111_cons_result_apr2026.pdf'],
  ['Tally day book (ADL-057 reference)', 'APRDAYBOOK.pdf'],
  // exam fees family — the one ADL-055 slice 1 made refuse honestly
  ['exam fees 7 SEM', 'EXAM FEES ece(sw) III YR 7 SEM.pdf'],
  ['exam fees 3 SEM', 'EXAM FEES ece(sw) III YR 3 SEM.pdf'],
  ['exam fees 5 SEM', 'EXAM FEES ECE (sw) III YR 5 SEM.pdf'],
  ['exam fees V SEM (full time)', 'EXAM FEES ECE(III YEAR) V SEM .pdf'],
  // finance / GST family — never tested against
  ['dealer statement (this thread)', 'TN02T0478 (STATEMENT).pdf'],
  ['GSTR-1 return', 'GSTR1_33BWXPS2201K1Z7_042025.pdf'],
  ['ITC available report', 'ITC_Available_33BWXPS2201K1Z7_Apr25-Mar26.pdf'],
  ['GSTR-2B (xlsx)', '042025_33BWXPS2201K1Z7_GSTR2B_16082026.xlsx'],
  ['GSTR-2B (xlsx, other GSTIN)', '042025_33AASFA1375J1ZA_GSTR2B_16082026.xlsx'],
  ['GST inward supplies (csv)', 'MyReport_Taxable_inward_supplies_received_from_registered_persons.csv'],
  // ARCNAVE's own exports — the format the delimited strategy was built for
  ['ARCNAVE attendance export (csv)', 'attendance-report_data-structures_monthly_2026-08-13.csv'],
  ['ARCNAVE student export (csv)', 'student_export_1784786614965.csv'],
  // non-tabular controls — these SHOULD come back unrecognized
  ['prose docx', 'Microcontrollers - Complete Technical Overview.docx'],
  ['prose pdf', 'Microcontrollers - Complete Technical Overview.pdf'],
  ['resume pdf', 'Preethi_Devaraj_Resume (1).pdf'],
  ['textbook pdf', 'Heat transfer AMR.pdf'],
  ['deficiency report pdf', 'Deficiency Report 2026-27.PDF'],
];

// The tell for the bug found on the statement: strategy 'delimited' chosen
// because a handful of stray lines happen to contain the marker, rather than
// because the document is genuinely delimited.
function delimitedShare(text) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return 0;
  const withMarker = lines.filter((l) => l.includes(' | ') || l.includes('\t')).length;
  return withMarker / lines.length;
}

function verdict(strategy, records, coverage, share) {
  if (strategy === 'none') return 'REFUSES (unrecognized_layout)';
  if (coverage && coverage.applicable && !coverage.reliable) return 'REFUSES (unreliable_extraction)';
  if (strategy === 'delimited' && share < 0.5)
    return `*** SILENT FALSE POSITIVE — ${(share * 100).toFixed(1)}% of lines are delimited ***`;
  return 'answers';
}

async function main() {
  console.log('Document                          fmt    chars   strategy       recs  coverage        verdict');
  console.log('-'.repeat(118));
  for (const [label, fileName] of FILES) {
    const full = path.join(DOWNLOADS, fileName);
    if (!fs.existsSync(full)) {
      console.log(`${label.padEnd(33)} SKIPPED — not found`);
      continue;
    }
    const ext = path.extname(fileName).toLowerCase();
    const mime = MIME[ext];
    let out;
    try {
      out = await textExtraction.extractPlainText(fs.readFileSync(full), mime);
    } catch (err) {
      console.log(`${label.padEnd(33)} ${ext.slice(1).padEnd(5)} THREW: ${err.message}`);
      continue;
    }
    if (!out.text) {
      console.log(`${label.padEnd(33)} ${ext.slice(1).padEnd(5)} extraction_failed (${out.failureReason})`);
      continue;
    }
    const share = delimitedShare(out.text);
    const r = tableExtraction.extractRecords(out.text);
    const cov = r.coverage
      ? r.coverage.applicable
        ? `${r.coverage.accountedCount}/${r.coverage.markerCount}`
        : 'n/a'
      : 'none';
    console.log(
      `${label.padEnd(33)} ${ext.slice(1).padEnd(5)} ${String(out.text.length).padStart(7)}  ` +
        `${r.strategy.padEnd(14)} ${String(r.records.length).padStart(5)}  ${cov.padEnd(15)} ` +
        verdict(r.strategy, r.records, r.coverage, share),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
