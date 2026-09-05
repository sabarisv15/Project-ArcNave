'use strict';

const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/rbac');
const documentTypeRegistryRepository = require('../repositories/documentTypeRegistryRepository');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

// Registry metadata only (no per-college data, no writes) — requireAuth
// is enough, same "reads are open" shape document-categories.js already
// uses for its own read route. Repository called directly, not through
// a service: there is no business logic here at all, just an ordered
// SELECT (CLAUDE.md rule 1 governs AI tool calls and mutations; a plain
// registry read has nothing for a service layer to add).
// module stays optional here (not required) even though the handler
// itself 400s on a missing value — the handler's own check/message is
// preserved unchanged; this layer only rejects a wrong-typed value.
const listDocumentTypesSchema = z.object({
  query: z.object({ module: z.string().optional() }).optional(),
});

function createDocumentTypesRouter() {
  const router = express.Router();

  router.get(
    '/document-types',
    requireAuth,
    validate(listDocumentTypesSchema),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const moduleName = req.query.module;
      if (!moduleName) {
        res.status(400).json({ detail: 'module query parameter is required' });
        return;
      }
      const rows = await documentTypeRegistryRepository.findByModule(req.dbClient, moduleName);
      res.json(rows);
    }),
  );

  return router;
}

module.exports = createDocumentTypesRouter;
module.exports.schemas = {
  '/document-types': { get: listDocumentTypesSchema },
};
