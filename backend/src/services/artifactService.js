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
  title, content, conversationId, sourceMessageId,
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

async function updateArtifact(client, id, { title, content }, { userId }) {
  const existing = await resolveOwnArtifact(client, id, userId);
  assertNotPublished(existing);

  if (title !== undefined && !String(title).trim()) {
    throw new ArtifactValidationError('title may not be cleared to empty');
  }
  if (content !== undefined && !String(content).trim()) {
    throw new ArtifactValidationError('content may not be cleared to empty');
  }

  const patch = { title };
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

async function publishArtifact(client, id, { userId, collegeId }) {
  const existing = await resolveOwnArtifact(client, id, userId);
  assertNotPublished(existing);

  const document = await documentService.uploadPersonalDocument(client, {
    collegeId,
    title: existing.title,
    folderName: 'AI Artifacts',
    fileName: `${existing.title}.md`,
    mimeType: 'text/markdown',
    fileBuffer: Buffer.from(existing.content, 'utf8'),
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
    metadata: { documentId: document.id },
  });

  return artifact;
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
};
