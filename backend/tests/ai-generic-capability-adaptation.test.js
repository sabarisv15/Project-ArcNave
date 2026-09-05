'use strict';

// Unit tests for the two new AI-facing generic tools added by the
// consumer-tool-inventory adaptation (46 -> ARCNAVE-safe mapping):
// ai_memory_list (the AI Memory transparency gap: "what do you remember
// about me") and ask_user_choice (the ARCNAVE-safe equivalent of
// ask_user_input_v0). Both are L1, self-scoped, reachable by every
// tenant role, and neither is humanOnly (both are safe for the LLM to
// call on its own mid-conversation). No live Postgres needed for
// ask_user_choice (it never touches a repository); ai_memory_list is
// exercised at the aiInteractionService/aiMemoryService validation level
// only here, same as ai-memory-service.test.js does for the tools it
// wraps.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiToolRegistry = require('../src/services/aiToolRegistry');
const aiInteractionService = require('../src/services/aiInteractionService');

const NEW_GENERIC_TOOLS = [
  'ai_memory_list',
  'ask_user_choice',
  'conversation_search',
  'present_options',
  'present_quiz',
  'present_translation',
  'present_steps',
];

test('AI tool registry — generic capability adaptation registration', async (t) => {
  await t.test('both new tools are registered, L1, Internal, and reachable by every tenant role', () => {
    for (const name of NEW_GENERIC_TOOLS) {
      const tool = aiToolRegistry.getTool(name);
      assert.ok(tool, `expected ${name} to be registered`);
      assert.equal(tool.level, 'L1', `${name} should be L1 — presentation/read only, no approval needed`);
      assert.equal(tool.dataClassification, 'Internal');
      assert.deepEqual(
        [...tool.allowedRoles].sort(),
        ['class_tutor', 'hod', 'principal', 'staff'],
        `${name} should be reachable by every tenant role — neither carries any data sensitive enough to restrict further`,
      );
      assert.ok(!tool.humanOnly, `${name} should not be humanOnly — safe for the LLM to call on its own`);
    }
  });

  await t.test('ask_user_choice takes no caller-supplied collegeId/tenant-scoping param (nothing to scope)', () => {
    const tool = aiToolRegistry.getTool('ask_user_choice');
    assert.deepEqual(Object.keys(tool.params.properties).sort(), ['options', 'prompt']);
  });
});

test('conversation_search (ADL-060) — self-scoped, no caller-supplied userId', async (t) => {
  await t.test('handler always resolves against the acting user, never a caller-supplied id', () => {
    const tool = aiToolRegistry.getTool('conversation_search');
    assert.deepEqual(Object.keys(tool.params.properties), ['query']);
    assert.ok(
      !('userId' in tool.params.properties),
      'must not accept a caller-supplied userId — always the acting user',
    );
  });
});

