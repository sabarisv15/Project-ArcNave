'use strict';

// Best case for ARCNAVE: the SAME statement data handed over as a clean CSV,
// so extraction is not the bottleneck. Measures whether the closed operation
// vocabulary can then answer "total PLB credit". Read-only, no LLM, no DB.

const fs = require('fs');
const path = require('path');

const textExtraction = require('../src/services/documentTextExtractionService');
const tableExtraction = require('../src/services/documentTableExtractionService');
const aggregate = require('../src/services/documentAggregateService');

const TEXT = fs.readFileSync(path.join(__dirname, 'statement-extracted.txt'), 'utf8');
const DATE_START = /^\d{2}\.\d{2}\.\d{4}\s/;
const NUM = /^-?[\d,]+\.\d{2}-?$/;

function buildCsv() {
  const blocks = [];
  for (const raw of TEXT.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (DATE_START.test(line)) blocks.push(line);
    else if (blocks.length > 0) blocks[blocks.length - 1] += ` ${line}`;
  }
  const rows = [['DATE', 'TYPE', 'INV', 'DESC', 'DEBIT', 'CREDIT']];
  for (const block of blocks) {
    const m = /^(\d{2}\.\d{2}\.\d{4})\s+(\S+)\s+(\S+)\s+(.*)$/.exec(block);
    if (!m) continue;
    const t = m[4].split(/\s+/);
    const q = t.findIndex((x) => /^\d+\.\d{3}$/.test(x));
    if (q < 0) continue;
    let i = q + 1;
    if (t[i] !== undefined && !NUM.test(t[i])) i += 1;
    const money = [];
    while (i < t.length && NUM.test(t[i]) && money.length < 7) {
      money.push(t[i]);
      i += 1;
    }
    if (money.length < 7) continue;
    rows.push([m[1], m[2], m[3], t.slice(0, q).join(' '), money[4], money[5]]);
  }
  return rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
}

async function main() {
  const out = await textExtraction.extractPlainText(Buffer.from(buildCsv(), 'utf8'), 'text/csv');
  const res = tableExtraction.extractRecords(out.text);
  console.log('BEST CASE — same data supplied as CSV instead of PDF');
  console.log('  strategy:', res.strategy, ' records:', res.records.length, ' coverage:', JSON.stringify(res.coverage));

  const plb = res.records.filter((r) => /\bPLB\b/.test(r.cells.join(' ')));
  console.log('  PLB rows ARCNAVE sees:', plb.length);
  console.log('  recordText of one    :', JSON.stringify(plb[0].cells.join(' ')));

  console.log('\n  operation "sum" (the natural choice for a total):');
  const summed = aggregate.aggregate(plb, { operation: 'sum', filter: { pattern: '([\\d,]+\\.\\d{2})' } });
  console.log('   ', JSON.stringify(aggregate.summarize(summed)).slice(0, 200));

  console.log('\n  operation "compare" with several patterns a model might write:');
  const identity = aggregate.compileIdentityPattern('(PLB[^0-9]*)').regex;
  const patterns = ['([\\d,]+\\.\\d{2})$', '\\s0\\s([\\d,]+\\.\\d{2})', '([\\d,]+\\.\\d{2})'];
  for (const pattern of patterns) {
    try {
      const c = aggregate.compareRecords(plb, {
        filter: { pattern },
        comparison: { operator: 'gt', value: 0 },
        identityPattern: identity,
      });
      console.log(
        `    ${JSON.stringify(pattern).padEnd(28)} -> total ${c.total}  matched ${c.matchedCount}` +
          `  multiMatch ${c.multiMatchRows}  unmatched ${c.unmatchedRows}`,
      );
    } catch (err) {
      console.log(`    ${pattern} -> ${err.message}`);
    }
  }
  console.log('\n  ground truth for PLB credit: 170722.00 across 9 rows');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
