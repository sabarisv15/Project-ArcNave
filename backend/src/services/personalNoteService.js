'use strict';

// Frontend-discovery gap (UAT Priority 1 #3, "Personal Notes"): private
// to the creating user. Every function here takes the acting user's id
// and enforces ownership itself — this is intentionally NOT reusing
// visibilityService (that file resolves shared institutional
// visibility; a personal note has no institutional visibility at all,
// not even to a principal).

const personalNoteRepository = require('../repositories/personalNoteRepository');

class PersonalNoteValidationError extends Error {}
class PersonalNoteNotFoundError extends Error {}
class PersonalNoteForbiddenError extends Error {}

function assertOwnedBy(note, actorUserId) {
  if (note.user_id !== actorUserId) {
    throw new PersonalNoteForbiddenError(`user ${JSON.stringify(actorUserId)} does not own note ${JSON.stringify(note.id)}`);
  }
}

async function createNote(client, {
  title, body, reminderAt, noteDate,
}, { actorUserId, collegeId }) {
  if (!body) {
    throw new PersonalNoteValidationError('body is required');
  }
  return personalNoteRepository.create(client, {
    collegeId,
    userId: actorUserId,
    title: title || null,
    body,
    reminderAt: reminderAt || null,
    noteDate: noteDate || null,
  });
}

async function findOwnedNote(client, id, actorUserId) {
  const note = await personalNoteRepository.findById(client, id);
  if (note === null) {
    throw new PersonalNoteNotFoundError(`note ${JSON.stringify(id)} does not exist`);
  }
  assertOwnedBy(note, actorUserId);
  return note;
}

async function updateNote(client, id, {
  title, body, reminderAt, isDone, noteDate,
}, { actorUserId }) {
  await findOwnedNote(client, id, actorUserId);
  if (body === '') {
    throw new PersonalNoteValidationError('body may not be cleared to empty');
  }
  return personalNoteRepository.update(client, id, {
    title, body, reminderAt, isDone, noteDate,
  });
}

async function deleteNote(client, id, { actorUserId }) {
  await findOwnedNote(client, id, actorUserId);
  await personalNoteRepository.remove(client, id);
}

async function listNotes(client, { actorUserId }) {
  return personalNoteRepository.listByUser(client, actorUserId);
}

// ADL-030 — the calendar grid's own read, a date-range window rather
// than the full flat list listNotes above still serves (e.g. any
// remaining reminder-only-no-date consumer).
async function listNotesInRange(client, { actorUserId, fromDate, toDate }) {
  if (!fromDate || !toDate) {
    throw new PersonalNoteValidationError('fromDate and toDate are required');
  }
  return personalNoteRepository.listByUserAndDateRange(client, actorUserId, fromDate, toDate);
}

module.exports = {
  PersonalNoteValidationError,
  PersonalNoteNotFoundError,
  PersonalNoteForbiddenError,
  createNote,
  updateNote,
  deleteNote,
  listNotes,
  listNotesInRange,
};
