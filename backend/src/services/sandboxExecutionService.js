'use strict';

const { GoogleAuth } = require('google-auth-library');
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

// Must stay >= the sandbox service's own EXECUTION_TIMEOUT_MS, or this
// client aborts first and the sandbox's real result — including its own
// clean timeout message — is thrown away. That side was raised to 60s
// when pdfplumber/openpyxl/pandas were added to the image, so this is
// 65s: the sandbox gets to be the one that decides a run took too long,
// and this client only catches the case where it never answers at all.
// Same provisional status as the sandbox side — not a measured number.
const EXECUTION_TIMEOUT_MS = 65000;
// A call with `outputFile` set runs a second phase after the script
// finishes: the sandbox's own recalc.py round-trips the file through
// LibreOffice (its own internal timeout is 120s) before this response
// ever comes back. 65s is nowhere near enough budget for that second
// phase, so a call requesting a file needs its own, larger timeout —
// this is a genuine, previously-unbudgeted cost the verification gate
// introduces, not an arbitrary bump. 210s = 60s script + 130s sandbox-
// side verification spawn timeout + margin. NOT measured against a real
// workbook — same provisional status as every other timeout in this
// file, flagged in bka/90-appendix/consumer-adaptation-flags.md.
//
// This also means a single /ai/ask HTTP request can now take up to 210s
// when a tool call generates a file. That is a real, unresolved UX/
// transport concern (browser and proxy timeouts, perceived hang) this
// slice does not solve — flagged, not silently absorbed.
const VERIFIED_EXECUTION_TIMEOUT_MS = 210000;
const MAX_CODE_CHARS = 20000;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB — one uploaded spreadsheet/CSV, not a media dump
const MAX_OUTPUT_CHARS = 20000; // bounds what lands in the LLM prompt, same reasoning as every other tool result cap
// A generated workbook returned FROM the sandbox — matches the sandbox
// service's own MAX_OUTPUT_FILE_BYTES. Checked again here as defense in
// depth: this client must never trust the sandbox's own cap alone to
// protect the backend process that then base64-decodes the response.
const MAX_RETURNED_FILE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_FILE_NAME_CHARS = 200;
const MAX_EXPECT_FORMULAS_IN_ENTRIES = 50;
const MAX_EXPECT_FORMULAS_IN_ENTRY_CHARS = 100;

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

// Cloud Run IAM invoker auth. With `--no-allow-unauthenticated`, Cloud
// Run rejects any request that does not carry a Google-signed ID token
// whose audience is the service's own URL — before the container is
// reached, and before the request is billed. That is the primary
// boundary; SANDBOX_SHARED_SECRET remains the second, independent layer
// so that a single misconfigured IAM policy cannot open the endpoint on
// its own.
//
// Built lazily and cached: getIdTokenClient() resolves credentials and
// does its own token refresh internally, so constructing one per
// execution would add a credential round-trip to every call. Not built
// at module load, because this module is required in deployments and
// tests that have no Google credentials at all and never call
// executeCode.
//
// Deliberately its OWN credential file (config.sandboxServiceCredentialsPath
// / SANDBOX_SERVICE_CREDENTIALS_PATH), never the ambient
// GOOGLE_APPLICATION_CREDENTIALS — that variable is already claimed by
// gemini.js/claude.js for the Gemini/Claude-on-Vertex ADC (see
// docker-compose.yml). Falling back to it here would mean every
// sandbox call authenticates as that broad Vertex-AI identity instead
// of the narrow run.invoker-only service account Cloud Run IAM expects
// — silently working (if that identity happens to also be an invoker)
// while defeating the whole point of a separate low-privilege invoker
// SA. `keyFile: undefined` when the path is unset falls through to
// GoogleAuth's own ADC search (still not GOOGLE_APPLICATION_CREDENTIALS-
// first in that search — this constructor argument always wins), which
// is what environments authenticating via Workload Identity rather than
// a key file (e.g. a future Cloud Run-hosted backend) want anyway.
let idTokenClientPromise = null;

function getIdTokenClient() {
  if (idTokenClientPromise === null) {
    idTokenClientPromise = new GoogleAuth({
      keyFile: config.sandboxServiceCredentialsPath || undefined,
    }).getIdTokenClient(config.sandboxServiceUrl);
  }
  return idTokenClientPromise;
}

// The headers for one /execute call. The shared secret always goes; the
// IAM bearer token only where this deployment actually sits behind
// Cloud Run IAM.
async function buildAuthHeaders() {
  const headers = {
    'content-type': 'application/json',
    'x-sandbox-auth': config.sandboxServiceToken,
  };
  if (!config.sandboxServiceIamAuth) return headers;
  let issued;
  try {
    const client = await getIdTokenClient();
    issued = await client.getRequestHeaders(config.sandboxServiceUrl);
  } catch (err) {
    // A credential fault is a deployment problem, not something the
    // model or the user can act on. Surfaced as its own message rather
    // than left to reach fetch() and come back as an opaque "sandbox
    // request failed", and never cached: a client that failed to build
    // must be rebuilt on the next call, not memoised as a rejection.
    idTokenClientPromise = null;
    throw new SandboxExecutionError(`sandbox IAM auth failed: ${err.message}`);
  }
  // google-auth-library returns a plain object here in v11 and a
  // Headers instance in later majors — normalise both.
  if (typeof issued.forEach === 'function' && typeof issued.get === 'function') {
    issued.forEach((value, key) => {
      headers[key] = value;
    });
  } else {
    Object.assign(headers, issued);
  }
  return headers;
}

