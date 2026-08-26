'use strict';

const config = require('../config');

// ADL-059 — credential-less code execution. This service is a thin HTTP
// client to a SEPARATE, standalone sandbox service — not a library that
// runs code in this process. That separation is the actual safety
// property: the sandbox service has its own deployment, its own
// container image, its own environment with no ARCNAVE credentials in
// it at all (no DATABASE_URL, no JWT_SECRET_KEY, nothing this file's own
// process can see), and no network path back into ARCNAVE's backend or
// database. This backend cannot accidentally grant the sandbox more
// access than it has by construction, because there is no shared
// process, shared env, or shared network namespace for a bug here to
// leak through.
//
// Deployment (not yet built — this file is the ARCNAVE-side half only):
// a separate Cloud Run service, gVisor-sandboxed by default (Cloud Run's
// own container runtime), no VPC connector configured (so it has no
// network path to any internal ARCNAVE service or database — not a
// firewall rule that could be misconfigured, no path exists), public
// egress denied by default. The sandbox service itself spawns a fresh
// child process per execution (never reuses process state across
// requests/instances) and wipes its own /tmp before and after every run.
// See the architecture note this was designed against for the full
// spec — Cloud Run instance reuse is a caching optimization, not an
// isolation guarantee, so per-execution process isolation is the
// sandbox service's own job, not something this client can assume from
// "it's on Cloud Run" alone.
//
// Only ever fed content already present in the current turn (e.g. one
// chat-attached file's bytes) — never a live query the sandbox
// constructs itself, and never anything requiring ARCNAVE data access
// beyond what the caller already explicitly passed in.

const EXECUTION_TIMEOUT_MS = 15000;
const MAX_CODE_CHARS = 20000;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB — one uploaded spreadsheet/CSV, not a media dump
const MAX_OUTPUT_CHARS = 20000; // bounds what lands in the LLM prompt, same reasoning as every other tool result cap

class SandboxNotConfiguredError extends Error {}
class SandboxValidationError extends Error {}
class SandboxExecutionError extends Error {}

function assertConfigured() {
  if (!config.sandboxServiceUrl || !config.sandboxServiceToken) {
    throw new SandboxNotConfiguredError(
      'the code-execution sandbox is not deployed yet (SANDBOX_SERVICE_URL / SANDBOX_SERVICE_TOKEN unset) — see ADL-059',
    );
  }
}

function assertValidRequest(code, files) {
  if (typeof code !== 'string' || !code.trim()) {
    throw new SandboxValidationError('code is required and must be a non-empty string');
  }
  if (code.length > MAX_CODE_CHARS) {
    throw new SandboxValidationError(`code must be at most ${MAX_CODE_CHARS} characters`);
  }
  (files || []).forEach((file) => {
    if (!file || typeof file.name !== 'string' || typeof file.contentBase64 !== 'string') {
      throw new SandboxValidationError('each file must have {name, contentBase64}');
    }
    const approxBytes = (file.contentBase64.length * 3) / 4;
    if (approxBytes > MAX_FILE_BYTES) {
      throw new SandboxValidationError(`file ${JSON.stringify(file.name)} exceeds the ${MAX_FILE_BYTES}-byte limit`);
    }
  });
}

// Returns {stdout, stderr, exitCode} — the sandbox's raw output, never
// trusted as instructions by anything downstream. This function does
// not itself apply the untrusted-data boundary; the caller (the
// execute_code AI tool, once registered) flows this return value through
// the same Context Builder / Prompt Safety Layer pipeline every other
// tool's result already goes through (RS-AIG-003) — identical to how
// fetchTrustedPage's own return value is handled, nothing special-cased
// here for having come from executed code rather than a fetched page.
async function executeCode({ code, files }) {
  assertConfigured();
  assertValidRequest(code, files);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXECUTION_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${config.sandboxServiceUrl}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sandbox-auth': config.sandboxServiceToken },
      body: JSON.stringify({ code, files: files || [] }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new SandboxExecutionError(`sandbox request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new SandboxExecutionError(`sandbox returned ${response.status}`);
  }
  const result = await response.json();
  return {
    stdout: String(result.stdout || '').slice(0, MAX_OUTPUT_CHARS),
    stderr: String(result.stderr || '').slice(0, MAX_OUTPUT_CHARS),
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
  };
}

module.exports = {
  SandboxNotConfiguredError,
  SandboxValidationError,
  SandboxExecutionError,
  EXECUTION_TIMEOUT_MS,
  MAX_CODE_CHARS,
  MAX_FILE_BYTES,
  executeCode,
};
