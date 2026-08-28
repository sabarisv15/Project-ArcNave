'use strict';

// THE MEASUREMENT ADL-058 MUST NOT BE BUILT WITHOUT.
//
// ADL-058 lists x-column-boundary detection as FUTURE — "the only thing
// that would lift partial trust, and which was done BY HAND during
// ADL-055's analysis, never automatically". Its whole partial-trust
// design rests on that premise.
//
// pdfplumber's extract_tables() does x-column-boundary detection as its
// ordinary job, and pdfplumber has been in the sandbox image since
// ADL-059. So the premise is testable in one run, and it decides whether
// a whole slice needs to exist:
//
//   PASS — pdfplumber attributes the numeric columns correctly. Then
//          ADL-058's geometry-as-permanent-partial-trust slice is
//          solving a problem an installed library already solves, and
//          most of it should not be built.
//   FAIL — the attribution premise holds, ADL-058's CORE stands, and
//          this probe is the evidence for it rather than an assumption.
//
// THE PASS/FAIL CASE IS NAMED IN ADVANCE, not chosen after seeing output.
// ADL-055 hand-verified that `1 1 65 625 690` belongs to ASHWIN JOHN
// EDISON S, and geometry misattributes it to ARAVINDAN G (serial 3),
// leaving ASHWIN with `0 0 1`. Gemini's native read independently agreed
// with the hand verification (arrears 1, totalFees 690 for ASHWIN). So:
// pdfplumber passes if and only if ASHWIN's row carries 690, and
// ARAVINDAN's does not.
//
// Read-only. Sends the PDF to the sandbox; writes nothing anywhere.
//
// Usage: node backend/scripts/pdfplumber-attribution-probe.js

const fs = require('fs');
const path = require('path');

const SANDBOX_URL = process.env.SANDBOX_SERVICE_URL;
const SANDBOX_TOKEN = process.env.SANDBOX_SERVICE_TOKEN;
const PDF = path.join('C:\\Users\\HAI\\Downloads', 'EXAM FEES ece(sw) III YR 7 SEM.pdf');

if (!SANDBOX_URL || !SANDBOX_TOKEN) {
  console.error('SANDBOX_SERVICE_URL and SANDBOX_SERVICE_TOKEN must be set');
  process.exit(1);
}

// Two extraction settings, because pdfplumber's default assumes ruling
// lines and this document's failure mode is merged cells. If "lines"
// fails and "text" succeeds, that is a finding about configuration, not
// about the library — and the two must not be conflated.
const CODE = `
import pdfplumber, json

def dump(label, settings):
    print('=== %s ===' % label)
    try:
        with pdfplumber.open('doc.pdf') as pdf:
            for pno, page in enumerate(pdf.pages, 1):
                tables = page.extract_tables(settings) if settings else page.extract_tables()
                for tno, table in enumerate(tables, 1):
                    print('--- page %d table %d: %d rows x %d cols ---'
                          % (pno, tno, len(table), max(len(r) for r in table) if table else 0))
                    for row in table:
                        cells = ['' if c is None else ' '.join(str(c).split()) for c in row]
                        print(' | '.join(cells))
    except Exception as e:
        print('FAILED: %r' % (e,))
    print()

dump('default (lines strategy)', None)
dump('text strategy', {'vertical_strategy': 'text', 'horizontal_strategy': 'text'})

# ---- machine-checked verdict, default strategy only ----
# Three checks, none of which depend on anyone reading the dump above:
#   1. the named case (ASHWIN carries 690, ARAVINDAN does not)
#   2. every identity row is recovered (23)
#   3. each row's own arithmetic holds: fees = arrears * 65, and
#      total = fees + 625. This is the strong one — misattribution
#      moves a number into a row where it no longer adds up.
print('=== VERDICT ===')
rows = []
with pdfplumber.open('doc.pdf') as pdf:
    for page in pdf.pages:
        for table in page.extract_tables():
            for row in table:
                cells = ['' if c is None else ' '.join(str(c).split()) for c in row]
                if len(cells) >= 8 and cells[0].isdigit() and cells[1].isdigit():
                    rows.append(cells)

print('identity rows recovered: %d (expected 23)' % len(rows))

def n(v):
    try:
        return int(v)
    except Exception:
        return None

bad = []
for r in rows:
    total_arrears, fees, sem_fee, total = n(r[4]), n(r[5]), n(r[6]), n(r[7])
    if None in (total_arrears, fees, sem_fee, total):
        bad.append((r[0], r[2], 'non-numeric', r[3:]))
    elif fees != total_arrears * 65 or total != fees + sem_fee:
        bad.append((r[0], r[2], 'arithmetic', r[3:]))
print('rows failing their own arithmetic: %d' % len(bad))
for b in bad:
    print('   FAIL serial %s %s (%s) %s' % b)

named = {r[2].split(' DoB')[0]: r for r in rows}
ashwin = named.get('ASHWIN JOHN EDISON S')
aravindan = named.get('ARAVINDAN G')
print('ASHWIN JOHN EDISON S  -> %s' % (ashwin[3:] if ashwin else 'NOT FOUND'))
print('ARAVINDAN G           -> %s' % (aravindan[3:] if aravindan else 'NOT FOUND'))
ok = (ashwin and ashwin[7] == '690' and aravindan and aravindan[7] != '690')
print('named-case attribution: %s' % ('PASS' if ok else 'FAIL'))
print('OK')
`;

(async () => {
  const bytes = fs.readFileSync(PDF);
  console.log(`${path.basename(PDF)} — ${bytes.length} bytes\n`);
  const response = await fetch(`${SANDBOX_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sandbox-Auth': SANDBOX_TOKEN },
    body: JSON.stringify({
      code: CODE,
      files: [{ name: 'doc.pdf', contentBase64: bytes.toString('base64') }],
    }),
  });
  if (!response.ok) {
    console.error(`HTTP ${response.status}: ${await response.text()}`);
    process.exit(1);
  }
  const body = await response.json();
  console.log(body.stdout || '(no stdout)');
  if (body.stderr) console.error(`stderr:\n${body.stderr}`);
  console.log(`exitCode: ${body.exitCode}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
