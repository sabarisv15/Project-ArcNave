'use strict';

// AI Artifacts (ADL-032) — structured, editable AI-generated content,
// owned here as ordinary DB rows, not by DocumentService (ADR-009
// Amendment 1, docs/bka/30-decisions/adr-register.md). Only
// publishArtifact below ever calls documentService — the single writer
// boundary ADR-009 Amendment 1 records; no other function in this file
// touches DocumentService or documentRepository (CLAUDE.md rule 4).
//
// Private to the creating user, same shape as
// personalNoteService.js/projectService.js/conversationService.js —
// not institutional visibility, no visibilityService involvement.
//
// Publish is terminal in v1: once status is 'published', both
// updateArtifact and deleteArtifact reject with
// ArtifactAlreadyPublishedError. This keeps a published artifact's
// provenance traceable back from the real documents row and avoids
// designing edit-after-publish/republish reconciliation this pass.

const artifactRepository = require('../repositories/artifactRepository');
const artifactVersionRepository = require('../repositories/artifactVersionRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const documentService = require('./documentService');
const markdownFormatConverter = require('../generators/markdownFormatConverter');

class ArtifactValidationError extends Error {}
class ArtifactNotFoundError extends Error {}
class ArtifactForbiddenError extends Error {}
class ArtifactAlreadyPublishedError extends Error {}

function assertOwnedBy(artifact, actorUserId) {
  if (artifact.user_id !== actorUserId) {
    throw new ArtifactForbiddenError(`user ${JSON.stringify(actorUserId)} does not own artifact ${JSON.stringify(artifact.id)}`);
  }
}

function assertNotDeleted(artifact) {
  if (artifact.deleted_at !== null) {
    throw new ArtifactNotFoundError(`artifact ${JSON.stringify(artifact.id)} does not exist`);
  }
}

function assertNotPublished(artifact) {
  if (artifact.status === 'published') {
    throw new ArtifactAlreadyPublishedError(`artifact ${JSON.stringify(artifact.id)} is already published and cannot be changed`);
  }
}

async function resolveOwnArtifact(client, id, actorUserId) {
  const artifact = await artifactRepository.findById(client, id);
  if (artifact === null) {
    throw new ArtifactNotFoundError(`artifact ${JSON.stringify(id)} does not exist`);
  }
  assertOwnedBy(artifact, actorUserId);
  assertNotDeleted(artifact);
  return artifact;
}

async function listOwnArtifacts(client, { userId, limit, offset }) {
  return artifactRepository.listByUser(client, userId, { limit, offset });
}

async function getOwnArtifact(client, id, { userId }) {
  return resolveOwnArtifact(client, id, userId);
}

async function listOwnArtifactVersions(client, id, { userId }) {
  await resolveOwnArtifact(client, id, userId);
  return artifactVersionRepository.listByArtifact(client, id);
}

async function createArtifact(client, {
  title, content, conversationId, sourceMessageId, artifactType,
}, { userId, collegeId }) {
  const trimmedTitle = (title || '').trim();
  if (!trimmedTitle) {
    throw new ArtifactValidationError('title is required');
  }
  if (!content || !String(content).trim()) {
    throw new ArtifactValidationError('content is required');
  }

  const artifact = await artifactRepository.create(client, {
    collegeId,
    userId,
    conversationId: conversationId || null,
    sourceMessageId: sourceMessageId || null,
    title: trimmedTitle,
    artifactType: artifactType || null,
    content,
    versionNumber: 1,
  });

  await artifactVersionRepository.create(client, {
    collegeId,
    artifactId: artifact.id,
    versionNumber: 1,
    content,
    createdByUserId: userId,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId,
    action: 'artifact_created',
    entity: 'artifact',
    entityId: artifact.id,
    metadata: null,
  });

  return artifact;
}

async function updateArtifact(client, id, { title, content, conversationId }, { userId }) {
  const existing = await resolveOwnArtifact(client, id, userId);
  assertNotPublished(existing);

  if (title !== undefined && !String(title).trim()) {
    throw new ArtifactValidationError('title may not be cleared to empty');
  }
  if (content !== undefined && !String(content).trim()) {
    throw new ArtifactValidationError('content may not be cleared to empty');
  }

  // Links a revision chat created AFTER the artifact already exists (the
  // template-first flow — ArtifactCreate.jsx creates the artifact with no
  // conversation, then a later message starts one) back onto the artifact
  // row. `createArtifact`'s own conversationId param only covers the
  // opposite direction (an artifact saved FROM an existing chat message);
  // without this, conversation_id stayed null forever for a
  // template-created artifact, so ArtifactEditor's revision chat only ever
  // existed in the current browser's react-query cache — gone on reload.
  const patch = { title };
  if (conversationId !== undefined) patch.conversationId = conversationId;
  const contentChanged = content !== undefined && content !== existing.content;
  if (contentChanged) {
    patch.content = content;
    patch.versionNumber = existing.version_number + 1;
  }

  const artifact = await artifactRepository.update(client, id, patch);

  if (contentChanged) {
    await artifactVersionRepository.create(client, {
      collegeId: existing.college_id,
      artifactId: id,
      versionNumber: artifact.version_number,
      content,
      createdByUserId: userId,
    });
  }

  return artifact;
}

async function deleteArtifact(client, id, { userId }) {
  const existing = await resolveOwnArtifact(client, id, userId);
  assertNotPublished(existing);

  await artifactRepository.update(client, id, { deletedAt: new Date() });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: existing.college_id,
    userId,
    action: 'artifact_deleted',
    entity: 'artifact',
    entityId: id,
    metadata: null,
  });
}

