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

async function createFolder(client, { name }, { actorUserId, collegeId }) {
  if (!name || !String(name).trim()) {
    throw new PersonalDocumentFolderValidationError('name is required');
  }
  const trimmed = name.trim();

  try {
    return await personalDocumentFolderRepository.create(client, {
      collegeId, ownerUserId: actorUserId, name: trimmed,
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

async function removeFolder(client, id, { actorUserId }) {
  const folder = await personalDocumentFolderRepository.findById(client, id);
  if (folder === null) {
    throw new PersonalDocumentFolderNotFoundError(`personal document folder ${JSON.stringify(id)} does not exist`);
  }
  if (folder.owner_user_id !== actorUserId) {
    throw new PersonalDocumentFolderForbiddenError(`user ${JSON.stringify(actorUserId)} does not own folder ${JSON.stringify(id)}`);
  }
  await personalDocumentFolderRepository.remove(client, id);
}

module.exports = {
  PersonalDocumentFolderValidationError,
  PersonalDocumentFolderConflictError,
  PersonalDocumentFolderNotFoundError,
  PersonalDocumentFolderForbiddenError,
  createFolder,
  listFolders,
  removeFolder,
};
