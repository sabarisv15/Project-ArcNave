'use strict';

// Does giving Gemini the PDF NATIVELY (as a document part, so it sees the
// printed layout) beat ARCNAVE's deterministic text path on the one
// document the text path cannot read — the merged-cell exam-fees PDF?
//
// This is the question raised by "why not adopt an agent instead of writing
// specs". It is a fair question and it deserves a measurement rather than
// an argument.
//
// THE EXPERIMENT'S DESIGN, and why it needs no ground truth.
//
// Nobody here holds a verified transcription of this PDF, and the person
// running this probe is also an LLM, so "I read it and Gemini agrees with
// me" would prove nothing. Instead this measures SELF-CONSISTENCY, which is
// a NECESSARY condition for trust regardless of ground truth:
//
//   Ask the same model the same question about the same bytes, N times.
//   If the answers disagree with each other, at most one of them is right
//   and nothing in the system can tell which — so the method cannot carry
//   a number a user will act on. No ground truth is required to conclude
//   that.
//
// This is exactly how this whole thread started (ADL-055 / the result-sheet
// evidence doc): a direct Gemini-app upload and ARCNAVE's own chat
// disagreed about the same PDF.
//
// Identity is cross-checked against the deterministic geometry path, whose
// 23 records are independently verified by DoB-marker accounting (23/23,
// zero orphans, zero collapsed) — that part IS trustworthy ground truth.
//
// Makes real, billable Vertex calls. Read-only, no database.
//
// Run (from backend/):
//   set -a && . ./.env.local.sh && set +a && node scripts/native-pdf-vs-deterministic-probe.js

const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const config = require('../src/config');
const documentTableExtractionService = require('../src/services/documentTableExtractionService');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';
const PDF = path.join(DOWNLOADS, 'EXAM FEES ece(sw) III YR 7 SEM.pdf');
const RUNS = 5;
const Y_TOLERANCE = 3;