// Converts an artifact's markdown `content` into the requested export
// format, wrapping markdownFormatConverter's own error (e.g. "no table to
// export as csv") into this file's existing ArtifactValidationError —
// callers (routes/artifacts.js, aiToolRegistry.js) already know how to
// map that one error class, no second mechanism needed.
async function convertContent(title, content, format) {
  try {
    return await markdownFormatConverter.convert({ title, markdown: content }, format || 'markdown');
  } catch (err) {
    if (err instanceof markdownFormatConverter.MarkdownConversionError) {
      throw new ArtifactValidationError(err.message);
    }
    throw err;
  }
}

// `format` is optional (default 'markdown' — byte-identical to this
// function's own pre-existing behavior for every caller that omits it).
// Still terminal/one-shot per ADR-009 Amendment 1: this only changes
// which byte format the one canonical published document lands in, never
// the "publish once" rule itself — see exportArtifactAs below for the
// separate, repeatable "give me this AS a different format too" action.
async function publishArtifact(client, id, { userId, collegeId, format }) {
  const existing = await resolveOwnArtifact(client, id, userId);
  assertNotPublished(existing);

  const { buffer, mimeType, extension } = await convertContent(existing.title, existing.content, format);

  const document = await documentService.uploadPersonalDocument(client, {
    collegeId,
    title: existing.title,
    folderName: 'AI Artifacts',
    fileName: `${existing.title}.${extension}`,
    mimeType,
    fileBuffer: buffer,
  }, { actorUserId: userId });

  const artifact = await artifactRepository.update(client, id, {
    status: 'published',
    publishedDocumentId: document.id,
    publishedAt: new Date(),
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId,
    action: 'artifact_published',
    entity: 'artifact',
    entityId: id,
    metadata: { documentId: document.id, format: format || 'markdown' },
  });

  // document_file_name/document_mime_type are not real columns on the
  // artifacts table — they ride along on this returned object only so
  // aiService.js's extractDocumentAttachment (which builds the chat UI's
  // downloadable-file card) never has to re-derive/guess the format this
  // call actually used, now that format is caller-chosen rather than
  // always markdown.
  return { ...artifact, document_file_name: document.file_name, document_mime_type: document.mime_type };
}

