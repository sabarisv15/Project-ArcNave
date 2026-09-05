'use strict';

// Controlled experiment for a UNIVERSAL alternative to per-document-family
// regex/anchor detectors in documentTableExtractionService.js (delimited,
// sequential_id, and an abandoned date_led_rows attempt — each hand-fit to
// one real sample document; see the 2026-08-26 feedback that triggered
// this probe).
//
// Hypothesis under test: a SINGLE generic prompt — "extract every row as an
// array of cell strings, left to right, no semantic labels" — sent to
// Gemini as a native PDF read, can replace the hand-written per-family
// detector, because its output shape ({ cells: [...] } per row) is EXACTLY
// documentTableExtractionService's own existing record shape. If this
// works, documentAggregateService (already generic — it only ever consumed
// { cells } / { block } records) needs ZERO changes; only the STRUCTURAL
// extraction step becomes model-driven instead of regex-driven, and a new
// document family would need no new code at all.
//
// This does NOT retest identity/attribution (ADL-058's addendum already
// settled that — native reading solves merged-cell attribution 23/23) or
// narration-based counting (already measured to fail: 2 vs 23, 7 vs 839, 16
// vs 1603 — see native-pdf-scale-probe.js). It tests something neither
// prior probe did: whether the SAME generic mechanism, with NO
// document-family knowledge baked into the prompt, correctly structures
// two DIFFERENT synthetic table shapes, at a size larger than the 2-page
// case already proven (23 rows) but far short of the 400-page case already
// proven to fail outright.
//
// Synthetic data only — no real student/financial PII, unlike every other
// probe in this directory. Ground truth is exact because this script wrote
// the numbers itself.
//
// Makes real, billable Vertex calls. Read-only, no database.
//
// Run (from backend/):
//   set -a && . ./.env.local.sh && set +a && node scripts/universal-extraction-probe.js

const PDFDocument = require('pdfkit');
const { GoogleAuth } = require('google-auth-library');
const config = require('../src/config');

const GENERIC_PROMPT =
  'This document contains a table. Extract EVERY row as a JSON array of arrays — ' +
  'one inner array per row, each element the exact text of one cell/column on that row, left to right, ' +
  'in reading order. Do not merge rows together. Do not skip any row, even if the table spans multiple ' +
  'pages. Do not interpret or label the columns — return the raw cell text only. ' +
  'Return ONLY the JSON array, no prose, no markdown fence.';

async function accessToken() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const { token } = await (await auth.getClient()).getAccessToken();
  return token;
}

function modelUrl() {
  const loc = config.gemini.location || 'global';
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  const model = config.gemini.model || 'gemini-3.7-flash';
  return `https://${host}/v1/projects/${config.gemini.projectId}/locations/${loc}/publishers/google/models/${model}:generateContent`;
}

async function askGemini(token, base64) {
  const t0 = Date.now();
  const res = await fetch(modelUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ inline_data: { mime_type: 'application/pdf', data: base64 } }, { text: GENERIC_PROMPT }],
        },
      ],
      generationConfig: { temperature: 0.4, maxOutputTokens: 16384 },
    }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) return { rows: null, raw: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, ms, inTok: '-' };
  const payload = await res.json();
  const inTok = (payload.usageMetadata || {}).promptTokenCount || '-';
  const finish = ((payload.candidates || [])[0] || {}).finishReason || '?';
  const text = (payload.candidates || [])
    .flatMap((c) => (c.content && c.content.parts) || [])
    .map((p) => p.text || '')
    .join('');
  const cleaned = text
    .replace(/^```(?:json)?/m, '')
    .replace(/```\s*$/m, '')
    .trim();
  try {
    return { rows: JSON.parse(cleaned), raw: text, ms, inTok, finish };
  } catch {
    return { rows: null, raw: text, ms, inTok, finish };
  }
}

// ---------------------------------------------------------------------------
// Shape A: a delimited-style roster (like a fee/attendance list) —
// SerialNo, RegNo, Name, Marks. Single page, single-space-joined rows, the
// same layout style already proven to defeat generic space-based splitting
// (this is deliberately NOT the date_led_rows shape).

function buildRosterPdf(rowCount) {
  const rows = [];
  let total = 0;
  for (let i = 1; i <= rowCount; i += 1) {
    const regNo = 20250000 + i;
    const marks = 40 + ((i * 7) % 60); // deterministic, not random — reproducible ground truth
    total += marks;
    rows.push({ serial: i, regNo, name: `STUDENT ${i}`, marks });
  }
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', resolve));
  doc.fontSize(10);
  doc.text('SERIAL   REGNO       NAME              MARKS');
  doc.moveDown(0.5);
  rows.forEach((r) => {
    doc.text(`${r.serial}  ${r.regNo}  ${r.name}  ${r.marks}`);
  });
  doc.end();
  return done.then(() => ({ buffer: Buffer.concat(chunks), rows, total }));
}

// ---------------------------------------------------------------------------
// Shape B: a date-led multi-page ledger — Date, Type, Description,
// Debit, Credit. Deliberately a DIFFERENT shape from Shape A (no serial/
// regNo, dated rows, two money columns instead of one), spread across
// several real page breaks, to test both shape-agnosticism (same prompt)
// and a size step up from the already-proven 2-page/23-row case.

