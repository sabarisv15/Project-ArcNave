'use strict';

// Measurement for the item 1 slice 2 Product Reasoning pass: what does
// geometric reconstruction COST, against the flat-text extraction it would
// sit beside? A chat attachment is extracted inside a live /ai/ask turn, so
// this is a latency question, not only a correctness one.
//
// Read-only, no LLM, no database.
//
// Run (from backend/):
//   set -a && . ./.env.local.sh && set +a && node scripts/pdf-geometry-cost-probe.js

const fs = require('fs');
const path = require('path');
const documentTextExtractionService = require('../src/services/documentTextExtractionService');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';
const FILES = ['EXAM FEES ece(sw) III YR 7 SEM.pdf', 'APRDAYBOOK.pdf', '111_cons_result_apr2026.pdf'];
const Y_TOLERANCE = 3;

async function geometryText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    // eslint-disable-next-line no-await-in-loop
    const page = await doc.getPage(p);
    // eslint-disable-next-line no-await-in-loop
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
      .map((it) => ({ x: it.transform[4], y: it.transform[5], str: it.str.trim() }));
    const buckets = [];
    items.forEach((it) => {
      const bucket = buckets.find((b) => Math.abs(b.y - it.y) <= Y_TOLERANCE);
      if (bucket) bucket.items.push(it);
      else buckets.push({ y: it.y, items: [it] });
    });
    buckets
      .sort((a, b) => b.y - a.y)
      .forEach((b) => {
        lines.push(
          b.items
            .sort((p1, q) => p1.x - q.x)
            .map((it) => it.str)
            .join(' | '),
        );
      });
  }
  return { text: lines.join('\n'), pages: doc.numPages };
}

async function main() {
  console.log(
    'file'.padEnd(38),
    'pages'.padStart(6),
    'flat ms'.padStart(9),
    'geom ms'.padStart(9),
    'ratio'.padStart(7),
  );
  for (const name of FILES) {
    const file = path.join(DOWNLOADS, name);
    if (!fs.existsSync(file)) {
      console.log(`${name} — MISSING`);
      continue;
    }
    const buffer = fs.readFileSync(file);

    const t0 = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const flat = await documentTextExtractionService.extractPlainText(buffer, 'application/pdf');
    const flatMs = Date.now() - t0;

    const t1 = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const geom = await geometryText(buffer);
    const geomMs = Date.now() - t1;

    console.log(
      name.slice(0, 38).padEnd(38),
      String(geom.pages).padStart(6),
      String(flatMs).padStart(9),
      String(geomMs).padStart(9),
      `${(geomMs / Math.max(flatMs, 1)).toFixed(1)}x`.padStart(7),
    );
    console.log(' '.repeat(38), `chars: flat ${flat.text ? flat.text.length : 0}, geometry ${geom.text.length}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
