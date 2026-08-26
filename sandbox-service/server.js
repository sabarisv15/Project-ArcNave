'use strict';

// ADL-059 — the code-execution sandbox. A STANDALONE service, not part
// of backend/ — deployed as its own Cloud Run service, its own Docker
// image, its own environment. It never has ARCNAVE's DATABASE_URL,
// JWT_SECRET_KEY, or any other backend secret, because nothing in this
// deployment's own env sets them — that separation, not a runtime
// check, is the actual isolation boundary.
//
// Per-request isolation: a fresh temp directory and a fresh child
// process for every call, regardless of whether Cloud Run reuses the
// container instance between requests (instance reuse is a
// cache-efficiency feature, not an isolation guarantee — this service
// does not rely on it for anything).
//
// Deploy with:
//   - no VPC connector (no network path to ARCNAVE's backend/DB exists)
//   - egress denied by default (executed code should not reach the
//     open internet either, unless a future explicit allowlist decision
//     changes this)
//   - --no-allow-unauthenticated, plus the SANDBOX_SHARED_SECRET check
//     below as a second, independent layer — a caller must both hold a
//     valid Cloud Run IAM identity token AND know this secret.
//
// FILE OUTPUT + VERIFICATION (added alongside pdfplumber/openpyxl/
// pandas/LibreOffice in the image). Before this, a script could BUILD a
// file — the temp directory existed, openpyxl could write to it — and
// the bytes were then deleted by the `finally` block below with no way
// to ever leave this container. `outputFile` names one file in workDir
// to read back and return, before that cleanup runs.
//
// For an .xlsx `outputFile`, verification runs INSIDE this same
// isolated container, using recalc.py, and is returned alongside the
// file rather than left for the backend to compute. Two reasons this
// lives here and not in ARCNAVE's backend:
//   1. Every dependency the gate needs (openpyxl, LibreOffice) is
//      already in this image for the script's own use.
//   2. The gate is what decides whether the file leaves the sandbox AT
//      ALL boundary-wise it belongs with the thing being verified, not
//      one hop downstream of it.
// A zero exit code from LibreOffice's own conversion is NOT what this
// checks — see recalc.py's own file comment for the three distinct
// failure modes it looks for (error values, formulas silently replaced
// by literal constants, and cells LibreOffice never actually
// recalculated). This service does not interpret the report; it passes
// recalc.py's own JSON straight through as `verification`.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8080;
const SHARED_SECRET = process.env.SANDBOX_SHARED_SECRET || null;
// Raised from 15s when pdfplumber/openpyxl/pandas were added to the
// image: 15s was sized for arithmetic, and a real table extraction
// across a 49-page ledger is a different order of work. NOT a measured
// number — no timed run has happened against the real documents yet, so
// treat 60s as a provisional ceiling to be replaced by a measurement,
// not as a validated budget. Overridable so that measurement does not
// need a redeploy to explore. This budgets the SCRIPT only — recalc.py
// verification (below) runs after this and has its own separate budget,
// because LibreOffice conversion is a different order of work again.
const EXECUTION_TIMEOUT_MS = Number(process.env.EXECUTION_TIMEOUT_MS) || 60000;
// LibreOffice's own conversion step has an internal 120s timeout
// (recalc.py's own LIBREOFFICE_TIMEOUT_SECONDS). This is the OUTER
// spawn timeout on the recalc.py process itself, deliberately longer
// than that inner one so recalc.py gets the chance to catch its own
// timeout and report a clean {"verdict": "unverified", ...} JSON body,
// rather than this service SIGTERM-ing it mid-report and returning
// nothing usable at all.
const VERIFICATION_TIMEOUT_MS = Number(process.env.VERIFICATION_TIMEOUT_MS) || 130000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB request cap (code + files)
// A generated workbook is server-produced, not user-uploaded, but still
// bounded — same "one spreadsheet, not a media dump" reasoning
// sandboxExecutionService.js's own MAX_FILE_BYTES already applies to
// input files.
const MAX_OUTPUT_FILE_BYTES = 10 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// A thin, generic "run this and capture stdout/exit" — used for both the
// user's own script and, afterward, recalc.py. Not exported beyond this
// file: the two callers below apply different environments and
// timeouts, which is the actual security-relevant difference between
// them, not something worth hiding behind one shared abstraction.
function runProcess(command, args, { cwd, env, timeout }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, timeout });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout = (stdout + d).slice(0, MAX_OUTPUT_BYTES); });
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(0, MAX_OUTPUT_BYTES); });
    child.on('error', (err) => resolve({ stdout, stderr: `${stderr}\n${err.message}`, exitCode: -1 }));
    child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }));
  });
}

