'use strict';

// Business logic for `document_categories` — replaces documentService's
// old hardcoded INSTITUTIONAL_DOC_TYPES array with real, per-college,
// principal-managed data (Institutional Documents Phase 1). slug is
// derived from name, never caller-supplied directly, so it always
// stays a safe doc_type-compatible key (documentService sets
// documents.doc_type = category.slug at upload time) without asking
// an admin-user-facing form to understand that constraint.

const documentCategoryRepository = require('../repositories/documentCategoryRepository');
const { isUuid, IdentifierResolutionError } = require('../identifierResolution');

class DocumentCategoryValidationError extends Error {}
class DocumentCategoryConflictError extends Error {}

function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function createCategory(client, { collegeId, name }) {
  if (!name || !String(name).trim()) {
    throw new DocumentCategoryValidationError('name is required');
  }
  const slug = slugify(name);
  if (!slug) {
    throw new DocumentCategoryValidationError('name must contain at least one letter or digit');
  }

  try {
    return await documentCategoryRepository.create(client, { collegeId, name: name.trim(), slug });
  } catch (err) {
    if (err.code === '23505') {
      throw new DocumentCategoryConflictError(`a category named ${JSON.stringify(name)} already exists`);
    }
    throw err;
  }
}

async function listCategories(client) {
  return documentCategoryRepository.list(client);
}

async function getCategory(client, id) {
  return documentCategoryRepository.findById(client, id);
}

// resolveCategoryId: mirrors academicService.resolveClassId — given
// either a real category id or a human-readable category name (what
// ARCNAVE AI's own upload_institutional_document/resolve_document_
// destination tools have to go on, e.g. "Circulars"), returns the real
// id, or throws IdentifierResolutionError if neither resolves within
// this college.
async function resolveCategoryId(client, collegeId, identifier) {
  if (isUuid(identifier)) {
    return identifier;
  }
  const category = await documentCategoryRepository.findByCollegeAndName(client, collegeId, identifier);
  if (category === null) {
    throw new IdentifierResolutionError(
      `no document category found named ${JSON.stringify(identifier)} in this college`,
    );
  }
  return category.id;
}

module.exports = {
  DocumentCategoryValidationError,
  DocumentCategoryConflictError,
  createCategory,
  listCategories,
  getCategory,
  resolveCategoryId,
};