const PROMPT = `This is an examination fee list. Extract EVERY student row as JSON.

Return ONLY a JSON array, no prose, no markdown fence. One object per student:
{"serial": <number>, "regNo": "<string>", "name": "<string>", "arrears": <number>, "totalFees": <number>}

"arrears" is that student's number of arrear subjects. "totalFees" is the final
total fees amount for that student. Use the values printed on that student's own
row. If a value is not printed for a student, use null.`;

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
  const res = await fetch(modelUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: base64 } },
          { text: PROMPT },
        ],
      }],
      // Temperature 1, deliberately. An earlier version of this probe ran
      // at temperature 0 and reported "fully self-consistent" — which
      // proves almost nothing, because temperature 0 makes the model
      // near-deterministic by construction. Asking the same question three
      // times at temperature 0 is close to asking it once. Self-consistency
      // is only evidence when the model was actually free to vary.
      generationConfig: { temperature: 1, maxOutputTokens: 8192 },
    }),
  });
  if (!res.ok) throw new Error(`Vertex ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const payload = await res.json();
  const text = (payload.candidates || [])
    .flatMap((c) => (c.content && c.content.parts) || [])
    .map((p) => p.text || '')
    .join('');
  const cleaned = text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  try {
    return { rows: JSON.parse(cleaned), raw: text };
  } catch {
    return { rows: null, raw: text };
  }
}

// The deterministic side: geometry recovers identity 23/23, verified by
// DoB-marker accounting. This is the only trustworthy reference here.
async function deterministicIdentities(buffer) {
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
      const b = buckets.find((k) => Math.abs(k.y - it.y) <= Y_TOLERANCE);
      if (b) b.items.push(it); else buckets.push({ y: it.y, items: [it] });
    });
    buckets.sort((a, b) => b.y - a.y)
      .forEach((b) => lines.push(b.items.sort((p1, q) => p1.x - q.x).map((it) => it.str).join(' ')));
  }
  const parsed = documentTableExtractionService.extractRecords(lines.join('\n'));
  return { records: parsed.records, coverage: parsed.coverage };
}

function key(row) {
  return `${row.serial}|${row.regNo}`;
}

function compareRuns(runs) {
  const agreements = { serial: 0, regNo: 0, arrears: 0, totalFees: 0 };
  const disagreements = [];
  const base = runs[0];
  const bySerial = runs.map((r) => new Map(r.map((row) => [String(row.serial), row])));
  base.forEach((row) => {
    const others = bySerial.slice(1).map((m) => m.get(String(row.serial)));
    if (others.some((o) => !o)) {
      disagreements.push(`serial ${row.serial}: missing from another run`);
      return;
    }
    if (others.every((o) => String(o.regNo) === String(row.regNo))) agreements.regNo += 1;
    else disagreements.push(`serial ${row.serial} regNo: ${[row, ...others].map((o) => o.regNo).join(' / ')}`);
    if (others.every((o) => o.arrears === row.arrears)) agreements.arrears += 1;
    else disagreements.push(`serial ${row.serial} arrears: ${[row, ...others].map((o) => o.arrears).join(' / ')}`);
    if (others.every((o) => o.totalFees === row.totalFees)) agreements.totalFees += 1;
    else disagreements.push(`serial ${row.serial} totalFees: ${[row, ...others].map((o) => o.totalFees).join(' / ')}`);
    agreements.serial += 1;
  });
  return { agreements, disagreements };
}

async function main() {
  if (!fs.existsSync(PDF)) { console.error(`Missing ${PDF}`); process.exit(2); }
  const buffer = fs.readFileSync(PDF);
  const base64 = buffer.toString('base64');

  const det = await deterministicIdentities(buffer);
  console.log('=== Deterministic reference (geometry) ===');
  console.log(`records: ${det.records.length}, coverage: ${JSON.stringify(det.coverage)}`);
  console.log(`serials: ${det.records.map((r) => r.serialNo).join(',')}`);

  const token = await accessToken();
  console.log(`\n=== Gemini native PDF, ${RUNS} runs, temperature 1, model ${config.gemini.model} ===`);
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { rows, raw } = await askGemini(token, base64);
    if (!Array.isArray(rows)) {
      console.log(`run ${i + 1}: DID NOT RETURN PARSEABLE JSON — ${raw.slice(0, 200)}`);
      continue;
    }
    runs.push(rows);
    console.log(`run ${i + 1}: ${rows.length} rows`);
  }
  if (runs.length < 2) { console.log('\nToo few parseable runs to compare.'); return; }

  console.log('\n=== 1. Does Gemini agree with ITSELF across runs? ===');
  const { agreements, disagreements } = compareRuns(runs);
  console.log(`  rows compared      : ${agreements.serial}`);
  console.log(`  regNo agreed       : ${agreements.regNo}/${agreements.serial}`);
  console.log(`  arrears agreed     : ${agreements.arrears}/${agreements.serial}`);
  console.log(`  totalFees agreed   : ${agreements.totalFees}/${agreements.serial}`);
  console.log(`  row counts per run : ${runs.map((r) => r.length).join(' / ')}`);
  if (disagreements.length) {
    console.log('  disagreements:');
    disagreements.slice(0, 15).forEach((d) => console.log(`    ${d}`));
    if (disagreements.length > 15) console.log(`    ... and ${disagreements.length - 15} more`);
  } else {
    console.log('  -> fully self-consistent');
  }

  console.log('\n=== 2. Do Gemini identities match the deterministic 23? ===');
  const detKeys = new Set(det.records.map((r) => `${Number(r.serialNo)}|${r.regNo}`));
  runs.forEach((rows, i) => {
    const matched = rows.filter((r) => detKeys.has(key({ serial: Number(r.serial), regNo: String(r.regNo) }))).length;
    console.log(`  run ${i + 1}: ${matched}/${det.records.length} identities match, ${rows.length} rows returned`);
  });

  console.log('\n=== 3. Sample of what Gemini returned (run 1, first 6) ===');
  runs[0].slice(0, 6).forEach((r) => console.log(`  ${JSON.stringify(r)}`));
}

main().catch((err) => { console.error(err); process.exit(1); });
