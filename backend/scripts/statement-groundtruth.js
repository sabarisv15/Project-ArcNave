'use strict';

// Independent ground truth for the statement PDF, computed OUTSIDE ARCNAVE's
// tool vocabulary — the reference an ARCNAVE answer gets checked against.
// Read-only, no LLM, no DB.

const fs = require('fs');
const path = require('path');

const TEXT = fs.readFileSync(path.join(__dirname, 'statement-extracted.txt'), 'utf8');

const CATEGORIES = [
  ['CR NT GST', /\bCR\s*NT\s*GST\b/i],
  ['ADD GADD', /\bADD\s*GADD\b/i],
  ['PLB', /\bPLB\b/i],
  ['MQD', /\bMQD\b/i],
  ['SQD', /\bSQD\b/i],
  ['PPD', /\bPPD\b/i],
  ['TDS', /\bTDS\b/i],
  ['CD', /\bCD\b/i],
  ['SD', /\bSD\b/i],
];

const ROW = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\S+)\s+(\S+)\s+(.*)$/;
const NUM = /^-?[\d,]+\.\d{2}-?$/;
const DATE_START = /^\d{2}\.\d{2}\.\d{4}\s/;

function num(t) {
  return Number(t.replace(/,/g, '').replace(/-$/, '')) * (t.endsWith('-') ? 1 : 1);
}

// A transaction's printed row wraps across physical lines when its DESC is
// long — the amounts then land on a following line. Join every line from one
// date-start up to (but not including) the next one, so a wrapped row is one
// logical row. Page headers/footers between them are joined too and are
// harmless: they carry no numeric tail in the trailing position.
const blocks = [];
for (const raw of TEXT.split('\n')) {
  const line = raw.trim();
  if (line === '') continue;
  if (DATE_START.test(line)) blocks.push(line);
  else if (blocks.length > 0) blocks[blocks.length - 1] += ` ${line}`;
}

const rows = [];
for (const block of blocks) {
  const m = ROW.exec(block);
  if (!m) continue;
  const tokens = m[6].split(/\s+/);
  // QTY(MT) is printed with 3 decimals and marks where DESC ends. After it
  // comes an optional TRK No., then exactly 7 money columns:
  // AMT, SGST, CGST, IGST, DEBIT, CREDIT, BALANCE.
  const qtyIndex = tokens.findIndex((t) => /^\d+\.\d{3}$/.test(t));
  if (qtyIndex < 0) continue;
  let i = qtyIndex + 1;
  if (tokens[i] !== undefined && !NUM.test(tokens[i])) i += 1; // TRK No.
  const money = [];
  while (i < tokens.length && NUM.test(tokens[i]) && money.length < 7) {
    money.push(tokens[i]);
    i += 1;
  }
  if (money.length < 7) continue;
  const desc = tokens.slice(0, qtyIndex).join(' ');
  const debit = num(money[4]);
  const credit = num(money[5]);
  rows.push({
    month: `${m[3]}-${m[2]}`,
    type: m[4],
    desc,
    debit,
    credit,
  });
}

function categorise(desc) {
  for (const [name, re] of CATEGORIES) if (re.test(desc)) return name;
  return null;
}

const byCat = new Map();
const byCatMonth = new Map();
let matched = 0;
for (const r of rows) {
  const cat = categorise(r.desc);
  if (!cat) continue;
  matched += 1;
  const c = byCat.get(cat) || { debit: 0, credit: 0, n: 0 };
  c.debit += r.debit;
  c.credit += r.credit;
  c.n += 1;
  byCat.set(cat, c);
  const k = `${cat}|${r.month}`;
  const cm = byCatMonth.get(k) || { debit: 0, credit: 0, n: 0 };
  cm.debit += r.debit;
  cm.credit += r.credit;
  cm.n += 1;
  byCatMonth.set(k, cm);
}

const r2 = (n) => Math.round(n * 100) / 100;
console.log(`parsed transaction rows: ${rows.length}`);
console.log(`rows matching one of the 9 categories: ${matched}`);
console.log('\nCategory        rows        DEBIT        CREDIT');
let td = 0;
let tc = 0;
for (const [name] of CATEGORIES) {
  const c = byCat.get(name);
  if (!c) {
    console.log(`${name.padEnd(12)} —`);
    continue;
  }
  td += c.debit;
  tc += c.credit;
  console.log(
    `${name.padEnd(12)} ${String(c.n).padStart(5)} ${r2(c.debit).toFixed(2).padStart(14)} ${r2(c.credit).toFixed(2).padStart(14)}`,
  );
}
console.log(
  `${'GRAND'.padEnd(12)} ${String(matched).padStart(5)} ${r2(td).toFixed(2).padStart(14)} ${r2(tc).toFixed(2).padStart(14)}`,
);

console.log('\nmonth-wise (category x month, non-zero only):');
[...byCatMonth.entries()].sort().forEach(([k, v]) => {
  console.log(
    `  ${k.padEnd(20)} n=${String(v.n).padStart(4)} debit=${r2(v.debit).toFixed(2).padStart(12)} credit=${r2(v.credit).toFixed(2).padStart(12)}`,
  );
});