function buildLedgerPdf(rowsPerPage, pageCount) {
  const types = ['PLB', 'MQD', 'SQD', 'SD'];
  const rows = [];
  let debitTotal = 0;
  let creditTotal = 0;
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', resolve));
  doc.fontSize(9);
  let n = 0;
  for (let p = 0; p < pageCount; p += 1) {
    if (p > 0) doc.addPage();
    doc.text(`LEDGER STATEMENT — PAGE ${p + 1}`);
    doc.moveDown(0.5);
    for (let r = 0; r < rowsPerPage; r += 1) {
      n += 1;
      const day = 1 + (n % 28);
      const month = 1 + (Math.floor(n / 28) % 12);
      const date = `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.2025`;
      const type = types[n % types.length];
      const isDebit = n % 3 === 0;
      const amount = 1000 + ((n * 37) % 9000);
      const debit = isDebit ? amount : 0;
      const credit = isDebit ? 0 : amount;
      debitTotal += debit;
      creditTotal += credit;
      rows.push({
        n,
        date,
        type,
        desc: `TRANSACTION FOR ROW ${n}`,
        debit,
        credit,
      });
      doc.text(`${date} ${type} TRANSACTION FOR ROW ${n} ${debit}.00 ${credit}.00`);
    }
  }
  doc.end();
  return done.then(() => ({
    buffer: Buffer.concat(chunks),
    rows,
    debitTotal,
    creditTotal,
  }));
}

async function main() {
  const token = await accessToken();
  console.log(`model: ${config.gemini.model || 'gemini-3.7-flash'}  project: ${config.gemini.projectId}\n`);

  // --- Shape A: roster, 60 rows, 1 page -----------------------------------
  console.log('=== Shape A: delimited-style roster, 60 rows, 1 page ===');
  const a = await buildRosterPdf(60);
  console.log(`ground truth: 60 rows, MARKS total = ${a.total}`);
  const aResult = await askGemini(token, a.buffer.toString('base64'));
  console.log(`  latency ${aResult.ms}ms  inTok ${aResult.inTok}  finish ${aResult.finish || '-'}`);
  if (!Array.isArray(aResult.rows)) {
    console.log(`  UNPARSEABLE: ${aResult.raw.slice(0, 300)}`);
  } else {
    console.log(`  rows returned: ${aResult.rows.length}`);
    console.log(`  sample row 0 : ${JSON.stringify(aResult.rows[0])}`);
    // MARKS is the last cell on every row in this synthetic layout.
    const marksTotal = aResult.rows.reduce((s, cells) => {
      const last = Array.isArray(cells) ? cells[cells.length - 1] : null;
      const n = Number(String(last).replace(/,/g, ''));
      return Number.isFinite(n) ? s + n : s;
    }, 0);
    console.log(
      `  MARKS total, summed by column index over the model's own cells (the shape ` +
        `documentAggregateService already consumes unchanged): ${marksTotal}` +
        ` (ground truth ${a.total}, ${marksTotal === a.total ? 'MATCH' : 'MISMATCH'})`,
    );
  }

  // --- Shape B: ledger, 15 rows/page x 6 pages = 90 rows ------------------
  console.log('\n=== Shape B: date-led ledger, 90 rows across 6 pages ===');
  const b = await buildLedgerPdf(15, 6);
  console.log(`ground truth: ${b.rows.length} rows, DEBIT total = ${b.debitTotal}, CREDIT total = ${b.creditTotal}`);
  const bResult = await askGemini(token, b.buffer.toString('base64'));
  console.log(`  latency ${bResult.ms}ms  inTok ${bResult.inTok}  finish ${bResult.finish || '-'}`);
  if (!Array.isArray(bResult.rows)) {
    console.log(`  UNPARSEABLE: ${bResult.raw.slice(0, 300)}`);
  } else {
    console.log(`  rows returned: ${bResult.rows.length} (expected ${b.rows.length})`);
    console.log(`  sample row 0 : ${JSON.stringify(bResult.rows[0])}`);
    console.log(`  sample row last: ${JSON.stringify(bResult.rows[bResult.rows.length - 1])}`);
    // debit/credit are the last two cells on every row in this synthetic layout.
    let debitTotal = 0;
    let creditTotal = 0;
    bResult.rows.forEach((cells) => {
      if (!Array.isArray(cells) || cells.length < 2) return;
      const debit = Number(String(cells[cells.length - 2]).replace(/,/g, ''));
      const credit = Number(String(cells[cells.length - 1]).replace(/,/g, ''));
      if (Number.isFinite(debit)) debitTotal += debit;
      if (Number.isFinite(credit)) creditTotal += credit;
    });
    console.log(
      `  DEBIT total : ${debitTotal} (ground truth ${b.debitTotal}, ` +
        `${debitTotal === b.debitTotal ? 'MATCH' : 'MISMATCH'})`,
    );
    console.log(
      `  CREDIT total: ${creditTotal} (ground truth ${b.creditTotal}, ` +
        `${creditTotal === b.creditTotal ? 'MATCH' : 'MISMATCH'})`,
    );
  }

  console.log(
    '\n(same GENERIC_PROMPT used for both shapes — no per-shape code, ' + 'no document-family knowledge in the prompt)',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
