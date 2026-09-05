'use strict';

// ADR-030 P2(a) — pure/sync tests for aiContextAssembly, the same style
// as ai-policy-assembly.test.js: no DB, no fetch mocking. Proves the
// flattening shim reproduces today's exact per-call-site string assembly
// (aiService.js) byte-for-byte, and that the fingerprint genuinely hashes
// only static + conversation-scoped content.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiContextAssembly = require('../src/services/aiContextAssembly');

const { STABILITY, segment, buildContext, flattenToPrompts, contextFromFlatPrompts } = aiContextAssembly;

function seg(overrides) {
  return {
    source: 'x',
    stability: STABILITY.STATIC,
    target: 'system',
    content: 'content',
    ...overrides,
  };
}

test('segment(): throws on missing/invalid source, stability, target, content', () => {
  assert.throws(() => segment(seg({ source: '' })));
  assert.throws(() => segment(seg({ stability: 'not-a-real-stability' })));
  assert.throws(() => segment(seg({ target: 'assistant' })));
  assert.throws(() => segment(seg({ content: '' })));
  assert.throws(() => segment(seg({ content: undefined })));
});

test('segment(): valid input returns the same fields, no extras', () => {
  const s = segment(
    seg({
      source: 'identity',
      stability: STABILITY.CONVERSATION,
      target: 'system',
      content: 'Identity Context',
    }),
  );
  assert.deepEqual(s, {
    source: 'identity',
    stability: STABILITY.CONVERSATION,
    target: 'system',
    content: 'Identity Context',
  });
});

test('buildContext(): preserves segment order, passes tools/images through untouched including undefined', () => {
  const segments = [seg({ source: 'a', content: '1' }), seg({ source: 'b', content: '2' })];
  const ctx = buildContext(segments);
  assert.deepEqual(
    ctx.segments.map((s) => s.source),
    ['a', 'b'],
  );
  assert.equal(ctx.tools, undefined);
  assert.equal(ctx.images, undefined);

  const tools = [{ name: 'x' }];
  const images = [{ mimeType: 'image/png', base64: 'abc' }];
  const ctx2 = buildContext(segments, { tools, images });
  assert.equal(ctx2.tools, tools);
  assert.equal(ctx2.images, images);
});

// --- flattenToPrompts: reproduce each of aiService.js's 5 documented
// call-site patterns exactly ---

test('flattenToPrompts: executeWorkflowPlan pattern (system: preamble+prefix+policy+plan-note+identity, user: tool-data+guidance)', () => {
  const ctx = buildContext([
    segment({
      source: 'safety-preamble',
      stability: STABILITY.STATIC,
      target: 'system',
      content: 'PREAMBLE',
    }),
    segment({
      source: 'mode-prefix',
      stability: STABILITY.STATIC,
      target: 'system',
      content: 'MODE_PREFIX',
    }),
    segment({
      source: 'policy-modules',
      stability: STABILITY.CONVERSATION,
      target: 'system',
      content: 'POLICY',
    }),
    segment({
      source: 'plan-summary-note',
      stability: STABILITY.TURN,
      target: 'system',
      content: 'This answer combines the results of 2 tool(s), run as one plan:\nt1: d1\nt2: d2',
    }),
    segment({
      source: 'identity',
      stability: STABILITY.CONVERSATION,
      target: 'system',
      content: 'IDENTITY',
    }),
    segment({
      source: 'tool-result-data',
      stability: STABILITY.VOLATILE,
      target: 'user',
      content: 'USER_DATA',
    }),
    segment({
      source: 'tool-result-answer-guidance',
      stability: STABILITY.STATIC,
      target: 'user',
      content: 'GUIDANCE',
    }),
  ]);
  const { systemPrompt, userPrompt } = flattenToPrompts(ctx);
  assert.equal(
    systemPrompt,
    'PREAMBLE\n\nMODE_PREFIX\n\nPOLICY\n\nThis answer combines the results of 2 tool(s), run as one plan:\nt1: d1\nt2: d2\n\nIDENTITY',
  );
  assert.equal(userPrompt, 'USER_DATA\n\nGUIDANCE');
});

test('flattenToPrompts: askAboutTool pattern (user is ONE unmodified segment, no guidance appended)', () => {
  const ctx = buildContext([
    segment({
      source: 'safety-preamble',
      stability: STABILITY.STATIC,
      target: 'system',
      content: 'PREAMBLE',
    }),
    segment({
      source: 'mode-prefix',
      stability: STABILITY.STATIC,
      target: 'system',
      content: 'MODE_PREFIX',
    }),
    segment({
      source: 'policy-modules',
      stability: STABILITY.CONVERSATION,
      target: 'system',
      content: 'POLICY',
    }),
    segment({
      source: 'identity',
      stability: STABILITY.CONVERSATION,
      target: 'system',
      content: 'IDENTITY',
    }),
    segment({
      source: 'tool-result-data',
      stability: STABILITY.VOLATILE,
      target: 'user',
      content: 'USER_DATA',
    }),
  ]);
  const { systemPrompt, userPrompt } = flattenToPrompts(ctx);
  assert.equal(systemPrompt, 'PREAMBLE\n\nMODE_PREFIX\n\nPOLICY\n\nIDENTITY');
  assert.equal(userPrompt, 'USER_DATA');
});

