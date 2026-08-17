'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/rbac');
const documentCategoryService = require('../services/documentCategoryService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function mapDocumentCategoryError(err, res) {
  if (err instanceof documentCategoryService.DocumentCategoryValidationError) {
    res.status(400).json({ detail: err.message });
    return true;
  }
  if (err instanceof documentCategoryService.DocumentCategoryConflictError) {
    res.status(409).json({ detail: err.message });
    return true;
  }
  return false;
}

// Institutional Documents Phase 1 — categories (Curriculum, Circulars,
// Academic Calendar, ...) are per-college data a principal manages,
// not a hardcoded list (see the migration's own file comment). Reads
// are requireAuth: every role that can upload/browse the institutional
// repository needs the category list to pick a destination or filter
// by it, same "reads are open, writes are gated" split every other
// router in this codebase draws.
function createDocumentCategoriesRouter() {
  const router = express.Router();

  router.get('/document-categories', requireAuth, asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    const categories = await documentCategoryService.listCategories(req.dbClient);
    res.json(categories);
  }));

  router.post('/document-categories', requirePermission('document_categories.manage'), asyncHandler(async (req, res) => {
    if (!requireResolvedTenant(req, res)) return;
    try {
      const category = await documentCategoryService.createCategory(
        req.dbClient,
        { collegeId: req.collegeId, name: (req.body || {}).name },
      );
      res.status(201).json(category);
    } catch (err) {
      if (mapDocumentCategoryError(err, res)) return;
      throw err;
    }
  }));

  return router;
}

module.exports = createDocumentCategoriesRouter;
