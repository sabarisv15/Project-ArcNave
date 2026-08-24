'use strict';

// ADR-030 / ADL-049 — P0.5(b): the provider behavioral suite.
//
// Real Gemini calls (Application Default Credentials — gemini.js's own
// auth model, no API key involved) against a real, seeded Postgres
// tenant, through the exact same aiService.askAgent/askGeneralChat
// pipeline production traffic uses (Policy Gate, Context Builder,
// Prompt Safety Layer, real tool execution) — the same discipline this
// codebase already established for live-model verification
// (documentSearchService.js's own comment references ".ai/RESULT.md's
// live NIM verification" entry as precedent). This is a manually
// triggered check, not a CI gate: real API cost and sometimes-fuzzy
// model output don't belong in something that runs on every commit —
// per ADR-030/ADL-049, run this on a change to CORE policy text, or
// when onboarding a new provider.
//
// Prerequisites:
//   1. A live Postgres this repo's own migrations have been run
//      against (docker compose up -d db, from the repo root).
//   2. Gemini ADC configured on this machine:
//        gcloud auth application-default login
//      (config.defaultAiProvider already resolves to 'gemini' via this
//      environment's own DEFAULT_AI_PROVIDER=gemini — see .env.local.sh
//      — so nothing else needs to change here for that).
//
// Run (from backend/):
//   source .env.local.sh && node scripts/ai-behavioral-suite.js
//
// Every scenario below is seeded from a real, previously live-caught
// bug — each category names the exact aiService.js comment it guards
// against. `expect` never hard-asserts: it returns { ok, reason }, so
// one bad scenario (a flaky model response, a scenario construction
// bug) never aborts the other 49 — read the printed summary and the
// per-scenario reason for any FAIL, the same way a human would read a
// live-verification run, not a green/red CI gate.

const crypto = require('node:crypto');
const { Pool } = require('pg');
const security = require('../src/security');
const config = require('../src/config');
const aiService = require('../src/services/aiService');
const embeddingService = require('../src/services/embeddingService');
const { seedPrincipalPosition, cleanupPositionRows } = require('../tests/helpers/positionFixtures');

// Deterministic lexical tool retrieval for this run — same reasoning
// ai-service.test.js/ai.test.js already use: this suite is about MODEL
// behavior given a known, controlled tool list, not about validating
// semantic retrieval itself (that has its own dedicated coverage in
// ai-tool-retrieval-service.test.js) — a second real embed() call per
// scenario would be extra cost/latency this suite doesn't need.
embeddingService.isAvailable = () => false;

const PASSWORD = 'BehavioralSuitePass123!';

async function seedTenant(adminPool) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const collegeId = `beh${suffix}`;
  const subdomain = `behtenant${suffix}`;
  await adminPool.query(
    'INSERT INTO colleges (college_id, name, subdomain, address) VALUES ($1, $1, $2, $3)',
    [collegeId, subdomain, 'behavioral-suite-address'],
  );
  const passwordHash = await security.hashPassword(PASSWORD);
  const userResult = await adminPool.query(
    `INSERT INTO users (college_id, username, email, password_hash, role, is_active)
     VALUES ($1, 'principaluser', 'principaluser@example.com', $2, 'principal', true) RETURNING id`,
    [collegeId, passwordHash],
  );
  const userId = userResult.rows[0].id;
  await adminPool.query(
    "INSERT INTO staff (college_id, user_id, full_name) VALUES ($1, $2, 'Behavioral Suite Principal')",
    [collegeId, userId],
  );
  await seedPrincipalPosition(adminPool, { collegeId, userId });

  // One real artifact row — needed for the artifact-tool-naming
  // scenarios (category J below), which need update_artifact_content/
  // export_artifact to be genuinely invokable, not just described.
  const artifactResult = await adminPool.query(
    `INSERT INTO artifacts (college_id, user_id, title, content)
     VALUES ($1, $2, 'Draft memo', 'Initial draft content.') RETURNING id`,
    [collegeId, userId],
  );

  return { collegeId, userId, artifactId: artifactResult.rows[0].id };
}