test('flattenToPrompts: askGeneralChat pattern — no safety-preamble segment at all, genuinely shorter list', () => {
  const ctx = buildContext([
    segment({
      source: 'mode-prefix',
      stability: STABILITY.STATIC,
      target: 'system',
      content: 'MODE_PREFIX.general',
    }),
    segment({
      source: 'policy-modules',
      stability: STABILITY.CONVERSATION,
      target: 'system',
      content: 'POLICY',
    }),
    segment({
      source: 'identity',
      stability: STABILITY.CONVERSATION,
      target: 'system',
      content: 'IDENTITY',
    }),
    segment({
      source: 'question',
      stability: STABILITY.TURN,
      target: 'user',
      content: 'promptQuestion',
    }),
  ]);
  const { systemPrompt, userPrompt } = flattenToPrompts(ctx);
  assert.equal(systemPrompt, 'MODE_PREFIX.general\n\nPOLICY\n\nIDENTITY');
  assert.equal(userPrompt, 'promptQuestion');
});

test('flattenToPrompts: conditional image-unavailable-note segment, present vs. omitted (not empty-string)', () => {
  const base = [
    segment({
      source: 'mode-prefix',
      stability: STABILITY.STATIC,
      target: 'system',
      content: 'MODE_PREFIX',
    }),
    segment({
      source: 'identity',
      stability: STABILITY.CONVERSATION,
      target: 'system',
      content: 'IDENTITY',
    }),
    segment({
      source: 'question',
      stability: STABILITY.TURN,
      target: 'user',
      content: 'promptQuestion',
    }),
  ];
  const withoutNote = flattenToPrompts(buildContext(base));
  assert.equal(withoutNote.userPrompt, 'promptQuestion', 'no double \\n\\n gap when the note is omitted');

  const withNote = flattenToPrompts(
    buildContext([
      ...base,
      segment({
        source: 'image-unavailable-note',
        stability: STABILITY.TURN,
        target: 'user',
        content: 'cannot view images',
      }),
    ]),
  );
  assert.equal(withNote.userPrompt, 'promptQuestion\n\ncannot view images');
});

test('flattenToPrompts: tools/images pass through as context fields, never stringified into prompt text', () => {
  const tools = [{ name: 'get_college_profile' }];
  const images = [{ mimeType: 'image/png', base64: 'abc' }];
  const ctx = buildContext(
    [
      segment({
        source: 'mode-prefix',
        stability: STABILITY.STATIC,
        target: 'system',
        content: 'MODE_PREFIX',
      }),
      segment({
        source: 'question',
        stability: STABILITY.TURN,
        target: 'user',
        content: 'q',
      }),
    ],
    { tools, images },
  );
  const flat = flattenToPrompts(ctx);
  assert.equal(flat.tools, tools);
  assert.equal(flat.images, images);
  assert.ok(!flat.systemPrompt.includes('get_college_profile'));
  assert.ok(!flat.userPrompt.includes('get_college_profile'));
});

// --- historyTurns (ARCNAVE modernization P2 / 1.6) ---

test('buildContext: no historyTurns option -> historyTurns defaults to an empty array, never undefined', () => {
  const ctx = buildContext([
    segment({ source: 'mode-prefix', stability: STABILITY.STATIC, target: 'system', content: 'MODE_PREFIX' }),
  ]);
  assert.deepEqual(ctx.historyTurns, []);
});

test('flattenToPrompts: historyTurns passes through as a context field, and appends the framing note to systemPrompt exactly once', () => {
  const historyTurns = [
    { role: 'user', content: 'earlier question' },
    { role: 'assistant', content: 'earlier answer' },
  ];
  const ctx = buildContext(
    [segment({ source: 'mode-prefix', stability: STABILITY.STATIC, target: 'system', content: 'MODE_PREFIX' })],
    { historyTurns },
  );
  const flat = flattenToPrompts(ctx);
  assert.equal(flat.historyTurns, historyTurns);
  assert.ok(flat.systemPrompt.startsWith('MODE_PREFIX'));
  assert.match(flat.systemPrompt, /never new/);
  // Never stringified into the actual prior turn text — that stays
  // structural, same "not a segment" posture tools/images already have.
  assert.ok(!flat.systemPrompt.includes('earlier question'));
  assert.ok(!flat.userPrompt.includes('earlier question'));
});

