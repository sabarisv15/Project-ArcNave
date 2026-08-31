'use strict';

// MEASUREMENT for Review Finding #3's still-open half: "add a cheap
// column-sanity check (verify each row's numeric fields are internally
// consistent per the document's own printed arithmetic, GENERALIZED rather
// than hand-fit) before granting count/sum/compare access."
//
// documentAnalysisService.js currently caps every pdfplumber-reconstructed
// table at `unreliable_extraction` / row_integrity_unverified — Finding #3
// was fixed by choosing partial trust over no check at all, not by building
// the check. This probe asks: can a GENERIC algorithm (no hardcoded
// "fees = arrears * 65" formula, no column-name knowledge) discover, purely
// from the record blocks documentTableExtractionService already produces,
// that this document's numeric columns are internally consistent — without
// being told what the columns mean?
//
// Method: run the REAL production reconstruction (same sandbox script
// documentAnalysisService.reconstructViaPdfplumber uses, copied here since
// it isn't exported) against the real exam-fees PDF, feed the result through
// the REAL documentTableExtractionService.extractRecords, then run a blind
// relation-discovery pass over each record's own block text:
//   1. Strip the parts of the block already known to be non-value
//      (serialNo, regNo, a DoB-shaped substring) — these are structurally
//      known already, not guessed per-document.
//   2. Extract every remaining standalone number, in order.
//   3. Keep only records whose count of remaining numbers matches the modal
//      count (a record with a different count already failed a much
//      simpler check and should not be used to validate this one).
//   4. Brute-force every 2-term (b = a*k) and 3-term (c = a+b, c = a-b)
//      relation among those positions; report any relation that holds
//      EXACTLY on every modal-length row.
//
// PASS/FAIL named in advance: PASS means at least one relation is found
// holding on all modal-length rows with zero violations — real evidence a
// generic check is viable on this document family, not just the
// hand-picked one the original pdfplumber-attribution-probe.js used. FAIL
// means the generic version cannot recover what the hand-fit version found,
// which is itself the finding — this would mean generalizing to a real
// production check needs a different technique, not that finding #3's
// remaining half should be built on this approach anyway.
//
// Read-only: one sandbox call, no database, nothing written anywhere.
//
// Run (from backend/):
//   set -a && . ./.env.local.sh && set +a && node scripts/row-arithmetic-consistency-probe.js

const fs = require('fs');
const path = require('path');
const documentTableExtractionService = require('../src/services/documentTableExtractionService');
const documentRowIntegrityService = require('../src/services/documentRowIntegrityService');
const sandboxExecutionService = require('../src/services/sandboxExecutionService');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';
const SAMPLE = path.join(DOWNLOADS, 'EXAM FEES ece(sw) III YR 7 SEM.pdf');

// Copied verbatim from documentAnalysisService.js's PDFPLUMBER_RECONSTRUCT_SCRIPT
// (not exported) so this probe measures against the exact bytes production
// would produce, not a hand-tuned variant.
const PDFPLUMBER_RECONSTRUCT_SCRIPT = `
import pdfplumber

with pdfplumber.open("attachment.pdf") as pdf:
    lines = []
    for page in pdf.pages:
        for table in page.extract_tables():
            for row in table:
                cells = [str(cell).strip() for cell in row if cell is not None and str(cell).strip() != '']
                if cells:
                    lines.append(' '.join(cells))
print('\\n'.join(lines))
`.trim();

const DOB_SUBSTRING = /DoB\s*:?\s*[\d/.-]+/gi;
const SEMESTER_MARKER = /\b\d{1,2}\s+R\d{4}\b/gi;
const NUMBER_TOKEN = /-?\d+(?:\.\d+)?/g;

// Strips everything already known to be non-value, then returns the
// remaining numeric tokens in order — never told what a "fee" or "arrears"
// column is, only what an identity/marker column is (the same structural
// knowledge documentTableExtractionService itself already encodes).
function extractValueNumbers(record) {
  let text = record.block;
  if (record.serialNo) text = text.replace(record.serialNo, '');
  if (record.regNo) text = text.replace(record.regNo, '');
  text = text.replace(DOB_SUBSTRING, ' ').replace(SEMESTER_MARKER, ' ');
  const matches = text.match(NUMBER_TOKEN);
  return (matches || []).map(Number);
}

function modalLength(vectors) {
  const counts = new Map();
  vectors.forEach((v) => counts.set(v.length, (counts.get(v.length) || 0) + 1));
  let best = 0;
  let bestFreq = 0;
  counts.forEach((freq, len) => {
    if (freq > bestFreq) {
      bestFreq = freq;
      best = len;
    }
  });
  return best;
}

