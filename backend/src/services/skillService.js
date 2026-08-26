'use strict';

// Skill Service — the ARCNAVE form of the consumer platform's skill
// mechanism, per the approved plan
// (bka/90-appendix/consumer-tool-inventory-classification.md §8b).
//
// PLATFORM-OWNED ONLY. There is no per-college authoring, no database
// table, no RLS, no WorkflowService approval — the whole point of this
// design was to build the smallest thing that satisfies the actual need
// (guidance the model can fetch on demand before writing sandbox code),
// not a general subsystem. A skill is a file shipped with this codebase,
// reviewed like any other code change.
//
// A skill is NOT executable here. It is instructions — the model reads
// a SKILL.md and writes its own code against execute_code, exactly as
// list_skills/describe_skill's own tool descriptions say. Scripts that
// DO execute (recalc.py) live in sandbox-service/ as quality gates, not
// as skill runtime — see that file's own comment for why those are a
// different thing.
//
// Loaded and cached once at require time: these are static files
// shipped with a deploy, not data that changes per request, so there is
// nothing to invalidate and no reason to hit the filesystem on every
// call the way a real Business Service would hit a repository.

const fs = require('fs');
const path = require('path');

class SkillNotFoundError extends Error {}

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

// A tiny, dependency-free frontmatter reader — two fields only, `name`
// and `description`, from a `---\nkey: value\n---` block. Not a general
// YAML parser: every SKILL.md in this directory is authored by this
// project, so there is no untrusted input to defend against here, only
// a format worth keeping simple.
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields = {};
  match[1].split(/\r?\n/).forEach((line) => {
    const lineMatch = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!lineMatch) return;
    const [, key, rawValue] = lineMatch;
    fields[key] = rawValue.trim().replace(/^"(.*)"$/, '$1');
  });
  return fields;
}

function loadSkills() {
  const skills = new Map();
  let entries = [];
  try {
    entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch (err) {
    // Missing directory is a deploy defect, not a request-time error —
    // surfaced as an empty catalogue rather than crashing module load,
    // same "fail soft at startup, loud at call time" shape
    // config.js's own optional-provider fields already use.
    return skills;
  }
  entries
    .filter((entry) => entry.isDirectory())
    .forEach((entry) => {
      const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) return;
      const content = fs.readFileSync(skillPath, 'utf8');
      const frontmatter = parseFrontmatter(content);
      skills.set(entry.name, {
        name: frontmatter.name || entry.name,
        description: frontmatter.description || null,
        content,
      });
    });
  return skills;
}

const SKILLS = loadSkills();

function listSkills() {
  return Array.from(SKILLS.values()).map(({ name, description }) => ({ name, description }));
}

function getSkill(name) {
  const skill = SKILLS.get(name);
  if (!skill) {
    throw new SkillNotFoundError(
      `no skill named ${JSON.stringify(name)} — call list_skills first rather than guessing a name`,
    );
  }
  return skill;
}

module.exports = {
  SkillNotFoundError,
  listSkills,
  getSkill,
};
