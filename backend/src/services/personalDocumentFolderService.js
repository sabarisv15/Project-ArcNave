'use strict';

// Business logic for `personal_document_folders` — the real, listable,
// creatable folder object a staff member's own Documents > Personal
// tab needs (see the migration's own comment for why documents.
// folder_name alone can't do this: a text column on a document row
// can't exist independent of a document). Self-scoped only, same
// "requireAuth alone is enough" shape uploadPersonalDocument already
// uses — there is nothing here a caller could forge beyond their own
// folder list, since ownerUserId always comes from the actor, never
// the request body.

const personalDocumentFolderRepository = require('../repositories/personalDocumentFolderRepository');

class PersonalDocumentFolderValidationError extends Error {}
class PersonalDocumentFolderConflictError extends Error {}
class PersonalDocumentFolderNotFoundError extends Error {}
class PersonalDocumentFolderForbiddenError extends Error {}

// A move/create-under-parent whose parentId doesn't resolve to a real
// folder this same actor owns — kept distinct from NotFound (the
// folder BEING moved not existing) so a route/caller can tell "you
// named a folder that isn't there" apart from "the target you're
// moving it into isn't there."
class PersonalDocumentFolderParentNotFoundError extends Error {}

// moveFolder was asked to move a folder into itself or into one of its
// own descendants — the nested-tree version of documentsData.js's own
// canMoveInto() guard (frontend/src/lib/documentsData.js), enforced
// here for real since a client-side-only check can't be trusted.
class PersonalDocumentFolderCycleError extends Error {}

async function assertOwnedFolder(client, id, actorUserId) {
  const folder = await personalDocumentFolderRepository.findById(client, id);
  if (folder === null) {
    throw new PersonalDocumentFolderNotFoundError(`personal document folder ${JSON.stringify(id)} does not exist`);
  }
  if (folder.owner_user_id !== actorUserId) {
    throw new PersonalDocumentFolderForbiddenError(`user ${JSON.stringify(actorUserId)} does not own folder ${JSON.stringify(id)}`);
  }
  return folder;
}

async function assertValidParent(client, parentId, { actorUserId, excludeId } = {}) {
  if (parentId === null || parentId === undefined) return;
  if (parentId === excludeId) {
    throw new PersonalDocumentFolderCycleError('a folder cannot be its own parent');
  }
  const parent = await personalDocumentFolderRepository.findById(client, parentId);
  if (parent === null || parent.owner_user_id !== actorUserId) {
    throw new PersonalDocumentFolderParentNotFoundError(`personal document folder ${JSON.stringify(parentId)} does not exist`);
  }
  if (excludeId === undefined) return;
  // Walk the parent's own ancestor chain — if excludeId (the folder
  // being moved) appears in it, this move would create a cycle. Same
  // bounded-walk shape documentService.assertNoLineageCycle already
  // uses for the unrelated lineage-cycle problem.
  let cursor = parent.parent_id;
  const seen = new Set([parent.id]);
  while (cursor) {
    if (cursor === excludeId) {
      throw new PersonalDocumentFolderCycleError('moving this folder here would create a cycle');
    }
    if (seen.has(cursor)) break; // defensive: never trust a chain to be acyclic already
    seen.add(cursor);
    // eslint-disable-next-line no-await-in-loop
    const row = await personalDocumentFolderRepository.findById(client, cursor);
    cursor = row ? row.parent_id : null;
  }
}

async function createFolder(client, { name, parentId }, { actorUserId, collegeId }) {
  if (!name || !String(name).trim()) {
    throw new PersonalDocumentFolderValidationError('name is required');
  }
  const trimmed = name.trim();

  await assertValidParent(client, parentId, { actorUserId });

  try {
    return await personalDocumentFolderRepository.create(client, {
      collegeId, ownerUserId: actorUserId, name: trimmed, parentId: parentId ?? null,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new PersonalDocumentFolderConflictError(`a folder named ${JSON.stringify(trimmed)} already exists`);
    }
    throw err;
  }
}

async function listFolders(client, { actorUserId }) {
  return personalDocumentFolderRepository.listByOwner(client, actorUserId);
}

// Rename and/or move in one call — a caller (the frontend's single
// "Rename" or "Move to..." action) only ever sends the one field it
// actually changed; the repository's own entries-filter leaves the
// other untouched, same "only update what was actually passed" shape
// documentRepository.update already uses.
async function updateFolder(client, id, { name, parentId }, { actorUserId }) {
  await assertOwnedFolder(client, id, actorUserId);

  if (name !== undefined && !String(name).trim()) {
    throw new PersonalDocumentFolderValidationError('name is required');
  }
  if (parentId !== undefined) {
    await assertValidParent(client, parentId, { actorUserId, excludeId: id });
  }

  try {
    return await personalDocumentFolderRepository.update(client, id, {
      name: name !== undefined ? name.trim() : undefined,
      parentId,
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new PersonalDocumentFolderConflictError(`a folder named ${JSON.stringify(name)} already exists`);
    }
    throw err;
  }
}

async function removeFolder(client, id, { actorUserId }) {
  await assertOwnedFolder(client, id, actorUserId);
  await personalDocumentFolderRepository.remove(client, id);
}

module.exports = {
  PersonalDocumentFolderValidationError,
  PersonalDocumentFolderConflictError,
  PersonalDocumentFolderNotFoundError,
  PersonalDocumentFolderForbiddenError,
  PersonalDocumentFolderParentNotFoundError,
  PersonalDocumentFolderCycleError,
  createFolder,
  listFolders,
  updateFolder,
  removeFolder,
};
