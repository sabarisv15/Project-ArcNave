'use strict';

// Evidence probe for the alternative proposed in queued item 1: pdfjs-dist
// text items carry x/y transforms, so bucketing by y (rows) then sorting by
// x (columns) reconstructs a table that pdf-parse's flat getText() scrambles.
// This is a MEASUREMENT, not an implementation — deliberately crude, kept
// out of src/. Read-only, no LLM, no database.

const fs = require('fs');
const path = require('path');

const DOWNLOADS = 'C:\\Users\\HAI\\Downloads';
const Y_TOLERANCE = 3; // points; items within this share a printed row

async function pageRows(page) {
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
  return buckets
    .sort((a, b) => b.y - a.y)
    .map((b) => b.items.sort((p, q) => p.x - q.x));
}

async function main() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const file = process.argv[2] || 'EXAM FEES ece(sw) III YR 7 SEM.pdf';
  const data = new Uint8Array(fs.readFileSync(path.join(DOWNLOADS, file)));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  console.log(`${file} — ${doc.numPages} page(s)`);

  let studentRows = 0;
  for (let p = 1; p <= doc.numPages; p += 1) {
    const rows = await pageRows(await doc.getPage(p));
    console.log(`\n--- page ${p}: ${rows.length} reconstructed rows ---`);
    rows.forEach((row) => {
      const line = row.map((it) => it.str).join(' | ');
      if (/DoB\s*:/i.test(line)) studentRows += 1;
      if (p === 1) console.log(`  ${line.slice(0, 190)}`);
    });
  }
  console.log(`\nrows containing a DoB marker across all pages: ${studentRows}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