// Brute-force discovery: 2-term multiplicative (v[j] === v[i] * k, k a
// positive integer discovered from the first row and checked on the rest)
// and 3-term additive (v[k] === v[i] + v[j], any ordered pair) relations.
// Small position counts (single digits) make this cheap; no per-document
// tuning of which positions to try.
function discoverRelations(vectors, len) {
  const found = [];
  for (let i = 0; i < len; i += 1) {
    for (let j = 0; j < len; j += 1) {
      if (i === j) continue;
      const k = vectors[0][i] === 0 ? null : vectors[0][j] / vectors[0][i];
      if (k === null || !Number.isFinite(k) || !Number.isInteger(k) || k === 0) continue;
      const holds = vectors.every((v) => v[j] === v[i] * k);
      if (holds) found.push({ type: 'multiplicative', i, j, k });
    }
  }
  for (let i = 0; i < len; i += 1) {
    for (let j = 0; j < len; j += 1) {
      for (let k = 0; k < len; k += 1) {
        if (i === j || j === k || i === k) continue;
        const holds = vectors.every((v) => v[k] === v[i] + v[j]);
        if (holds)
          found.push({
            type: 'additive',
            i,
            j,
            k,
          });
      }
    }
  }
  return found;
}

async function main() {
  if (!fs.existsSync(SAMPLE)) {
    console.error(`Missing ${SAMPLE} — deliberately not in git (real student PII).`);
    process.exit(2);
  }
  const url = process.env.SANDBOX_SERVICE_URL;
  const token = process.env.SANDBOX_SERVICE_TOKEN;
  if (!url || !token) {
    console.error('SANDBOX_SERVICE_URL / SANDBOX_SERVICE_TOKEN must be set.');
    process.exit(2);
  }

  const buffer = fs.readFileSync(SAMPLE);
  console.log(`${path.basename(SAMPLE)} — ${buffer.length} bytes\n`);

  const result = await sandboxExecutionService.executeCode({
    code: PDFPLUMBER_RECONSTRUCT_SCRIPT,
    files: [{ name: 'attachment.pdf', contentBase64: buffer.toString('base64') }],
  });
  const reconstructed = result.stdout;
  if (!reconstructed) {
    console.error('Sandbox returned no stdout — cannot proceed.');
    process.exit(1);
  }

  const { strategy, records, coverage } = documentTableExtractionService.extractRecords(reconstructed);
  console.log(`strategy: ${strategy}`);
  console.log(`records: ${records.length}`);
  console.log(`coverage: ${JSON.stringify(coverage)}\n`);

  const vectors = records.map(extractValueNumbers);
  vectors.forEach((v, idx) => {
    console.log(`  record ${idx} (serial ${records[idx].serialNo}): [${v.join(', ')}]`);
  });

  const len = modalLength(vectors);
  const modalVectors = vectors.filter((v) => v.length === len);
  const offCount = vectors.length - modalVectors.length;
  console.log(
    `\nmodal numeric-token count: ${len} (${modalVectors.length}/${vectors.length} records match, ${offCount} off-modal)`,
  );

  if (modalVectors.length < 2) {
    console.log('\nVERDICT: FAIL — not enough modal-length rows to test a relation against.');
    process.exit(1);
  }

  const relations = discoverRelations(modalVectors, len);
  console.log(`\nrelations discovered holding on ALL ${modalVectors.length} modal-length rows: ${relations.length}`);
  relations.forEach((r) => {
    if (r.type === 'multiplicative') console.log(`  v[${r.j}] = v[${r.i}] * ${r.k}`);
    else console.log(`  v[${r.k}] = v[${r.i}] + v[${r.j}]`);
  });

  console.log(
    `\nVERDICT: ${relations.length > 0 ? 'PASS' : 'FAIL'} — ${
      relations.length > 0
        ? 'a generic, blind relation-discovery pass recovers real row-level arithmetic consistency on this document.'
        : 'no relation was found; a generic check of this shape does not validate this document.'
    }`,
  );

  console.log('\n--- documentRowIntegrityService.assessRowIntegrity (the actual production module) ---');
  const integrity = documentRowIntegrityService.assessRowIntegrity(records);
  console.log(JSON.stringify(integrity, null, 2));
  console.log(
    `\nPRODUCTION VERDICT: ${integrity.verified ? 'VERIFIED — full trust would be granted' : 'NOT VERIFIED — stays capped at unreliable_extraction'}`,
  );

  process.exit(relations.length > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