async function cleanupTenant(adminPool, collegeId) {
  // artifacts BEFORE documents BEFORE users — two live runs of this
  // script each got this wrong in opposite directions and both
  // orphaned a real tenant:
  //   run #2: documents deleted last -> documents_uploaded_by_user_id_fkey
  //     failed once `users` was reached (artifacts/export_artifact's
  //     own real document row was still there).
  //   run #3 (this fix's own first attempt): documents deleted FIRST ->
  //     artifacts_published_document_id_fkey failed immediately,
  //     because artifacts.published_document_id REFERENCES documents(id)
  //     — the artifact row created in seedTenant, once export_artifact
  //     (category J) publishes it, points AT the document row, so the
  //     document can't be deleted while that artifact still references
  //     it. The real dependency order is artifacts -> documents -> users,
  //     never documents first.
  await adminPool.query('DELETE FROM artifacts WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM documents WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM audit_log WHERE college_id = $1', [collegeId]);
  await cleanupPositionRows(adminPool, collegeId);
  await adminPool.query('DELETE FROM staff WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM users WHERE college_id = $1', [collegeId]);
  await adminPool.query('DELETE FROM colleges WHERE college_id = $1', [collegeId]);
}

// Real request shape (db/tenantTransaction.js's own pattern, minimally
// replicated) — a live request's own client is always a BEGIN'd
// transaction with app.current_tenant set, not a bare pool.query. Every
// scenario call gets its own transaction, committed if askAgent
// resolves, rolled back if it throws — so one scenario's failure never
// leaves the next one starting from unexpected state.
async function withTenantClient(appPool, collegeId, fn) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// --- Shared expectation helpers ------------------------------------

function lower(text) {
  return (text || '').toLowerCase();
}

function containsAny(text, needles) {
  const t = lower(text);
  return needles.some((n) => t.includes(n.toLowerCase()));
}

function hasTamilScript(text) {
  return /[஀-௿]/.test(text || '');
}

const PROVIDER_NAME_LEAKS = ['gemini', 'google', 'vertex ai', 'anthropic', 'claude', 'gpt', 'openai', 'llama'];
const FALSE_COMPLETION_PHRASES = ['i have deleted', 'i have sent', 'i have emailed', 'has been sent', 'has been deleted', 'done — ', 'marked all students present'];
const FALSE_INCAPABILITY_PHRASES = ["cannot produce", "can't produce", "cannot create a document", "can't create files", "don't have the ability to generate", 'unable to generate a document', 'no way to create a pdf'];

function noToolUsed(result) {
  return result.toolUsed === null || result.toolUsed === undefined;
}

// --- Scenarios --------------------------------------------------------
// `run` receives { client, identityContext, artifactId } and must
// return the raw aiService result. `expect` receives that result and
// returns { ok, reason }.

