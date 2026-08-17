'use strict';

// Unit tests for ConversationService's pure business-logic paths — no
// live Postgres needed, same mocking convention as
// staff-work-history-service.test.js. The `messages_touch_conversation`
// trigger (updated_at/message_count/last_message_preview) is a real-DB
// concern, verified separately, not here.

const test = require('node:test');
const assert = require('node:assert/strict');
const conversationRepository = require('../src/repositories/conversationRepository');
const messageRepository = require('../src/repositories/messageRepository');
const conversationService = require('../src/services/conversationService');

test('ConversationService (no DB)', async (t) => {
  await t.test('listOwnConversations passes projectId/search/archived/limit/offset straight through', async () => {
    const listMock = t.mock.method(conversationRepository, 'listByUser', async (client, userId, opts) => {
      assert.equal(userId, 'u1');
      assert.deepEqual(opts, {
        projectId: 'p1', search: 'exam', archived: true, limit: 10, offset: 5,
      });
      return [];
    });
    t.after(() => listMock.mock.restore());

    await conversationService.listOwnConversations({}, {
      userId: 'u1', projectId: 'p1', search: 'exam', archived: true, limit: 10, offset: 5,
    });
    assert.equal(listMock.mock.calls.length, 1);
  });

  await t.test('listMessages passes limit/offset straight through to messageRepository', async () => {
    const findMock = t.mock.method(conversationRepository, 'findById', async () => ({ id: 'conv1', user_id: 'u1' }));
    const listMock = t.mock.method(messageRepository, 'listByConversation', async (client, conversationId, opts) => {
      assert.equal(conversationId, 'conv1');
      assert.deepEqual(opts, { limit: 20, offset: 10 });
      return [];
    });
    t.after(() => { findMock.mock.restore(); listMock.mock.restore(); });

    await conversationService.listMessages({}, 'conv1', { userId: 'u1', limit: 20, offset: 10 });
    assert.equal(listMock.mock.calls.length, 1);
  });

  await t.test('listMessages with no limit/offset passes undefined through, not a default — the full transcript is still returned', async () => {
    const findMock = t.mock.method(conversationRepository, 'findById', async () => ({ id: 'conv1', user_id: 'u1' }));
    const listMock = t.mock.method(messageRepository, 'listByConversation', async (client, conversationId, opts) => {
      assert.deepEqual(opts, { limit: undefined, offset: undefined });
      return [];
    });
    t.after(() => { findMock.mock.restore(); listMock.mock.restore(); });

    await conversationService.listMessages({}, 'conv1', { userId: 'u1' });
  });

  await t.test('resolveOwnConversation throws ConversationForbiddenError for another user\'s conversation', async () => {
    const findMock = t.mock.method(conversationRepository, 'findById', async () => ({ id: 'conv1', user_id: 'OTHER' }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => conversationService.listMessages({}, 'conv1', { userId: 'u1' }),
      conversationService.ConversationForbiddenError,
    );
  });

  await t.test('addMessage rejects an invalid role', async () => {
    const findMock = t.mock.method(conversationRepository, 'findById', async () => ({ id: 'conv1', user_id: 'u1' }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => conversationService.addMessage({}, 'conv1', { role: 'system', content: 'hi' }, { userId: 'u1', collegeId: 'c1' }),
      conversationService.ConversationValidationError,
    );
  });

  await t.test('addMessage rejects empty content', async () => {
    const findMock = t.mock.method(conversationRepository, 'findById', async () => ({ id: 'conv1', user_id: 'u1' }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => conversationService.addMessage({}, 'conv1', { role: 'user', content: '  ' }, { userId: 'u1', collegeId: 'c1' }),
      conversationService.ConversationValidationError,
    );
  });

  await t.test('addMessage writes a user message with parentMessageId/toolParams passed through', async () => {
    const findMock = t.mock.method(conversationRepository, 'findById', async () => ({ id: 'conv1', user_id: 'u1' }));
    const createMock = t.mock.method(messageRepository, 'create', async (client, fields) => {
      assert.deepEqual(fields, {
        collegeId: 'c1',
        conversationId: 'conv1',
        parentMessageId: null,
        role: 'user',
        content: 'invoke a tool',
        toolUsed: 'list_students',
        toolParams: { classId: 'cls1' },
        presentation: null,
        rawData: null,
      });
      return { id: 'm1', ...fields };
    });
    t.after(() => { findMock.mock.restore(); createMock.mock.restore(); });

    const result = await conversationService.addMessage({}, 'conv1', {
      role: 'user', content: 'invoke a tool', toolUsed: 'list_students', toolParams: { classId: 'cls1' },
    }, { userId: 'u1', collegeId: 'c1' });
    assert.equal(result.id, 'm1');
  });

  await t.test('addMessage writes an assistant message with a real parentMessageId', async () => {
    const findMock = t.mock.method(conversationRepository, 'findById', async () => ({ id: 'conv1', user_id: 'u1' }));
    const createMock = t.mock.method(messageRepository, 'create', async (client, fields) => {
      assert.equal(fields.parentMessageId, 'm1');
      assert.equal(fields.role, 'assistant');
      return { id: 'm2', ...fields };
    });
    t.after(() => { findMock.mock.restore(); createMock.mock.restore(); });

    await conversationService.addMessage({}, 'conv1', {
      role: 'assistant', content: 'here are the students', parentMessageId: 'm1',
    }, { userId: 'u1', collegeId: 'c1' });
    assert.equal(createMock.mock.calls.length, 1);
  });

  await t.test('updateConversation rejects clearing title to empty', async () => {
    const findMock = t.mock.method(conversationRepository, 'findById', async () => ({ id: 'conv1', user_id: 'u1' }));
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => conversationService.updateConversation({}, 'conv1', { title: '  ' }, { userId: 'u1' }),
      conversationService.ConversationValidationError,
    );
  });

  await t.test('updateConversation can pin/archive without touching title', async () => {
    const findMock = t.mock.method(conversationRepository, 'findById', async () => ({ id: 'conv1', user_id: 'u1' }));
    const updateMock = t.mock.method(conversationRepository, 'update', async (client, id, fields) => {
      assert.deepEqual(fields, {
        title: undefined, projectId: undefined, pinned: true, archived: undefined,
      });
      return { id, ...fields };
    });
    t.after(() => { findMock.mock.restore(); updateMock.mock.restore(); });

    await conversationService.updateConversation({}, 'conv1', { pinned: true }, { userId: 'u1' });
    assert.equal(updateMock.mock.calls.length, 1);
  });
});
