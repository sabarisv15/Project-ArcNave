'use strict';

// Unit tests for aiMemoryService — the consent gate is the one real safety
// property this service exists to hold (see the service's own file
// comment), so these focus on: consent required before remember, forget
// always allowed regardless of consent, revoking consent wipes stored
// memory, the bounded memory_type allowlist, and the value length cap. No
// live Postgres: aiMemoryRepository is stubbed via node:test's built-in mock,
// same pattern user-preference-service.test.js already establishes.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiMemoryRepository = require('../src/repositories/aiMemoryRepository');
const aiMemoryService = require('../src/services/aiMemoryService');

test('aiMemoryService.getConsent / setConsent', async (t) => {
  await t.test('getConsent with no row -> consented:false, not an error', async () => {
    const getMock = t.mock.method(aiMemoryRepository, 'getConsent', async () => null);
    t.after(() => getMock.mock.restore());

    const result = await aiMemoryService.getConsent({}, { actorUserId: 'u1' });
    assert.deepEqual(result, { consented: false, consentedAt: null });
  });

  await t.test('setConsent rejects a non-boolean value without touching the DB', async () => {
    const upsertMock = t.mock.method(aiMemoryRepository, 'upsertConsent');
    t.after(() => upsertMock.mock.restore());

    await assert.rejects(
      () => aiMemoryService.setConsent({}, 'yes', { actorUserId: 'u1', collegeId: 'c1' }),
      aiMemoryService.AiMemoryValidationError,
    );
    assert.equal(upsertMock.mock.callCount(), 0);
  });

  await t.test('setConsent(true) upserts consent and does NOT wipe memory', async () => {
    const upsertMock = t.mock.method(aiMemoryRepository, 'upsertConsent', async () => ({
      consented: true,
      consented_at: '2026-08-21T00:00:00Z',
    }));
    const removeAllMock = t.mock.method(aiMemoryRepository, 'removeAllMemoryForUser', async () => {});
    t.after(() => {
      upsertMock.mock.restore();
      removeAllMock.mock.restore();
    });

    const result = await aiMemoryService.setConsent({}, true, { actorUserId: 'u1', collegeId: 'c1' });
    assert.equal(result.consented, true);
    assert.equal(removeAllMock.mock.callCount(), 0);
  });

  await t.test(
    'setConsent(false) upserts consent AND synchronously wipes every stored memory for that user — the real privacy property',
    async () => {
      const upsertMock = t.mock.method(aiMemoryRepository, 'upsertConsent', async () => ({
        consented: false,
        consented_at: null,
      }));
      const removeAllMock = t.mock.method(aiMemoryRepository, 'removeAllMemoryForUser', async (client, userId) => {
        assert.equal(userId, 'u1');
      });
      const removeAllFactsMock = t.mock.method(
        aiMemoryRepository,
        'removeAllGeneralFactsForUser',
        async (client, userId) => {
          assert.equal(userId, 'u1');
        },
      );
      t.after(() => {
        upsertMock.mock.restore();
        removeAllMock.mock.restore();
        removeAllFactsMock.mock.restore();
      });

      const result = await aiMemoryService.setConsent({}, false, { actorUserId: 'u1', collegeId: 'c1' });
      assert.equal(result.consented, false);
      assert.equal(removeAllMock.mock.callCount(), 1);
      assert.equal(removeAllFactsMock.mock.callCount(), 1);
    },
  );
});