// Runs recalc.py against one file already sitting in workDir. Given its
// own HOME inside workDir (unlike the user's script below, which gets
// PATH only) because LibreOffice's headless mode still probes $HOME for
// a few things even with -env:UserInstallation pointed elsewhere — this
// is trusted code this service ships, not the untrusted script, so a
// slightly wider environment here is not a boundary weakening.
async function runVerification(workDir, outputPath, expectFormulasIn) {
  const expectPath = path.join(workDir, 'expect.json');
  await fs.writeFile(expectPath, JSON.stringify(expectFormulasIn || []), 'utf8');

  const { stdout, stderr, exitCode } = await runProcess(
    'python3',
    [path.join(__dirname, 'scripts', 'recalc.py'), outputPath, expectPath],
    { cwd: workDir, env: { PATH: process.env.PATH, HOME: workDir }, timeout: VERIFICATION_TIMEOUT_MS },
  );

  if (exitCode !== 0) {
    return {
      verdict: 'unverified', passed: false, reason: 'verification_process_failed', detail: stderr.slice(0, 500),
    };
  }
  try {
    return JSON.parse(stdout);
  } catch (err) {
    return {
      verdict: 'unverified', passed: false, reason: 'verification_output_unparseable', detail: stdout.slice(0, 500),
    };
  }
}

// Runs `code` as a fresh Python process in a fresh temp directory, with
// any provided files written alongside it first. Never inherits this
// process's full environment — only PATH, so no accidental env leakage
// from this service's own process into the executed code even though
// this service itself holds no ARCNAVE secret to leak in the first
// place (defense in depth, not the primary boundary).
//
// `outputFile`, if given, is read back from workDir AFTER the script
// runs and BEFORE the `finally` block deletes it — that ordering is the
// entire mechanism by which a generated file survives this call at all.
// `expectFormulasIn` only has an effect when outputFile ends in .xlsx;
// passed through to recalc.py unchanged, including when empty (an xlsx
// with no declared expectation is still run through the gate and
// reported "unverified", never silently skipped).
async function runInSandbox({
  code, files, outputFile, expectFormulasIn,
}) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-'));
  try {
    await Promise.all((files || []).map((file) => {
      const safeName = path.basename(file.name); // never allow a path-traversal file name
      return fs.writeFile(path.join(workDir, safeName), Buffer.from(file.contentBase64, 'base64'));
    }));
    const scriptPath = path.join(workDir, 'script.py');
    await fs.writeFile(scriptPath, code, 'utf8');

    const result = await runProcess('python3', [scriptPath], {
      cwd: workDir, env: { PATH: process.env.PATH }, timeout: EXECUTION_TIMEOUT_MS,
    });

    if (!outputFile) {
      return { ...result, files: [], verification: null };
    }

    // path.basename here for the exact reason it is applied to input
    // file names above: a caller-supplied name must never be able to
    // read a path outside workDir.
    const safeOutputName = path.basename(outputFile);
    const outputPath = path.join(workDir, safeOutputName);
    let stat;
    try {
      stat = await fs.stat(outputPath);
    } catch (err) {
      // The script did not produce the declared file — reported as a
      // normal (empty) result, not a request error: this is information
      // about what the untrusted code did, same as a non-zero exitCode.
      return { ...result, files: [], verification: null };
    }
    if (stat.size > MAX_OUTPUT_FILE_BYTES) {
      return {
        ...result,
        files: [],
        verification: {
          verdict: 'unverified', passed: false, reason: 'output_file_too_large', detail: `${stat.size} bytes exceeds the ${MAX_OUTPUT_FILE_BYTES}-byte limit`,
        },
      };
    }

    const contentBase64 = (await fs.readFile(outputPath)).toString('base64');
    let verification = null;
    if (safeOutputName.toLowerCase().endsWith('.xlsx')) {
      verification = await runVerification(workDir, outputPath, expectFormulasIn);
    }

    return {
      ...result, files: [{ name: safeOutputName, contentBase64 }], verification,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/execute') {
    res.writeHead(404).end();
    return;
  }
  if (!SHARED_SECRET || !timingSafeEqual(req.headers['x-sandbox-auth'] || '', SHARED_SECRET)) {
    res.writeHead(401).end();
    return;
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400).end('invalid request body');
    return;
  }
  if (typeof body.code !== 'string' || !body.code.trim()) {
    res.writeHead(400).end('code is required');
    return;
  }
  if (body.outputFile !== undefined && (typeof body.outputFile !== 'string' || !body.outputFile.trim())) {
    res.writeHead(400).end('outputFile must be a non-empty string when given');
    return;
  }
  if (body.expectFormulasIn !== undefined && !Array.isArray(body.expectFormulasIn)) {
    res.writeHead(400).end('expectFormulasIn must be an array when given');
    return;
  }

  try {
    const result = await runInSandbox({
      code: body.code, files: body.files, outputFile: body.outputFile, expectFormulasIn: body.expectFormulasIn,
    });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500).end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`sandbox-service listening on ${PORT}`);
});