test('present_options / present_quiz / present_translation / present_steps — presentation-only, no data access', async (t) => {
  await t.test('present_options rejects fewer than 2 or more than 6 alternatives', () => {
    assert.throws(
      () => aiInteractionService.buildOptionsCard('X', [{ label: 'only one' }]),
      aiInteractionService.AiInteractionValidationError,
    );
    const seven = Array.from({ length: 7 }, (_, i) => ({ label: `opt ${i}` }));
    assert.throws(
      () => aiInteractionService.buildOptionsCard('X', seven),
      aiInteractionService.AiInteractionValidationError,
    );
  });

  await t.test(
    'present_options accepts a valid card and never implies ranking (no rank/recommended field in the shape)',
    () => {
      const card = aiInteractionService.buildOptionsCard('Title', [
        { label: 'A', description: 'first' },
        { label: 'B' },
      ]);
      assert.deepEqual(Object.keys(card.options[0]).sort(), ['description', 'label']);
    },
  );

  await t.test('present_quiz rejects an out-of-range correctIndex', () => {
    assert.throws(
      () => aiInteractionService.buildQuiz('Q', [{ question: 'q1', options: ['a', 'b'], correctIndex: 5 }]),
      aiInteractionService.AiInteractionValidationError,
    );
  });

  await t.test('present_quiz rejects a non-integer correctIndex', () => {
    assert.throws(
      () => aiInteractionService.buildQuiz('Q', [{ question: 'q1', options: ['a', 'b'], correctIndex: 0.5 }]),
      aiInteractionService.AiInteractionValidationError,
    );
  });

  await t.test('present_quiz accepts a valid quiz', () => {
    const quiz = aiInteractionService.buildQuiz('Q', [{ question: 'q1', options: ['a', 'b', 'c'], correctIndex: 2 }]);
    assert.equal(quiz.questions[0].correctIndex, 2);
  });

  await t.test('present_translation requires sourceText, targetText, and targetLang', () => {
    assert.throws(
      () => aiInteractionService.buildTranslationCard('hi', 'en', '', 'ta'),
      aiInteractionService.AiInteractionValidationError,
    );
    assert.throws(
      () => aiInteractionService.buildTranslationCard('hi', 'en', 'vanakkam', ''),
      aiInteractionService.AiInteractionValidationError,
    );
  });

  await t.test('present_translation sourceLang is optional', () => {
    const card = aiInteractionService.buildTranslationCard('hi', undefined, 'vanakkam', 'ta');
    assert.equal(card.sourceLang, null);
  });

  await t.test('present_steps rejects an empty steps array', () => {
    assert.throws(() => aiInteractionService.buildSteps('T', []), aiInteractionService.AiInteractionValidationError);
  });

  await t.test('present_steps rejects more than 15 steps', () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => `step ${i}`);
    assert.throws(
      () => aiInteractionService.buildSteps('T', sixteen),
      aiInteractionService.AiInteractionValidationError,
    );
  });

  await t.test('present_steps accepts a valid sequence', () => {
    const steps = aiInteractionService.buildSteps('T', ['a', 'b']);
    assert.deepEqual(steps.steps, ['a', 'b']);
  });
});

test('aiInteractionService.buildChoicePrompt', async (t) => {
  await t.test('accepts a valid prompt + 2-6 options, trimming whitespace', () => {
    const result = aiInteractionService.buildChoicePrompt('  Which category?  ', ['  Circulars ', 'Curriculum']);
    assert.deepEqual(result, { prompt: 'Which category?', options: ['Circulars', 'Curriculum'] });
  });

  await t.test('rejects an empty/whitespace-only prompt', () => {
    assert.throws(
      () => aiInteractionService.buildChoicePrompt('   ', ['a', 'b']),
      aiInteractionService.AiInteractionValidationError,
    );
  });

  await t.test('rejects fewer than 2 options', () => {
    assert.throws(
      () => aiInteractionService.buildChoicePrompt('Which one?', ['only one']),
      aiInteractionService.AiInteractionValidationError,
    );
  });

  await t.test('rejects more than 6 options', () => {
    assert.throws(
      () => aiInteractionService.buildChoicePrompt('Which one?', ['a', 'b', 'c', 'd', 'e', 'f', 'g']),
      aiInteractionService.AiInteractionValidationError,
    );
  });

  await t.test('rejects a non-string option', () => {
    assert.throws(
      () => aiInteractionService.buildChoicePrompt('Which one?', ['a', 42]),
      aiInteractionService.AiInteractionValidationError,
    );
  });

  await t.test('rejects an over-length prompt', () => {
    assert.throws(
      () => aiInteractionService.buildChoicePrompt('x'.repeat(201), ['a', 'b']),
      aiInteractionService.AiInteractionValidationError,
    );
  });
});

test('ask_user_choice tool handler delegates straight to aiInteractionService, no data access', async (t) => {
  await t.test('valid params return the validated {prompt, options} shape', () => {
    const tool = aiToolRegistry.getTool('ask_user_choice');
    const result = tool.handler(
      null,
      { prompt: 'Which category?', options: ['Circulars', 'Curriculum'] },
      { userId: 'u1', role: 'staff', collegeId: 'c1' },
    );
    assert.deepEqual(result, { prompt: 'Which category?', options: ['Circulars', 'Curriculum'] });
  });

  await t.test('invalid params (1 option) throw before any Business Service would be touched', () => {
    const tool = aiToolRegistry.getTool('ask_user_choice');
    assert.throws(
      () =>
        tool.handler(
          null,
          { prompt: 'Which one?', options: ['only one'] },
          { userId: 'u1', role: 'staff', collegeId: 'c1' },
        ),
      aiInteractionService.AiInteractionValidationError,
    );
  });
});