// General freeform facts (product decision, this round) — same consent
// gate as rememberPreference, plus a bounded-count cap and a narrow
// identifier-number backstop neither the bounded-type path needed.
test('aiMemoryService.rememberFact / recallGeneralFacts / forgetFact', async (t) => {
  await t.test('rejects empty/whitespace-only fact, never reaches the DB', async () => {
    const insertMock = t.mock.method(aiMemoryRepository, 'insertGeneralFact');
    t.after(() => insertMock.mock.restore());

    await assert.rejects(
      () => aiMemoryService.rememberFact({}, '   ', { actorUserId: 'u1', collegeId: 'c1' }),
      aiMemoryService.AiMemoryValidationError,
    );
    assert.equal(insertMock.mock.callCount(), 0);
  });

  await t.test('rejects a fact over the length cap, never reaches the DB', async () => {
    const insertMock = t.mock.method(aiMemoryRepository, 'insertGeneralFact');
    t.after(() => insertMock.mock.restore());

    await assert.rejects(
      () => aiMemoryService.rememberFact({}, 'x'.repeat(400), { actorUserId: 'u1', collegeId: 'c1' }),
      aiMemoryService.AiMemoryValidationError,
    );
    assert.equal(insertMock.mock.callCount(), 0);
  });

  await t.test(
    'rejects a fact containing a bare 5-12 digit identifier-shaped number, never reaches the DB',
    async () => {
      const insertMock = t.mock.method(aiMemoryRepository, 'insertGeneralFact');
      t.after(() => insertMock.mock.restore());

      await assert.rejects(
        () =>
          aiMemoryService.rememberFact({}, 'always flag roll number 26700160 for review', {
            actorUserId: 'u1',
            collegeId: 'c1',
          }),
        aiMemoryService.AiMemoryValidationError,
      );
      assert.equal(insertMock.mock.callCount(), 0);
    },
  );

  await t.test('allows a short number that is not identifier-shaped (fewer than 5 digits)', async () => {
    const insertMock = t.mock.method(aiMemoryRepository, 'insertGeneralFact', async (client, fields) => ({
      id: 'f1',
      ...fields,
    }));
    const consentMock = t.mock.method(aiMemoryRepository, 'getConsent', async () => ({
      consented: true,
      consented_at: '2026-08-21T00:00:00Z',
    }));
    const countMock = t.mock.method(aiMemoryRepository, 'countGeneralFacts', async () => 0);
    t.after(() => {
      insertMock.mock.restore();
      consentMock.mock.restore();
      countMock.mock.restore();
    });

    await aiMemoryService.rememberFact({}, 'I teach 3 sections this year', { actorUserId: 'u1', collegeId: 'c1' });
    assert.equal(insertMock.mock.callCount(), 1);
  });

  await t.test('the real gate: no consent on record -> AiMemoryConsentRequiredError, never writes', async () => {
    const consentMock = t.mock.method(aiMemoryRepository, 'getConsent', async () => null);
    const insertMock = t.mock.method(aiMemoryRepository, 'insertGeneralFact');
    t.after(() => {
      consentMock.mock.restore();
      insertMock.mock.restore();
    });

    await assert.rejects(
      () => aiMemoryService.rememberFact({}, 'keep answers short', { actorUserId: 'u1', collegeId: 'c1' }),
      aiMemoryService.AiMemoryConsentRequiredError,
    );
    assert.equal(insertMock.mock.callCount(), 0);
  });

  await t.test('refuses at the MAX_GENERAL_FACTS cap rather than silently evicting the oldest fact', async () => {
    const consentMock = t.mock.method(aiMemoryRepository, 'getConsent', async () => ({
      consented: true,
      consented_at: '2026-08-21T00:00:00Z',
    }));
    const countMock = t.mock.method(
      aiMemoryRepository,
      'countGeneralFacts',
      async () => aiMemoryService.MAX_GENERAL_FACTS,
    );
    const insertMock = t.mock.method(aiMemoryRepository, 'insertGeneralFact');
    t.after(() => {
      consentMock.mock.restore();
      countMock.mock.restore();
      insertMock.mock.restore();
    });

    await assert.rejects(
      () => aiMemoryService.rememberFact({}, 'one more thing', { actorUserId: 'u1', collegeId: 'c1' }),
      aiMemoryService.AiMemoryValidationError,
    );
    assert.equal(insertMock.mock.callCount(), 0);
  });

  await t.test("recallGeneralFacts lists only the actor's own facts", async () => {
    const listMock = t.mock.method(aiMemoryRepository, 'listGeneralFacts', async (client, userId) => {
      assert.equal(userId, 'u1');
      return [{ id: 'f1', fact: 'keep answers short' }];
    });
    t.after(() => listMock.mock.restore());

    const result = await aiMemoryService.recallGeneralFacts({}, { actorUserId: 'u1' });
    assert.deepEqual(result, [{ id: 'f1', fact: 'keep answers short' }]);
  });

  await t.test('forgetFact works even with no consent on record — deletion is never gated', async () => {
    const removeMock = t.mock.method(aiMemoryRepository, 'removeGeneralFact', async (client, userId, factId) => {
      assert.equal(userId, 'u1');
      assert.equal(factId, 'f1');
      return true;
    });
    t.after(() => removeMock.mock.restore());

    await aiMemoryService.forgetFact({}, 'f1', { actorUserId: 'u1' });
    assert.equal(removeMock.mock.callCount(), 1);
  });
});

