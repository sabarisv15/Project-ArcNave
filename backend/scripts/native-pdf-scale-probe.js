'use strict';

// The decisive remaining unknown for native-PDF reading: does it SCALE?
//
// The self-consistency result was measured on a 2-page, 102 KB PDF. The
// real reference document is 400 pages and 1.5 MB. This measures what a
// native inline_data call actually costs there — request acceptance,
// latency, and token usage — because a method that works only on small
// documents is a different product decision from one that works generally.
//
// One call per document, deliberately: this is a cost/feasibility probe,
// not a correctness probe.
//
// Makes real, billable Vertex calls. Read-only, no database.

const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const config = require('../src/config');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';
const FILES = [
  'EXAM FEES ece(sw) III YR 7 SEM.pdf',
  'APRDAYBOOK.pdf',
  '111_cons_result_apr2026.pdf',
];

// Two questions, because the first run separated them sharply and the
// distinction is the whole finding: the model may be able to READ a row
// while being unable to COUNT the rows.
const COUNT_PROMPT = 'How many student/transaction rows does this document contain in total? '
  + 'Answer with only a number, nothing else.';
const EXTRACT_PROMPT = 'List EVERY data row in this document as a JSON array of '
  + '{"n": <row number>, "id": "<the main identifier for that row>"}. Return ONLY the JSON array. '
  + 'Do not summarise, do not stop early, include every row.';

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

async function main() {
  const token = await accessToken();
  console.log('file'.padEnd(38), 'MB'.padStart(6), 'ms'.padStart(8), 'inTok'.padStart(9), 'answer');
  const mode = process.argv[2] === 'extract' ? 'extract' : 'count';
  console.log(`mode: ${mode}`);
  for (const name of FILES) {
    const file = path.join(DOWNLOADS, name);
    if (!fs.existsSync(file)) { console.log(`${name} — MISSING`); continue; }
    const buffer = fs.readFileSync(file);
    const mb = (buffer.length / 1024 / 1024).toFixed(2);
    const t0 = Date.now();
    let inTok = '-';
    let answer;
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(modelUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { inline_data: { mime_type: 'application/pdf', data: buffer.toString('base64') } },
              { text: mode === 'count' ? COUNT_PROMPT : EXTRACT_PROMPT },
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: mode === 'count' ? 64 : 60000 },
        }),
      });
      if (!res.ok) {
        answer = `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`;
      } else {
        // eslint-disable-next-line no-await-in-loop
        const payload = await res.json();
        inTok = String((payload.usageMetadata || {}).promptTokenCount || '-');
        const text = (payload.candidates || [])
          .flatMap((c) => (c.content && c.content.parts) || [])
          .map((p) => p.text || '').join('').trim();
        if (mode === 'count') {
          answer = text.slice(0, 60);
        } else {
          const cleaned = text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
          let rows = null;
          try { rows = JSON.parse(cleaned); } catch { rows = null; }
          const finish = ((payload.candidates || [])[0] || {}).finishReason || '?';
          answer = Array.isArray(rows)
            ? `${rows.length} rows extracted (finish: ${finish})`
            : `UNPARSEABLE (finish: ${finish}, ${cleaned.length} chars)`;
        }
      }
    } catch (err) {
      answer = `THREW ${err.message.slice(0, 120)}`;
    }
    console.log(
      name.slice(0, 38).padEnd(38),
      mb.padStart(6),
      String(Date.now() - t0).padStart(8),
      inTok.padStart(9),
      answer,
    );
  }
  console.log('\nDeterministic reference counts: exam fees 23 students, day book 839 rows, result sheet 1603 records (1781 markers).');
}

main().catch((err) => { console.error(err); process.exit(1); });
