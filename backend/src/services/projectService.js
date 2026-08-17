'use strict';

// AI chat Projects (ADL-032) — private to the creating user, same
// "not institutional visibility, not even to a principal" shape as
// personalNoteService.js, and deliberately not reusing
// visibilityService for that reason. No audit logging — same category
// as personal_notes (private productivity data, no downstream
// effect); personalNoteService.js is the existing precedent for not
// auditing this kind of self-owned resource.

const projectRepository = require('../repositories/projectRepository');
const projectDocumentRepository = require('../repositories/projectDocumentRepository');
const documentService = require('./documentService');

class ProjectValidationError extends Error {}
class ProjectNotFoundError extends Error {}
class ProjectForbiddenError extends Error {}
class ProjectDocumentAlreadyAttachedError extends Error {}

function assertOwnedBy(project, actorUserId) {
  if (project.user_id !== actorUserId) {
    throw new ProjectForbiddenError(`user ${JSON.stringify(actorUserId)} does not own project ${JSON.stringify(project.id)}`);
  }
}

async function resolveOwnProject(client, id, actorUserId) {
  const project = await projectRepository.findById(client, id);
  if (project === null) {
    throw new ProjectNotFoundError(`project ${JSON.stringify(id)} does not exist`);
  }
  assertOwnedBy(project, actorUserId);
  return project;
}

async function listOwnProjects(client, { userId }) {
  return projectRepository.listByUser(client, userId);
}

async function createProject(client, { name }, { userId, collegeId }) {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    throw new ProjectValidationError('name is required');
  }
  return projectRepository.create(client, { collegeId, userId, name: trimmed });
}

// name and/or instructions and/or pinned — at least one must be given.
// Kept as one function (not separate rename/updateInstructions/setPinned
// calls) because all three are the same PUT /projects/:id endpoint,
// same as the human dashboard only ever has one "save" action on that
// row. `pinned` (ArcNave streaming design prototype gap closure,
// 2026-08-12) mirrors the Project Detail page's Pin toggle.
async function updateProject(client, id, { name, instructions, pinned }, { userId }) {
  await resolveOwnProject(client, id, userId);
  const fields = {};
  if (name !== undefined) {
    const trimmed = (name || '').trim();
    if (!trimmed) {
      throw new ProjectValidationError('name is required');
    }
    fields.name = trimmed;
  }
  if (instructions !== undefined) {
    fields.instructions = (instructions || '').trim() || null;
  }
  if (pinned !== undefined) {
    fields.pinned = Boolean(pinned);
  }
  if (Object.keys(fields).length === 0) {
    throw new ProjectValidationError('name or instructions or pinned is required');
  }
  return projectRepository.update(client, id, fields);
}

async function deleteProject(client, id, { userId }) {
  await resolveOwnProject(client, id, userId);
  await projectRepository.remove(client, id);
}

async function listProjectDocuments(client, id, { userId }) {
  await resolveOwnProject(client, id, userId);
  return projectDocumentRepository.listByProject(client, id);
}

// Reference-only (CLAUDE.md rule 2 / ADR-009 Amendment 1) — attaches a
// document the acting user already owns to their own project. Not a
// general "any visible document" picker: a project is private to its
// owner, so only documents that owner themselves uploaded may be
// attached, same-actor boundary as everything else on this service.
async function attachProjectDocument(client, id, { documentId }, { userId }) {
  const project = await resolveOwnProject(client, id, userId);
  const document = await documentService.getDocument(client, documentId);
  if (document === null) {
    throw new ProjectNotFoundError(`document ${JSON.stringify(documentId)} does not exist`);
  }
  if (document.uploaded_by_user_id !== userId) {
    throw new ProjectForbiddenError(`user ${JSON.stringify(userId)} does not own document ${JSON.stringify(documentId)}`);
  }
  const existing = await projectDocumentRepository.findByProjectAndDocument(client, id, documentId);
  if (existing !== null) {
    throw new ProjectDocumentAlreadyAttachedError(`document ${JSON.stringify(documentId)} is already attached to project ${JSON.stringify(id)}`);
  }
  return projectDocumentRepository.create(client, {
    collegeId: project.college_id, projectId: id, documentId, addedByUserId: userId,
  });
}

async function detachProjectDocument(client, id, documentId, { userId }) {
  await resolveOwnProject(client, id, userId);
  await projectDocumentRepository.remove(client, id, documentId);
}

module.exports = {
  ProjectValidationError,
  ProjectNotFoundError,
  ProjectForbiddenError,
  ProjectDocumentAlreadyAttachedError,
  listOwnProjects,
  createProject,
  updateProject,
  deleteProject,
  listProjectDocuments,
  attachProjectDocument,
  detachProjectDocument,
};
