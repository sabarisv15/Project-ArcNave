'use strict';

// Structured JSON logs per Architecture.md's observability section —
// Node analogue of the deleted Python JSONFormatter (git history).
// Every call automatically picks up requestId/collegeId from the
// current AsyncLocalStorage context (logging/context.js) — no call
// site has to pass them, or even have access to `req` at all. Explicit
// `fields` are applied after the ambient context, so an explicit value
// wins over ambient on the rare case both set the same key — same
// precedent as the Python version's extra={} always winning.
//
// null/undefined values are omitted entirely, never emitted as
// `null` — an unresolved collegeId shouldn't show up as a literal
// null in every log line before a tenant is known.

const { getRequestContext } = require('./context');

function buildPayload(level, message, fields) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  const context = getRequestContext() || {};
  for (const [key, value] of Object.entries(context)) {
    if (value !== null && value !== undefined) payload[key] = value;
  }

  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value !== null && value !== undefined) payload[key] = value;
    }
  }

  return payload;
}

function logInfo(message, fields) {
  console.log(JSON.stringify(buildPayload('info', message, fields)));
}

function logWarn(message, fields) {
  console.warn(JSON.stringify(buildPayload('warn', message, fields)));
}

function logError(message, fields) {
  console.error(JSON.stringify(buildPayload('error', message, fields)));
}

module.exports = { logInfo, logWarn, logError };
