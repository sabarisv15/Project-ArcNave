'use strict';

// Measures what the 6-skill image actually costs at runtime.
//
// WHY THIS EXISTS. sandbox-service/Dockerfile carries a cost note it
// could not substantiate: "this is a large increase on an image that was
// already ~1.2GB, and its cold-start cost has never been measured. That
// measurement is now more overdue, not less." This is that measurement.
//
// HOW COLD IS TOLD FROM WARM — and one way that does NOT work, recorded
// so nobody rebuilds it. The obvious in-sandbox discriminator is
// /proc/uptime: a container that has existed for 0.2s served a cold
// request, one that reports minutes served a warm one. It is wrong here.
// gVisor virtualises /proc/uptime, and measurement showed it advancing
// by roughly the duration of each script rather than by wall-clock time
// between requests (0.16s, 0.26s, 0.34s across requests seconds apart).
// It reports the sandbox's own execution time, not the instance's age,
// so it can never distinguish the two. It is still printed below because
// it is a real per-run cost, but no verdict is derived from it.
//
// The verdict comes from Cloud Run's own logs instead, which is where
// instance identity actually lives:
//
//   gcloud logging read 'resource.type="cloud_run_revision" AND
//     resource.labels.service_name="arcnave-sandbox-service"' \
//     --freshness=1h --format="value(timestamp,httpRequest.latency,labels)"
//
// A cold request is one whose start timestamp PRECEDES the "Default
// STARTUP TCP probe succeeded" entry for the instanceId that served it.
// The gap between those two is the cold start; the client-side wall time
// printed here is that gap plus network plus execution.
//
// Cloud Run scales this service to zero (no minScale annotation), so the
// first request after an idle period is genuinely cold. Run this after
// leaving the service alone for 20+ minutes.
//
// Usage: node backend/scripts/sandbox-coldstart-probe.js

const { SANDBOX_PACKAGES } = require('../src/constants/sandboxPackages');

const SANDBOX_URL = process.env.SANDBOX_SERVICE_URL;
const SANDBOX_TOKEN = process.env.SANDBOX_SERVICE_TOKEN;

if (!SANDBOX_URL || !SANDBOX_TOKEN) {
  console.error('SANDBOX_SERVICE_URL and SANDBOX_SERVICE_TOKEN must be set');
  process.exit(1);
}

// Prints the container's own uptime in seconds. Deliberately imports
// nothing: this measures the instance's startup, not any library's.
const UPTIME_ONLY = `
with open('/proc/uptime') as f:
    print('UPTIME', f.read().split()[0])
print('OK')
`;

// The libraries the 6 skills reach for. Imported one at a time and timed
// individually, because "imports are slow" is not an actionable finding —
// "this one import is 80% of it" is. The name list itself comes from
// SANDBOX_PACKAGES (src/constants/sandboxPackages.js) — the same source
// aiToolRegistry.js's execute_code description reads — so this probe can
// never silently drift from what the tool tells the model is available.
const IMPORT_NAMES_PY = SANDBOX_PACKAGES.map((p) => `'${p.importName}'`).join(', ');
const IMPORT_COST = `
import time, sys
with open('/proc/uptime') as f:
    print('UPTIME', f.read().split()[0])
for name in [${IMPORT_NAMES_PY}]:
    t = time.perf_counter()
    try:
        __import__(name)
        print('IMPORT %-18s %6.0f ms' % (name, (time.perf_counter() - t) * 1000))
    except Exception as e:
        print('IMPORT %-18s FAILED %s' % (name, e))
print('OK')
`;

// LibreOffice is the single largest thing in the image and the one whose
// cost is least visible from the outside — it is a process launch, not an
// import, so nothing above would ever catch it.
const SOFFICE_COST = `
import time, subprocess, os
with open('/proc/uptime') as f:
    print('UPTIME', f.read().split()[0])
from docx import Document
d = Document()
d.add_paragraph('cold start probe')
d.save('probe.docx')
t = time.perf_counter()
r = subprocess.run(
    ['soffice', '-env:UserInstallation=file:///tmp/lo-probe',
     '--headless', '--convert-to', 'pdf', 'probe.docx'],
    capture_output=True, timeout=180)
print('SOFFICE first-run %6.0f ms exit=%d produced=%s'
      % ((time.perf_counter() - t) * 1000, r.returncode, os.path.exists('probe.pdf')))
t = time.perf_counter()
r = subprocess.run(
    ['soffice', '-env:UserInstallation=file:///tmp/lo-probe',
     '--headless', '--convert-to', 'html', 'probe.docx'],
    capture_output=True, timeout=180)
print('SOFFICE second-run %6.0f ms exit=%d' % ((time.perf_counter() - t) * 1000, r.returncode))
print('OK')
`;

async function execute(label, code) {
  const started = Date.now();
  const response = await fetch(`${SANDBOX_URL}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sandbox-Auth': SANDBOX_TOKEN,
    },
    body: JSON.stringify({ code }),
  });
  const elapsed = Date.now() - started;
  if (!response.ok) {
    console.log(`${label}: HTTP ${response.status} after ${elapsed} ms — ${await response.text()}`);
    return { elapsed, uptime: null };
  }
  const body = await response.json();
  const stdout = body.stdout || '';
  const uptimeMatch = stdout.match(/UPTIME ([\d.]+)/);
  const uptime = uptimeMatch ? Number(uptimeMatch[1]) : null;
  // Reported, not interpreted — see the file comment on why this number
  // cannot tell cold from warm.
  console.log(`${label}: ${elapsed} ms wall (sandbox exec clock ${uptime}s)`);
  stdout.split('\n')
    .filter((line) => /^(IMPORT|SOFFICE)/.test(line))
    .forEach((line) => console.log(`    ${line}`));
  if (body.stderr) console.log(`    stderr: ${String(body.stderr).slice(0, 300)}`);
  return { elapsed, uptime };
}

(async () => {
  console.log(`sandbox: ${SANDBOX_URL}\n`);

  console.log('--- 1. First request (cold if the service was idle) ---');
  await execute('request 1', UPTIME_ONLY);

  console.log('\n--- 2. Warm repeats, same trivial script ---');
  const warm = [];
  for (let i = 2; i <= 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await execute(`request ${i}`, UPTIME_ONLY);
    warm.push(r.elapsed);
  }
  const sorted = [...warm].sort((a, b) => a - b);
  console.log(`warm median: ${sorted[Math.floor(sorted.length / 2)]} ms`);

  console.log('\n--- 3. Library import cost (warm instance) ---');
  await execute('imports', IMPORT_COST);

  console.log('\n--- 4. LibreOffice launch cost (warm instance) ---');
  await execute('soffice', SOFFICE_COST);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
