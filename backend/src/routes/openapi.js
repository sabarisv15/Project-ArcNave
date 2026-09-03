'use strict';

// ARCNAVE modernization P1 (PDF 4.8: "no API contract... generate the
// client from the contract"). Real generated documentation, not
// hand-maintained prose: every route module that exports a `.schemas`
// map (see routes/auth.js's own bottom for the pattern) contributes
// its zod schema, converted to JSON Schema via zod's own built-in
// z.toJSONSchema() (no extra dependency) and assembled into a real
// OpenAPI 3.1 document at GET /api/v1/openapi.json.
//
// Scope, stated plainly (same as middleware/validate.js's own
// comment): this covers only the routes that have actually been
// migrated to a zod schema so far — P3 4.9 (contract tests on the
// noisiest routes) is extending this file-by-file (ai.js first, see
// CURRENT-STATE.md for the rest of the order). Converting every route
// is its own separate, larger pass; this route's own output is honest
// about that (only lists what it actually knows about, never a
// placeholder for the rest).

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const createAuthRouter = require('./auth');
const createAiRouter = require('./ai');
const createStudentsRouter = require('./students');
const createStaffRouter = require('./staff');
const createAttendanceRouter = require('./attendance');
const createDocumentsRouter = require('./documents');
const createPlatformRouter = require('./platform');
const createClassesRouter = require('./classes');
const createAssessmentsRouter = require('./assessments');

function buildOpenApiDocument() {
  const paths = {};

  // Each contributing router module's `.schemas` map is
  // { '/path': { post: zodSchema, get: zodSchema, ... } } — the
  // zodSchema itself is the `{ body, params, query }` wrapper
  // middleware/validate.js's `validate()` expects, so this reads the
  // exact same schema that actually enforces the route, never a
  // second, driftable copy.
  const contributors = [
    createAuthRouter,
    createAiRouter,
    createStudentsRouter,
    createStaffRouter,
    createAttendanceRouter,
    createDocumentsRouter,
    createPlatformRouter,
    createClassesRouter,
    createAssessmentsRouter,
  ];
  for (const router of contributors) {
    const schemas = router.schemas || {};
    for (const [routePath, methods] of Object.entries(schemas)) {
      paths[routePath] = paths[routePath] || {};
      for (const [method, schema] of Object.entries(methods)) {
        const shape = schema.shape || {};
        const requestBody = shape.body
          ? {
              content: {
                'application/json': {
                  schema: z.toJSONSchema(shape.body),
                },
              },
            }
          : undefined;
        paths[routePath][method] = {
          requestBody,
          responses: {
            200: { description: 'Success' },
            400: { description: 'Invalid request (schema validation failed)' },
          },
        };
      }
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'ARCNAVE API',
      version: '1.0.0',
      description:
        "Generated from this codebase's own zod schemas (ARCNAVE modernization P1, PDF 4.8) — currently covers " +
        `${Object.keys(paths).length} route(s), the ones migrated to a schema so far. Not yet a complete API contract.`,
    },
    servers: [{ url: '/api/v1' }],
    paths,
  };
}

function createOpenApiRouter() {
  const router = express.Router();

  router.get(
    '/openapi.json',
    asyncHandler(async (req, res) => {
      res.json(buildOpenApiDocument());
    }),
  );

  return router;
}

module.exports = createOpenApiRouter;