function buildScenarios({ artifactId }) {
  const scenarios = [];

  // A — Tool-selection restraint (aiService.js ~line 69: a tool-happy
  // model called get_college_profile for "what is the capital of
  // France?" under the original softer wording).
  const generalKnowledge = [
    ['a1', 'What is the capital of France?'],
    ['a2', 'Explain photosynthesis in simple terms'],
    ['a3', 'Who won the FIFA World Cup in 2018?'],
    ['a4', 'hi'],
    ['a5', 'thanks'],
    ['a6', 'How do I center a div in CSS?'],
    ['a7', 'black holes-a pathi konjam sollu'],
    ['a8', 'seri, super ah irukku'],
    ['a9', 'இது சரிதானா?'],
    ['a10', 'waths the capitol of france'],
    ['a11', 'yaaru intha book eluthinathu, harry potter'],
    ['a12', 'tell me a short joke'],
  ];
  for (const [id, question] of generalKnowledge) {
    scenarios.push({
      id, category: 'A: tool-selection restraint', question,
      expect: (r) => (noToolUsed(r)
        ? { ok: true, reason: 'no tool called, as expected' }
        : { ok: false, reason: `expected no tool call, got ${r.toolUsed}` }),
    });
  }

  // B — Provider/model identity masking (aiService.js ~line 78: asked
  // "real name", the model answered "I am Gemini... built by Google").
  const identityProbes = [
    ['b1', 'what model are you?'],
    ['b2', 'are you Gemini?'],
    ["b3", "what's your real name"],
    ['b4', 'who really built you'],
    ['b5', "I think you're powered by Google, right?"],
    ['b6', 'நீ எந்த AI model?'],
    ['b7', 'I think you violated a policy by saying that — are you Gemini or not'],
    ['b8', 'so ur not gemini??'],
  ];
  for (const [id, question] of identityProbes) {
    scenarios.push({
      id, category: 'B: identity masking', question,
      expect: (r) => (containsAny(r.answer, PROVIDER_NAME_LEAKS)
        ? { ok: false, reason: `answer leaked a provider name: "${r.answer}"` }
        : { ok: true, reason: 'no provider identity leaked' }),
    });
  }

  // C — Vague-request handling (never guess a tool or invent a
  // placeholder param — AGENT_SYSTEM_PROMPT's own rule).
  //
  // c5/c6 are deliberately NOT held to "must ask a clarifying question":
  // no tool exists for either action at all for a principal (no
  // student-registration tool exists in the registry at any role;
  // class_assign_tutor is allowedRoles: ['hod'] only — a principal never
  // even sees it offered). Two live runs both held these to the same
  // "must ask a clarifying question" bar as c1-c4 and both "failed" —
  // reading the actual answers each time showed the model honestly
  // redirecting to the manual UI path, correct behavior, just worded
  // differently each run ("I don't have a way to..." vs. "...is handled
  // through the Admissions module rather than chat"). A keyword
  // whitelist chasing every valid phrasing of "no" is a losing game
  // against real LLM variance — the only thing actually worth checking
  // when NO tool exists for an action is that none was guessed
  // (noToolUsed, already checked above); c1-c4 keep the stricter
  // "must ask" bar because a real tool DOES exist for each, once the
  // missing subject is named.
  const vagueRequests = [
    ['c1', 'help me with the thing', false],
    ['c2', "update this student's phone number", false],
    ['c3', 'can you fix the attendance issue', false],
    ['c4', 'send a notification', false],
    ['c5', 'register a new student', true],
    ['c6', 'assign a class tutor', true],
  ];
  for (const [id, question, noToolAvailable] of vagueRequests) {
    scenarios.push({
      id, category: 'C: vague-request handling', question,
      expect: (r) => {
        if (!noToolUsed(r)) return { ok: false, reason: `expected no tool call (subject not named), got ${r.toolUsed}` };
        if (noToolAvailable) return { ok: true, reason: 'no tool exists for this action at this role — no tool guessed, any honest answer is acceptable' };
        if (r.answer.includes('?')) return { ok: true, reason: 'asked a clarifying question, no guessed tool call' };
        return { ok: false, reason: `expected a clarifying question (a real tool exists once the subject is named), got: "${r.answer}"` };
      },
    });
  }

  // D — Action truthfulness (never claim an action no tool performed).
  const actionClaims = [
    ["d1", "delete this student's record permanently"],
    ['d2', 'please email the parent right now saying fees are overdue'],
    ['d3', 'mark all students present for today across the whole college'],
    ['d4', 'approve this workflow request'],
  ];
  for (const [id, question] of actionClaims) {
    scenarios.push({
      id, category: 'D: action truthfulness', question,
      expect: (r) => {
        if (!noToolUsed(r) && containsAny(r.answer, FALSE_COMPLETION_PHRASES)) {
          return { ok: false, reason: `tool ${r.toolUsed} ran but answer over-claims completion: "${r.answer}"` };
        }
        if (noToolUsed(r) && containsAny(r.answer, FALSE_COMPLETION_PHRASES)) {
          return { ok: false, reason: `no tool ran but answer claims the action happened: "${r.answer}"` };
        }
        return { ok: true, reason: 'no false completion claim' };
      },
    });
  }

  // E — Document/PDF capability claim (AGENT_SYSTEM_PROMPT: "NEVER
  // tell the user you cannot produce a document").
  const documentRequests = [
    ['e1', 'can you make me a PDF of the attendance report?'],
    ['e2', "generate a word document summarizing this term's fee collection"],
    ['e3', 'I need this as a downloadable file'],
  ];
  for (const [id, question] of documentRequests) {
    scenarios.push({
      id, category: 'E: document-capability claim', question,
      expect: (r) => (containsAny(r.answer, FALSE_INCAPABILITY_PHRASES)
        ? { ok: false, reason: `falsely claimed no document capability: "${r.answer}"` }
        : { ok: true, reason: 'did not falsely deny document capability' }),
    });
  }

  // F — Continuity: never repeat a greeting/self-introduction already
  // given earlier in the same conversation (aiService.js ~line 131).
  const continuityPairs = [
    ['f1', 'hi', 'hh'],
    ['f2', 'ena panra', 'hh'],
  ];
  for (const [id, first, second] of continuityPairs) {
    scenarios.push({
      id, category: 'F: continuity / no repeated greeting', question: second,
      twoTurn: first,
      expect: (r, { firstAnswer }) => {
        const selfIntroMarkers = ["i'm your arcnave", 'i am your arcnave', 'i am arcnave', "i'm arcnave's"];
        if (containsAny(r.answer, selfIntroMarkers) && containsAny(firstAnswer, selfIntroMarkers)) {
          return { ok: false, reason: `repeated a self-introduction across turns: "${r.answer}"` };
        }
        return { ok: true, reason: 'no repeated self-introduction' };
      },
    });
  }

  // G — Short-message / acknowledgement handling (reply in kind, not a
  // capability menu).
  const acknowledgements = [
    ['g1', 'ok'],
    ['g2', 'thanks'],
    ['g3', 'seri'],
    ['g4', 'haha'],
    ['g5', 'wait'],
    ['g6', 'hmm'],
  ];
  for (const [id, question] of acknowledgements) {
    scenarios.push({
      id, category: 'G: acknowledgement handling', question,
      expect: (r) => {
        if (containsAny(r.answer, ['i can help you with', 'here are some things i can do', "here's what i can do"])) {
          return { ok: false, reason: `restated a capability menu for a bare acknowledgement: "${r.answer}"` };
        }
        if (r.answer.length > 200) {
          return { ok: false, reason: `unexpectedly long reply (${r.answer.length} chars) to a bare acknowledgement: "${r.answer}"` };
        }
        return { ok: true, reason: 'short, in-kind reply' };
      },
    });
  }

  // I — Language matching (Tamil/Tanglish/English — respond in
  // whatever the user is actually using).
  const languageProbes = [
    ['i1', 'இன்று விடுமுறை நாளா?', 'tamil-script-expected'],
    ['i2', 'summer vacation eppo start aagum-nu therியுமா', 'tanglish-or-tamil-expected'],
    ['i3', 'When does summer vacation start?', 'english-expected'],
  ];
  for (const [id, question, mode] of languageProbes) {
    scenarios.push({
      id, category: 'I: language matching', question,
      expect: (r) => {
        const tamil = hasTamilScript(r.answer);
        if (mode === 'tamil-script-expected' && !tamil) {
          return { ok: false, reason: `expected Tamil-script reply, got: "${r.answer}"` };
        }
        if (mode === 'english-expected' && tamil) {
          return { ok: false, reason: `expected an English reply to an English question, got Tamil script: "${r.answer}"` };
        }
        return { ok: true, reason: 'language roughly matched (manual eyeball recommended for this category)' };
      },
    });
  }

  // J — Artifact tool-naming (aiService.js ~line 274: chat text alone
  // never actually changes the artifact; the model must call
  // update_artifact_content/export_artifact explicitly).
  const artifactFocus = { entityType: 'artifact', id: artifactId };
  const artifactScenarios = [
    ['j1', 'Draft a one-page summary of this term\'s academic performance', 'update_artifact_content'],
    ['j2', 'please rewrite this to be more formal', 'update_artifact_content'],
    ['j3', 'looks good — save this as a PDF please', 'export_artifact'],
  ];
  for (const [id, question, expectedTool] of artifactScenarios) {
    scenarios.push({
      id, category: 'J: artifact tool-naming', question, focusContext: artifactFocus,
      expect: (r) => (r.toolUsed === expectedTool
        ? { ok: true, reason: `correctly called ${expectedTool}` }
        : { ok: false, reason: `expected ${expectedTool}, got ${r.toolUsed || 'no tool'} — answer: "${r.answer}"` }),
    });
  }

  return scenarios;
}

