'use strict';

// ARCNAVE modernization P1 (PDF 4.2: "route inputs checked by hand" ->
// "a schema library"). zod, not a new dependency — already this
// project's own choice on the frontend (frontend/package.json), so
// this is the same validation vocabulary on both sides, not two.
//
// Scope, stated plainly: this middleware and the pattern it
// establishes are new; converting all ~336 existing routes' hand-
// written `req.body || {}` destructuring to a schema is its own
// large, separate pass (each route needs its exact existing behavior
// preserved, not just "a schema that looks about right") — not
// bundled into this one. routes/auth.js's /auth/login is the first
// real slice, demonstrating the full pattern end to end (schema ->
// middleware -> clean 400 -> the same route handler body, otherwise
// unchanged). See routes/openapi.js for how a route's schema also
// becomes real, generated API documentation — the other half of PDF
// 4.2/4.8.
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });
    if (!result.success) {
      res.status(400).json({
        detail: 'Invalid request',
        // z.treeifyError (zod v4) — a structured shape a real API
        // client can act on (which field, what went wrong), not just
        // a human-readable string to log and discard.
        errors: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    // Parsed, coerced values (e.g. a query-string "true" -> boolean)
    // replace the raw ones — every existing call site downstream that
    // reads req.body/req.params/req.query keeps working unchanged,
    // just now with validated/coerced data instead of raw strings.
    if (result.data.body !== undefined) req.body = result.data.body;
    if (result.data.params !== undefined) req.params = result.data.params;
    if (result.data.query !== undefined) req.query = result.data.query;
    next();
  };
}

module.exports = validate;