function assertValidRequest(code, files, outputFile, expectFormulasIn) {
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
  if (outputFile !== undefined) {
    if (typeof outputFile !== 'string' || !outputFile.trim()) {
      throw new SandboxValidationError('outputFile must be a non-empty string when given');
    }
    if (outputFile.length > MAX_OUTPUT_FILE_NAME_CHARS) {
      throw new SandboxValidationError(`outputFile must be at most ${MAX_OUTPUT_FILE_NAME_CHARS} characters`);
    }
  }
  if (expectFormulasIn !== undefined) {
    if (!outputFile) {
      throw new SandboxValidationError('expectFormulasIn requires outputFile to also be given');
    }
    if (!Array.isArray(expectFormulasIn)) {
      throw new SandboxValidationError('expectFormulasIn must be an array of cell/range references');
    }
    if (expectFormulasIn.length > MAX_EXPECT_FORMULAS_IN_ENTRIES) {
      throw new SandboxValidationError(`expectFormulasIn must have at most ${MAX_EXPECT_FORMULAS_IN_ENTRIES} entries`);
    }
    expectFormulasIn.forEach((entry) => {
      if (typeof entry !== 'string' || !entry.trim() || entry.length > MAX_EXPECT_FORMULAS_IN_ENTRY_CHARS) {
        throw new SandboxValidationError('each expectFormulasIn entry must be a short, non-empty string');
      }
    });
  }
}