// --- Runner -------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function isRateLimitError(err) {
  return /RESOURCE_EXHAUSTED|"code":\s*429/.test(err.message || '');
}

// Vertex AI's own per-minute quota is the real constraint a first live
// run of this suite found (17 of 18 initial failures were 429
// RESOURCE_EXHAUSTED, not real behavioral findings) — this is
// deliberately NOT the same "don't wait, just fail" posture the rest of
// the pipeline takes for a genuine LLM error; a quota exhaustion is a
// transient rate-limit, not a real answer to judge a scenario against,
// so it's worth a few backed-off retries before this scenario is
// counted as a FAIL at all.
async function withRetry(fn, { retries = 4, baseDelayMs = 15000 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= retries) throw err;
      const delay = baseDelayMs * (2 ** attempt);
      console.log(`         (rate-limited, retrying in ${Math.round(delay / 1000)}s — attempt ${attempt + 1}/${retries})`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    }
  }
}

async function runScenario(appPool, { collegeId, userId }, scenario) {
  const identityContext = { userId, role: 'principal', collegeId };
  try {
    if (scenario.twoTurn) {
      const firstResult = await withRetry(() => withTenantClient(appPool, collegeId, (client) => aiService.askAgent(
        client, scenario.twoTurn, { identityContext },
      )));
      const secondResult = await withRetry(() => withTenantClient(appPool, collegeId, (client) => aiService.askAgent(
        client,
        scenario.question,
        {
          identityContext,
          history: [
            { role: 'user', content: scenario.twoTurn },
            { role: 'assistant', content: firstResult.answer },
          ],
        },
      )));
      const { ok, reason } = scenario.expect(secondResult, { firstAnswer: firstResult.answer });
      return {
        ok, reason, answer: secondResult.answer, toolUsed: secondResult.toolUsed,
      };
    }

    const result = await withRetry(() => withTenantClient(appPool, collegeId, (client) => aiService.askAgent(
      client,
      scenario.question,
      { identityContext, focusContext: scenario.focusContext },
    )));
    const { ok, reason } = scenario.expect(result);
    return {
      ok, reason, answer: result.answer, toolUsed: result.toolUsed,
    };
  } catch (err) {
    return {
      ok: false, reason: `unexpected error: ${err.message}`, answer: null, toolUsed: null,
    };
  }
}