// The retroactive "now give me this AS docx/pdf/..." action — unlike
// publishArtifact above, this works on ANY owned artifact regardless of
// publish status (draft or already-published), and never touches the
// artifact's own status/publishedDocumentId: it always creates a NEW,
// separate DocumentService document, exactly like asking Google Docs to
// "download as" a second format leaves the original untouched. Audited
// under a distinct action (artifact_exported, not artifact_published) so
// the two are never conflated in the audit trail.
async function exportArtifactAs(client, id, format, { userId, collegeId }) {
  const existing = await resolveOwnArtifact(client, id, userId);

  const { buffer, mimeType, extension } = await convertContent(existing.title, existing.content, format);

  const document = await documentService.uploadPersonalDocument(client, {
    collegeId,
    title: existing.title,
    folderName: 'AI Artifacts',
    fileName: `${existing.title}.${extension}`,
    mimeType,
    fileBuffer: buffer,
  }, { actorUserId: userId });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId,
    action: 'artifact_exported',
    entity: 'artifact',
    entityId: id,
    metadata: { documentId: document.id, format },
  });

  return document;
}

// attachGeneratedFile — the consumer-tool-adaptation file-generation
// slice (2026-08-26, see migration 1763600000000). Distinct from
// publishArtifact above in the one way that matters: publishArtifact
// converts THIS artifact's own markdown content via
// markdownFormatConverter; this attaches bytes that came from somewhere
// else entirely (the ADL-059 sandbox, e.g. an openpyxl/LibreOffice-
// produced xlsx) — the artifact's `content` never held them and never
// will. That is also why this does not call assertNotPublished: publish
// and generation are separate lifecycles on the same row (separate
// columns, see the migration's own comment), so a published artifact
// can still receive a later generated file and vice versa.
//
// The gate is enforced HERE, not in the tool handler that calls this,
// on purpose — CLAUDE.md rule 1 puts the real check in the Business
// Service, and `verification` must be the FULL report object, never a
// bare boolean: a caller that could pass `{passed: true}` on its own
// has defeated the entire gate this function exists to enforce. There
// is no "attach anyway" override in this slice.
async function attachGeneratedFile(client, id, {
  buffer, fileName, mimeType, verification,
}, { userId, collegeId }) {
  const existing = await resolveOwnArtifact(client, id, userId);

  if (!verification || typeof verification !== 'object' || typeof verification.passed !== 'boolean') {
    throw new ArtifactValidationError('verification must be the full verification report object, not a boolean or omitted');
  }
  if (!verification.passed) {
    throw new ArtifactValidationError(
      `generated file failed verification (${verification.verdict || 'unknown'}: ${verification.reason || 'no reason given'}) and was not attached`,
    );
  }

  const document = await documentService.uploadPersonalDocument(client, {
    collegeId,
    title: existing.title,
    folderName: 'AI Artifacts',
    fileName,
    mimeType,
    fileBuffer: buffer,
  }, { actorUserId: userId });

  const artifact = await artifactRepository.update(client, id, {
    generatedDocumentId: document.id,
    generationVerified: true,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId,
    userId,
    action: 'artifact_file_generated',
    entity: 'artifact',
    entityId: id,
    metadata: { documentId: document.id, verdict: verification.verdict },
  });

  // Same document_file_name/document_mime_type convention
  // publishArtifact's own return already establishes, plus
  // generatedDocumentId (camelCase — not a real column read, just this
  // function naming which id field aiService.js's extractDocumentAttachment
  // should key off, distinct from publishArtifact's published_document_id
  // so the two paths are never confused for one another).
  return {
    ...artifact,
    generatedDocumentId: document.id,
    document_file_name: document.file_name,
    document_mime_type: document.mime_type,
  };
}

module.exports = {
  ArtifactValidationError,
  ArtifactNotFoundError,
  ArtifactForbiddenError,
  ArtifactAlreadyPublishedError,
  listOwnArtifacts,
  getOwnArtifact,
  listOwnArtifactVersions,
  createArtifact,
  updateArtifact,
  deleteArtifact,
  publishArtifact,
  exportArtifactAs,
  attachGeneratedFile,
};