test('flattenToPrompts: empty historyTurns -> no framing note added, systemPrompt unchanged', () => {
  const ctx = buildContext([
    segment({ source: 'mode-prefix', stability: STABILITY.STATIC, target: 'system', content: 'MODE_PREFIX' }),
  ]);
  const flat = flattenToPrompts(ctx);
  assert.equal(flat.systemPrompt, 'MODE_PREFIX');
  assert.ok(!flat.systemPrompt.includes('never new'));
});

// --- fingerprint ---

test('fingerprint: deterministic — same segments produce the same fingerprint', () => {
  const build = () =>
    buildContext([
      segment({
        source: 'core',
        stability: STABILITY.STATIC,
        target: 'system',
        content: 'CORE TEXT',
      }),
      segment({
        source: 'identity',
        stability: STABILITY.CONVERSATION,
        target: 'system',
        content: 'IDENTITY',
      }),
    ]);
  assert.equal(build().fingerprint, build().fingerprint);
});

test("fingerprint: changes when a STATIC segment's content changes", () => {
  const a = buildContext([
    segment({
      source: 'core',
      stability: STABILITY.STATIC,
      target: 'system',
      content: 'CORE TEXT',
    }),
  ]);
  const b = buildContext([
    segment({
      source: 'core',
      stability: STABILITY.STATIC,
      target: 'system',
      content: 'CORE TEXT v2',
    }),
  ]);
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test("fingerprint: changes when a CONVERSATION segment's content changes", () => {
  const a = buildContext([
    segment({
      source: 'identity',
      stability: STABILITY.CONVERSATION,
      target: 'system',
      content: 'Role: hod',
    }),
  ]);
  const b = buildContext([
    segment({
      source: 'identity',
      stability: STABILITY.CONVERSATION,
      target: 'system',
      content: 'Role: principal',
    }),
  ]);
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test('fingerprint: UNCHANGED when only a TURN segment changes (the question)', () => {
  const staticPart = segment({
    source: 'core',
    stability: STABILITY.STATIC,
    target: 'system',
    content: 'CORE TEXT',
  });
  const a = buildContext([
    staticPart,
    segment({
      source: 'question',
      stability: STABILITY.TURN,
      target: 'user',
      content: 'what is the capital of France?',
    }),
  ]);
  const b = buildContext([
    staticPart,
    segment({
      source: 'question',
      stability: STABILITY.TURN,
      target: 'user',
      content: 'a totally different question entirely',
    }),
  ]);
  assert.equal(a.fingerprint, b.fingerprint, 'turn-scoped content must never affect the fingerprint');
});

test('fingerprint: UNCHANGED when only a VOLATILE segment changes (a timestamped tool result)', () => {
  const staticPart = segment({
    source: 'core',
    stability: STABILITY.STATIC,
    target: 'system',
    content: 'CORE TEXT',
  });
  const a = buildContext([
    staticPart,
    segment({
      source: 'tool-result-data',
      stability: STABILITY.VOLATILE,
      target: 'user',
      content: 'retrievedAt: 2026-08-23T00:00:00Z',
    }),
  ]);
  const b = buildContext([
    staticPart,
    segment({
      source: 'tool-result-data',
      stability: STABILITY.VOLATILE,
      target: 'user',
      content: 'retrievedAt: 2026-08-24T12:00:00Z',
    }),
  ]);
  assert.equal(a.fingerprint, b.fingerprint, 'volatile content must never affect the fingerprint');
});

// --- contextFromFlatPrompts ---

test('contextFromFlatPrompts: round-trips a flat {systemPrompt, userPrompt, tools, images} object through flattenToPrompts unchanged', () => {
  const flat = {
    systemPrompt: 'SYS',
    userPrompt: 'USER',
    tools: [{ name: 't' }],
    images: [{ mimeType: 'image/png', base64: 'x' }],
  };
  const ctx = contextFromFlatPrompts(flat);
  const roundTripped = flattenToPrompts(ctx);
  assert.equal(roundTripped.systemPrompt, flat.systemPrompt);
  assert.equal(roundTripped.userPrompt, flat.userPrompt);
  assert.equal(roundTripped.tools, flat.tools);
  assert.equal(roundTripped.images, flat.images);
});

test('contextFromFlatPrompts: omits system/user segments entirely when the flat field is missing', () => {
  const ctx = contextFromFlatPrompts({ userPrompt: 'only user' });
  const flat = flattenToPrompts(ctx);
  assert.equal(flat.systemPrompt, '');
  assert.equal(flat.userPrompt, 'only user');
});