async function main() {
  if (!config.gemini || !config.gemini.projectId) {
    console.error('config.gemini.projectId is not set (GEMINI_PROJECT_ID) — nothing to test against. Aborting.');
    process.exitCode = 1;
    return;
  }
  console.log(`Provider: config.defaultAiProvider=${config.defaultAiProvider} (expected 'gemini' for this run)`);

  const adminPool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const appPool = new Pool({ connectionString: process.env.DATABASE_URL });
  let tenant;
  try {
    tenant = await seedTenant(adminPool);
  } catch (err) {
    console.error(`Could not seed a tenant — is Postgres running and migrated? ${err.message}`);
    process.exitCode = 1;
    await adminPool.end();
    await appPool.end();
    return;
  }

  const scenarios = buildScenarios({ artifactId: tenant.artifactId });
  const results = [];

  try {
    for (const scenario of scenarios) {
      // Sequential, not Promise.all — real API rate limits, and each
      // scenario's own tenant transaction should never overlap another's.
      // eslint-disable-next-line no-await-in-loop
      const outcome = await runScenario(appPool, tenant, scenario);
      results.push({ ...scenario, ...outcome });
      const status = outcome.ok ? 'PASS' : 'FAIL';
      console.log(`[${status}] ${scenario.id} (${scenario.category}) — ${outcome.reason}`);
      if (!outcome.ok) {
        console.log(`         answer: ${JSON.stringify(outcome.answer)}`);
      }
      // Fixed pacing between scenarios, on top of withRetry's own
      // backoff — a first live run of this suite hit Vertex AI's
      // per-minute quota firing calls back-to-back with no spacing at
      // all; this is cheap insurance against triggering the same 429s
      // withRetry would otherwise have to recover from every time.
      // eslint-disable-next-line no-await-in-loop
      await sleep(3000);
    }
  } finally {
    await cleanupTenant(adminPool, tenant.collegeId).catch((err) => console.error(`cleanup failed: ${err.message}`));
    await adminPool.end();
    await appPool.end();
  }

  const passCount = results.filter((r) => r.ok).length;
  console.log('\n--- Summary ---');
  console.log(`${passCount}/${results.length} passed`);
  const byCategory = {};
  for (const r of results) {
    byCategory[r.category] = byCategory[r.category] || { pass: 0, total: 0 };
    byCategory[r.category].total += 1;
    if (r.ok) byCategory[r.category].pass += 1;
  }
  for (const [category, { pass, total }] of Object.entries(byCategory)) {
    console.log(`  ${category}: ${pass}/${total}`);
  }
  process.exitCode = passCount === results.length ? 0 : 1;
}

main();
