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
  // Six since 2026-08-28, when docx/pdf/pptx were adopted alongside the
  // original three. An exact list rather than a count, deliberately: this
  // assertion is what fails the moment a directory appears under
  // src/skills/ that nobody meant to ship. skillService discovers skills
  // BY DIRECTORY, so a copied folder is instantly visible to the model —
  // and a skill whose SKILL.md reaches for a library the sandbox image
  // does not carry is guidance that fails at the point of use. Adding a
  // name here is the moment to check sandbox-service/Dockerfile backs it.
  await t.test('loads every skill shipped under src/skills/', () => {
    const names = skillService.listSkills().map((s) => s.name).sort();
    assert.deepEqual(names, ['docx', 'file-reading', 'pdf', 'pdf-reading', 'pptx', 'xlsx']);
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
    // python-docx/python-pptx/reportlab/pypdf are installed (ADL-065's
    // execute_code description update), so reading/creating a .docx/
    // .pptx/.pdf in-sandbox is no longer blanket-unsupported — but
    // handing a NEWLY GENERATED one back to the user still is, since
    // only .xlsx has a verification gate. That is the honesty claim
    // that must still hold.
    assert.match(skill.content, /cannot be attached and returned this way/);
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