test('aiMemoryService.rememberPreference', async (t) => {
  await t.test('rejects a memory_type outside the fixed allowlist, never reaches the DB', async () => {
    const upsertMock = t.mock.method(aiMemoryRepository, 'upsertMemory');
    t.after(() => upsertMock.mock.restore());

    await assert.rejects(
      () => aiMemoryService.rememberPreference({}, 'favorite_student', 'Ravi', { actorUserId: 'u1', collegeId: 'c1' }),
      aiMemoryService.AiMemoryValidationError,
    );
    assert.equal(upsertMock.mock.callCount(), 0);
  });

  await t.test('rejects a value over the length cap, never reaches the DB', async () => {
    const upsertMock = t.mock.method(aiMemoryRepository, 'upsertMemory');
    t.after(() => upsertMock.mock.restore());

    await assert.rejects(
      () =>
        aiMemoryService.rememberPreference({}, 'communication_style', 'x'.repeat(400), {
          actorUserId: 'u1',
          collegeId: 'c1',
        }),
      aiMemoryService.AiMemoryValidationError,
    );
    assert.equal(upsertMock.mock.callCount(), 0);
  });

  await t.test('the real gate: no consent on record -> AiMemoryConsentRequiredError, never writes', async () => {
    const getConsentMock = t.mock.method(aiMemoryRepository, 'getConsent', async () => null);
    const upsertMock = t.mock.method(aiMemoryRepository, 'upsertMemory');
    t.after(() => {
      getConsentMock.mock.restore();
      upsertMock.mock.restore();
    });

    await assert.rejects(
      () =>
        aiMemoryService.rememberPreference({}, 'communication_style', 'concise', {
          actorUserId: 'u1',
          collegeId: 'c1',
        }),
      aiMemoryService.AiMemoryConsentRequiredError,
    );
    assert.equal(upsertMock.mock.callCount(), 0);
  });

  await t.test('consented -> writes normally', async () => {
    const getConsentMock = t.mock.method(aiMemoryRepository, 'getConsent', async () => ({
      consented: true,
      consented_at: '2026-08-21T00:00:00Z',
    }));
    const upsertMock = t.mock.method(aiMemoryRepository, 'upsertMemory', async (client, fields) => ({
      id: 'mem-1',
      ...fields,
    }));
    t.after(() => {
      getConsentMock.mock.restore();
      upsertMock.mock.restore();
    });

    const result = await aiMemoryService.rememberPreference({}, 'communication_style', 'concise, bullet points', {
      actorUserId: 'u1',
      collegeId: 'c1',
    });
    assert.equal(result.memoryType, 'communication_style');
    assert.equal(result.value, 'concise, bullet points');
  });
});

test('aiMemoryService.recallPreferences / forgetPreference', async (t) => {
  await t.test("recallPreferences lists only the actor's own memory", async () => {
    const listMock = t.mock.method(aiMemoryRepository, 'listMemoryByUser', async (client, userId) => {
      assert.equal(userId, 'u1');
      return [{ memory_type: 'communication_style', value: 'concise' }];
    });
    t.after(() => listMock.mock.restore());

    const result = await aiMemoryService.recallPreferences({}, { actorUserId: 'u1' });
    assert.equal(result.length, 1);
  });

  await t.test('forgetPreference rejects an out-of-allowlist type', async () => {
    const removeMock = t.mock.method(aiMemoryRepository, 'removeMemory');
    t.after(() => removeMock.mock.restore());

    await assert.rejects(
      () => aiMemoryService.forgetPreference({}, 'not_a_real_type', { actorUserId: 'u1' }),
      aiMemoryService.AiMemoryValidationError,
    );
    assert.equal(removeMock.mock.callCount(), 0);
  });

  await t.test('forgetPreference works even with no consent on record — deletion is never gated', async () => {
    const removeMock = t.mock.method(aiMemoryRepository, 'removeMemory', async (client, userId, memoryType) => {
      assert.equal(userId, 'u1');
      assert.equal(memoryType, 'communication_style');
      return true;
    });
    t.after(() => removeMock.mock.restore());

    await aiMemoryService.forgetPreference({}, 'communication_style', { actorUserId: 'u1' });
    assert.equal(removeMock.mock.callCount(), 1);
  });
});
