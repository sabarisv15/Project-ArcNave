'use strict';

// AI chat Conversations/Messages (ADL-032) — private to the creating
// user, same shape as personalNoteService.js/projectService.js. No
// audit logging on message append — high-frequency, no downstream
// side effect, same reasoning personalNoteService.js already
// establishes for not auditing note edits.
//
// A conversation's project_id is not cross-checked against the
// caller's own projects here on create/update — an invalid/foreign
// project_id simply fails the FK constraint at the DB level (a
// Postgres error, not a friendly ProjectNotFoundError) exactly like
// every other repository in this codebase that accepts a foreign-key
// id without a pre-check (e.g. classesApi.assignTutor's
// newTutorUserId). Not treated as a gap worth closing this pass.

const conversationRepository = require('../repositories/conversationRepository');
const messageRepository = require('../repositories/messageRepository');

class ConversationValidationError extends Error {}
class ConversationNotFoundError extends Error {}
class ConversationForbiddenError extends Error {}

const VALID_ROLES = ['user', 'assistant'];

function assertOwnedBy(conversation, actorUserId) {
  if (conversation.user_id !== actorUserId) {
    throw new ConversationForbiddenError(`user ${JSON.stringify(actorUserId)} does not own conversation ${JSON.stringify(conversation.id)}`);
  }
}

async function resolveOwnConversation(client, id, actorUserId) {
  const conversation = await conversationRepository.findById(client, id);
  if (conversation === null) {
    throw new ConversationNotFoundError(`conversation ${JSON.stringify(id)} does not exist`);
  }
  assertOwnedBy(conversation, actorUserId);
  return conversation;
}

async function listOwnConversations(client, {
  userId, projectId, search, archived, limit, offset,
}) {
  return conversationRepository.listByUser(client, userId, {
    projectId, search, archived, limit, offset,
  });
}

async function createConversation(client, { title, projectId }, { userId, collegeId }) {
  return conversationRepository.create(client, {
    collegeId,
    userId,
    projectId: projectId || null,
    title: title || undefined,
  });
}

async function updateConversation(client, id, {
  title, projectId, pinned, archived,
}, { userId }) {
  await resolveOwnConversation(client, id, userId);
  if (title !== undefined && !String(title).trim()) {
    throw new ConversationValidationError('title may not be cleared to empty');
  }
  return conversationRepository.update(client, id, {
    title, projectId, pinned, archived,
  });
}

async function deleteConversation(client, id, { userId }) {
  await resolveOwnConversation(client, id, userId);
  await conversationRepository.remove(client, id);
}

async function listMessages(client, conversationId, { userId, limit, offset }) {
  await resolveOwnConversation(client, conversationId, userId);
  return messageRepository.listByConversation(client, conversationId, { limit, offset });
}

async function addMessage(client, conversationId, {
  role, content, toolUsed, toolParams, presentation, rawData, parentMessageId, attachments,
}, { userId, collegeId }) {
  await resolveOwnConversation(client, conversationId, userId);

  if (!VALID_ROLES.includes(role)) {
    throw new ConversationValidationError(`role must be one of ${JSON.stringify(VALID_ROLES)}`);
  }
  if (!content || !String(content).trim()) {
    throw new ConversationValidationError('content is required');
  }

  return messageRepository.create(client, {
    collegeId,
    conversationId,
    parentMessageId: parentMessageId || null,
    role,
    content,
    toolUsed: toolUsed || null,
    toolParams: toolParams || null,
    presentation: presentation || null,
    rawData: rawData !== undefined ? rawData : null,
    // The user's own sent files — small display objects
    // ({id, serverId, name, type, size}), not just documents.id values,
    // so a reloaded transcript can re-render the same SentFileChip
    // without a second lookup. Not authorization-checked here:
    // resolveChatAttachments already validated every one of these ids
    // belongs to this user/college before the AI turn that used them
    // ever ran — this is a display record of what was already sent, not
    // a new access grant.
    attachments: Array.isArray(attachments) && attachments.length > 0 ? attachments : null,
  });
}

// Real rewind (product decision, this round): edit an earlier USER
// message and delete everything that came after it in that conversation
// — the caller (routes/ai.js's normal /ai/ask(/stream) flow, driven from
// the frontend after this call succeeds) generates a fresh reply from
// the edited point, the same way a brand-new message would. Only a
// 'user' message may be edited: editing an assistant reply has no
// "rewind" meaning here, and would let a caller silently rewrite what
// the AI is recorded as having said.
async function editMessage(client, conversationId, messageId, { content }, { userId }) {
  await resolveOwnConversation(client, conversationId, userId);

  if (!content || !String(content).trim()) {
    throw new ConversationValidationError('content is required');
  }

  const message = await messageRepository.findById(client, messageId);
  if (!message || message.conversation_id !== conversationId) {
    throw new ConversationNotFoundError(`message ${JSON.stringify(messageId)} does not exist in conversation ${JSON.stringify(conversationId)}`);
  }
  if (message.role !== 'user') {
    throw new ConversationValidationError('only a user message can be edited');
  }

  const updated = await messageRepository.update(client, messageId, { content });
  // Strictly after the edited message's own (unchanged) created_at —
  // never touches the edited message itself, only what came after it.
  await messageRepository.deleteAfter(client, conversationId, updated.created_at);
  return updated;
}

module.exports = {
  ConversationValidationError,
  ConversationNotFoundError,
  ConversationForbiddenError,
  listOwnConversations,
  createConversation,
  updateConversation,
  deleteConversation,
  listMessages,
  addMessage,
  editMessage,
};
