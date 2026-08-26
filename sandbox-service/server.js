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

const http = require('http');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8080;
const SHARED_SECRET = process.env.SANDBOX_SHARED_SECRET || null;
const EXECUTION_TIMEOUT_MS = 15000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB request cap (code + files)

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

// Runs `code` as a fresh Python process in a fresh temp directory, with
// any provided files written alongside it first. Never inherits this
// process's full environment — only PATH, so no accidental env leakage
// from this service's own process into the executed code even though
// this service itself holds no ARCNAVE secret to leak in the first
// place (defense in depth, not the primary boundary).
async function runInSandbox({ code, files }) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-'));
  try {
    await Promise.all((files || []).map((file) => {
      const safeName = path.basename(file.name); // never allow a path-traversal file name
      return fs.writeFile(path.join(workDir, safeName), Buffer.from(file.contentBase64, 'base64'));
    }));
    const scriptPath = path.join(workDir, 'script.py');
    await fs.writeFile(scriptPath, code, 'utf8');

    return await new Promise((resolve) => {
      const child = spawn('python3', [scriptPath], {
        cwd: workDir,
        env: { PATH: process.env.PATH },
        timeout: EXECUTION_TIMEOUT_MS,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout = (stdout + d).slice(0, MAX_OUTPUT_BYTES); });
      child.stderr.on('data', (d) => { stderr = (stderr + d).slice(0, MAX_OUTPUT_BYTES); });
      child.on('error', (err) => resolve({ stdout, stderr: `${stderr}\n${err.message}`, exitCode: -1 }));
      child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }));
    });
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

  try {
    const result = await runInSandbox({ code: body.code, files: body.files });
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500).end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`sandbox-service listening on ${PORT}`);
});