// Returns {stdout, stderr, exitCode, files, verification} — the
// sandbox's raw output, never trusted as instructions by anything
// downstream. This function does not itself apply the untrusted-data
// boundary; the caller (the execute_code AI tool) flows this return
// value through the same Context Builder / Prompt Safety Layer pipeline
// every other tool's result already goes through (RS-AIG-003) —
// identical to how fetchTrustedPage's own return value is handled,
// nothing special-cased here for having come from executed code rather
// than a fetched page.
//
// `files`/`verification` are always present in the shape (empty
// array/null) even for a plain call with no `outputFile` — a caller
// checking `result.files.length` never needs to know whether a file was
// even requested.
async function executeCode({ code, files, outputFile, expectFormulasIn }) {
  assertConfigured();
  assertValidRequest(code, files, outputFile, expectFormulasIn);

  const timeoutMs = outputFile ? VERIFIED_EXECUTION_TIMEOUT_MS : EXECUTION_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // Built BEFORE the try below, deliberately: a credential fault is
  // already a SandboxExecutionError with its own precise message, and
  // running it inside the try would let the catch re-wrap it into
  // "sandbox request failed: sandbox IAM auth failed: ..." — two
  // prefixes for one fault, the outer one wrong (no request was made).
  const headers = await buildAuthHeaders();
  let response;
  try {
    response = await fetch(`${config.sandboxServiceUrl}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        code,
        files: files || [],
        outputFile,
        expectFormulasIn,
      }),
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

  const returnedFiles = Array.isArray(result.files) ? result.files : [];
  returnedFiles.forEach((file) => {
    const approxBytes = ((file && file.contentBase64) || '').length * 0.75;
    if (approxBytes > MAX_RETURNED_FILE_BYTES) {
      throw new SandboxExecutionError(
        `sandbox returned a file exceeding the ${MAX_RETURNED_FILE_BYTES}-byte limit — this should have been rejected by the sandbox itself`,
      );
    }
  });

  return {
    stdout: String(result.stdout || '').slice(0, MAX_OUTPUT_CHARS),
    stderr: String(result.stderr || '').slice(0, MAX_OUTPUT_CHARS),
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
    files: returnedFiles.map((file) => ({ name: String(file.name), contentBase64: String(file.contentBase64) })),
    verification: result.verification || null,
  };
}

// File Intelligence Router (ai-chat-file-intelligence-router-approved-
// spec.md) — transcodeMedia/extractArchive below call the SAME /execute
// endpoint as executeCode above, but with `operation` set, which routes
// server.js onto its fixed transcode.py/extract_archive.py scripts
// instead of the arbitrary-`code` path (see server.js's own comment on
// why that distinction matters: the codec choice and archive safety
// bounds must stay developer-controlled, never LLM-influenced). These
// two functions are never exposed as an AI tool the model calls
// directly — they are invoked by attachmentIntelligenceService as part
// of the router's own processing pipeline, same as documentTextExtractionService
// is invoked by aiService today, not registered in aiToolRegistry.

const TRANSCODE_TIMEOUT_MS = 115000; // must stay >= server.js's own TRANSCODE_TIMEOUT_MS (110s)
const ARCHIVE_EXTRACT_TIMEOUT_MS = 65000; // must stay >= server.js's own ARCHIVE_EXTRACT_TIMEOUT_MS (60s)
const MAX_MEDIA_FILE_BYTES = 200 * 1024 * 1024; // one lecture recording/video, not a media dump
const TRANSCODE_TARGET_FORMATS = new Set(['audio_wav', 'video_mp4']);
const ARCHIVE_KINDS = new Set(['zip', 'tar', 'gzip']);

async function postSandboxOperation(payload, timeoutMs) {
  assertConfigured();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = await buildAuthHeaders();
  let response;
  try {
    response = await fetch(`${config.sandboxServiceUrl}/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
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
  return response.json();
}

// buffer/fileName are the ORIGINAL attachment's already-downloaded
// bytes (documentService.downloadDocument's own return shape) — this
// function does no storage I/O itself, matching every other stateless
// sandbox call in this file.
async function transcodeMedia({ buffer, fileName, targetFormat }) {
  if (!TRANSCODE_TARGET_FORMATS.has(targetFormat)) {
    throw new SandboxValidationError(`targetFormat must be one of ${[...TRANSCODE_TARGET_FORMATS].join(', ')}`);
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new SandboxValidationError('buffer is required and must be non-empty');
  }
  if (buffer.length > MAX_MEDIA_FILE_BYTES) {
    throw new SandboxValidationError(`file exceeds the ${MAX_MEDIA_FILE_BYTES}-byte limit`);
  }

  const result = await postSandboxOperation(
    {
      operation: 'transcode_media',
      targetFormat,
      files: [{ name: fileName || 'input', contentBase64: buffer.toString('base64') }],
    },
    TRANSCODE_TIMEOUT_MS,
  );

  if (result.status !== 'ok') {
    return { status: 'failed', reason: result.reason || 'transcode_failed', detail: result.detail || null };
  }
  const approxBytes = ((result.file && result.file.contentBase64) || '').length * 0.75;
  if (approxBytes > MAX_RETURNED_FILE_BYTES) {
    throw new SandboxExecutionError(
      `sandbox returned a transcoded file exceeding the ${MAX_RETURNED_FILE_BYTES}-byte limit — this should have been rejected by the sandbox itself`,
    );
  }
  return {
    status: 'ok',
    file: { name: String(result.file.name), buffer: Buffer.from(result.file.contentBase64, 'base64') },
  };
}

// Returns every extracted child as a real Buffer (never a caller-facing
// base64 string — same "decode once, at the boundary" discipline every
// other sandbox-facing function in this file already applies). A
// MAX_ARCHIVE_CHILDREN cap here is defense in depth alongside
// extract_archive.py's own 200-entry bound — this client must never
// trust the sandbox's own cap alone, same reasoning MAX_RETURNED_FILE_BYTES
// already documents above for executeCode.
const MAX_ARCHIVE_CHILDREN = 200;

async function extractArchive({ buffer, fileName, archiveKind }) {
  if (!ARCHIVE_KINDS.has(archiveKind)) {
    throw new SandboxValidationError(`archiveKind must be one of ${[...ARCHIVE_KINDS].join(', ')}`);
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new SandboxValidationError('buffer is required and must be non-empty');
  }
  if (buffer.length > MAX_MEDIA_FILE_BYTES) {
    throw new SandboxValidationError(`file exceeds the ${MAX_MEDIA_FILE_BYTES}-byte limit`);
  }

  const result = await postSandboxOperation(
    {
      operation: 'extract_archive',
      archiveKind,
      files: [{ name: fileName || 'archive', contentBase64: buffer.toString('base64') }],
    },
    ARCHIVE_EXTRACT_TIMEOUT_MS,
  );

  if (result.status !== 'ok') {
    return { status: 'failed', reason: result.reason || 'archive_extraction_failed', detail: result.detail || null };
  }
  const files = Array.isArray(result.files) ? result.files : [];
  if (files.length > MAX_ARCHIVE_CHILDREN) {
    throw new SandboxExecutionError(
      `sandbox returned more than ${MAX_ARCHIVE_CHILDREN} archive entries — this should have been rejected by the sandbox itself`,
    );
  }
  files.forEach((file) => {
    const approxBytes = ((file && file.contentBase64) || '').length * 0.75;
    if (approxBytes > MAX_RETURNED_FILE_BYTES) {
      throw new SandboxExecutionError(
        `sandbox returned an archive entry exceeding the ${MAX_RETURNED_FILE_BYTES}-byte limit — this should have been rejected by the sandbox itself`,
      );
    }
  });
  return {
    status: 'ok',
    files: files.map((file) => ({ name: String(file.name), buffer: Buffer.from(file.contentBase64, 'base64') })),
  };
}

module.exports = {
  SandboxNotConfiguredError,
  SandboxValidationError,
  SandboxExecutionError,
  EXECUTION_TIMEOUT_MS,
  VERIFIED_EXECUTION_TIMEOUT_MS,
  MAX_CODE_CHARS,
  MAX_FILE_BYTES,
  MAX_RETURNED_FILE_BYTES,
  executeCode,
  transcodeMedia,
  extractArchive,
};
