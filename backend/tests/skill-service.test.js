'use strict';

// Unit tests for skillService.js and the list_skills/describe_skill
// tools (consumer-tool-adaptation §8b, the platform-owned-only skills
// subsystem). Loads the REAL files under src/skills/ — this is
// deliberate: the whole point of this test is that every shipped
// SKILL.md is actually well-formed and loadable, not a mocked stand-in.

const test = require('node:test');
const assert = require('node:assert/strict');
const skillService = require('../src/services/skillService');
const aiToolRegistry = require('../src/services/aiToolRegistry');

test('skillService.listSkills', async (t) => {
  await t.test('loads every skill shipped under src/skills/', () => {
    const names = skillService.listSkills().map((s) => s.name).sort();
    assert.deepEqual(names, ['file-reading', 'pdf-reading', 'xlsx']);
  });

  await t.test('every listed skill has a non-empty description', () => {
    skillService.listSkills().forEach((skill) => {
      assert.ok(skill.description && skill.description.length > 0, `${skill.name} has no description`);
    });
  });

  await t.test('the list does not include the SKILL.md body — that is describe_skill\'s job', () => {
    skillService.listSkills().forEach((skill) => {
      assert.ok(!('content' in skill));
    });
  });
});

test('skillService.getSkill', async (t) => {
  await t.test('returns the full content for a known skill', () => {
    const skill = skillService.getSkill('xlsx');
    assert.equal(skill.name, 'xlsx');
    assert.match(skill.content, /expectFormulasIn/);
  });

  await t.test('throws SkillNotFoundError for an unknown name, never a silent empty result', () => {
    assert.throws(() => skillService.getSkill('does-not-exist'), skillService.SkillNotFoundError);
  });

  await t.test('the xlsx skill states the one rule that distinguishes the gate from "exit code 0"', () => {
    const skill = skillService.getSkill('xlsx');
    assert.match(skill.content, /Never compute the\s*\nanswer in Python and write it as a number/);
  });

  await t.test('the file-reading skill is honest about what the sandbox cannot do', () => {
    const skill = skillService.getSkill('file-reading');
    assert.match(skill.content, /not currently supported/);
  });
});

test('list_skills / describe_skill tool registration', async (t) => {
  await t.test('both registered, L1, Internal, all four roles, not humanOnly', () => {
    ['list_skills', 'describe_skill'].forEach((name) => {
      const tool = aiToolRegistry.getTool(name);
      assert.ok(tool, `${name} should be registered`);
      assert.equal(tool.level, 'L1');
      assert.equal(tool.dataClassification, 'Internal');
      assert.deepEqual([...tool.allowedRoles].sort(), ['class_tutor', 'hod', 'principal', 'staff']);
      assert.ok(!tool.humanOnly);
    });
  });

  await t.test('list_skills takes no params; describe_skill requires name', () => {
    assert.deepEqual(aiToolRegistry.getTool('list_skills').params.properties, {});
    assert.deepEqual(aiToolRegistry.getTool('describe_skill').params.required, ['name']);
  });

  await t.test('list_skills handler matches skillService.listSkills directly', () => {
    const tool = aiToolRegistry.getTool('list_skills');
    assert.deepEqual(tool.handler(), skillService.listSkills());
  });

  await t.test('describe_skill handler surfaces SkillNotFoundError for a bad name', () => {
    const tool = aiToolRegistry.getTool('describe_skill');
    assert.throws(() => tool.handler(null, { name: 'nope' }), skillService.SkillNotFoundError);
  });
});
