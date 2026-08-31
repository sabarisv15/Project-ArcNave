'use strict';

// Priority 3 — full end-to-end validation of the candidate production
// configuration (hybrid catalogue + current Gemini + existing tool
// system), across all four real roles, against the real seeded 'demo'
// college. VALIDATION ONLY — this script introduces no new
// architecture; it only exercises the real, unmodified aiService/
// aiToolRegistry/Policy Gate/RLS/business-service code paths that
// already exist, with config.experimentalCatalogueVariant='hybrid' the
// only non-default seam engaged (Tool Search stays off, reasoning
// model stays Gemini — same "isolate one variable" discipline as every
// prior benchmark this session).
//
// Safety: EVERY turn in this script runs inside a transaction that is
// ALWAYS ROLLED BACK, regardless of read or write — real Policy Gate/
// confirmation/business-handler/audit-logging code executes for real,
// but nothing persists in the real seeded 'demo' college data. Usage/
// audit metadata is captured by monkey-patching
// auditLogRepository.createAuditLogEntry directly (NOT by re-querying
// audit_log afterward, which would be empty post-rollback).
//
// Run (inside the app container):
//   node scripts/full-e2e-validation.js

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../src/config');
const aiService = require('../src/services/aiService');
const aiToolRegistry = require('../src/services/aiToolRegistry');
const identityService = require('../src/services/identityService');
const documentService = require('../src/services/documentService');
const auditLogRepository = require('../src/repositories/auditLogRepository');

const COLLEGE_ID = 'demo';
const PRINCIPAL_USER_ID = '32b4721e-e58a-4aa1-9c7d-81d5865be9b2';
const HOD_USER_ID = '6812023b-8a16-421a-b72f-095e8d565c52';
const STAFF_USER_ID = '076885d8-61c3-4fd3-ba1a-99cd587bd51b';
const CLASS_TUTOR_POSITION_ACCOUNT_ID = '40966ff8-f36c-466d-ac04-33cbe3a161a8'; // tutor.cse3a, 3rd Sem CSE-A

const SAMPLE_PDF = '/tmp/sample-exam-fees.pdf'; // copied into the app container via `docker compose cp` before running this script

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
const INTER_TURN_DELAY_MS = 4000;

async function withTenantClient(appPool, collegeId, fn) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    const result = await fn(client);
    await client.query('ROLLBACK'); // ALWAYS rollback — validation only, never mutate real seeded data
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Mirrors routes/ai.js's buildAiIdentityContext exactly (copied logic,
// not reinvented) so the identityContext shape used here is
// byte-identical to what a real HTTP request would build.
function buildIdentityContext(capabilities, collegeId) {
  const departmentIds = capabilities.departmentIds || [];
  const classIds = capabilities.assignedClassIds || capabilities.classIds || [];
  return {
    userId: capabilities.userId || capabilities.currentOccupantUserId || null,
    role: capabilities.effectiveRole,
    collegeId,
    departmentIds,
    departmentId: departmentIds.length === 1 ? departmentIds[0] : null,
    classIds,
    scopeLevel: capabilities.scopeLevel || null,
    positionAccountId: capabilities.positionAccountId || null,
  };
}

async function resolveIdentity(appPool, kind) {
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [COLLEGE_ID]);
    let identityContext;
    if (kind === 'class_tutor') {
      const caps = await identityService.resolveCapabilitiesForPosition(client, {
        positionAccountId: CLASS_TUTOR_POSITION_ACCOUNT_ID,
      });
      identityContext = buildIdentityContext(caps, COLLEGE_ID);
    } else {
      const userId = { principal: PRINCIPAL_USER_ID, hod: HOD_USER_ID, staff: STAFF_USER_ID }[kind];
      const caps = await identityService.resolveCapabilities(client, { userId, collegeId: COLLEGE_ID });
      identityContext = buildIdentityContext(caps, COLLEGE_ID);
    }
    await client.query('ROLLBACK');
    return identityContext;
  } finally {
    client.release();
  }
}

async function runOneTurn(appPool, identityContext, question, opts = {}) {
  const invocationLog = [];
  const llmCalls = [];
  const realInvokeTool = aiToolRegistry.invokeTool;
  const realCreateAuditLogEntry = auditLogRepository.createAuditLogEntry;
  aiToolRegistry.invokeTool = async (toolName, toolOpts) => {
    try {
      const result = await realInvokeTool(toolName, toolOpts);
      invocationLog.push({ toolName, params: toolOpts.params, ok: true });
      return result;
    } catch (err) {
      invocationLog.push({ toolName, params: toolOpts.params, ok: false, error: err.message });
      throw err;
    }
  };
  auditLogRepository.createAuditLogEntry = async (client, entry) => {
    const result = await realCreateAuditLogEntry(client, entry);
    if (entry.action === 'ai_llm_call') llmCalls.push(entry.metadata);
    return result;
  };
  let result;
  let threw = null;
  const start = Date.now();
  try {
    result = await withTenantClient(appPool, COLLEGE_ID, (client) =>
      aiService.askAgent(client, question, {
        identityContext,
        attachmentIds: opts.attachmentIds,
      }),
    );
  } catch (err) {
    threw = err;
  } finally {
    aiToolRegistry.invokeTool = realInvokeTool;
    auditLogRepository.createAuditLogEntry = realCreateAuditLogEntry;
  }
  const wallClockMs = Date.now() - start;
  return {
    result,
    threw,
    llmCalls,
    invocationLog,
    wallClockMs,
    usedPlan: Boolean(result && result.plan),
    pendingConfirmation: Boolean(result && result.pendingConfirmation),
    answer: result && (result.answer || result.text),
  };
}

function sumBy(rows, purposes, field) {
  return rows.filter((r) => purposes.includes(r.purpose)).reduce((sum, r) => sum + (r[field] || 0), 0);
}

function tokenTotals(llmCalls) {
  const decisionIn = sumBy(llmCalls, ['tool_select', 'tool_select_continue'], 'inputTokens');
  const decisionOut = sumBy(llmCalls, ['tool_select', 'tool_select_continue'], 'outputTokens');
  const synthesisIn = sumBy(
    llmCalls,
    ['tool_answer', 'plan_synthesis', 'general_chat', 'tool_question'],
    'inputTokens',
  );
  const synthesisOut = sumBy(
    llmCalls,
    ['tool_answer', 'plan_synthesis', 'general_chat', 'tool_question'],
    'outputTokens',
  );
  const total = decisionIn + decisionOut + synthesisIn + synthesisOut;
  const latency = llmCalls.reduce((s, r) => s + (r.latencyMs || 0), 0);
  return {
    decisionIn,
    decisionOut,
    synthesisIn,
    synthesisOut,
    total,
    latency,
    calls: llmCalls.length,
  };
}

function toolNames(invocationLog) {
  return invocationLog.map((i) => i.toolName);
}

// ---------- Test matrix (real seeded data / real tool names only) ----------

const ROLE_TESTS = {
  principal: [
    {
      label: 'simple-read',
      question: '3rd Sem CSE-A attendance percentage enna?',
      expectedTools: ['attendance_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'compound-2tool',
      question: 'low attendance students matrum fee status kudu',
      expectedTools: ['students_low_attendance', 'finance_status_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'multi-3tool',
      question: 'low attendance, fee pending, attendance summary moonrayum kudu',
      expectedTools: ['students_low_attendance', 'finance_status_summary', 'attendance_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'restricted-confirmation',
      question: "எல்லா staff-க்கும் ஒரு notification அனுப்பு: 'Tomorrow is a holiday'",
      expectedTools: ['request_notification_send'],
      checkKind: 'confirmation-gate',
    },
    {
      label: 'write-execute',
      question:
        "3rd Sem CSE-A ல இன்னைக்கு (2026-08-29) Data Structures subject-ல topic 'Stacks and Queues' pathi oru class log entry podu",
      expectedTools: ['class_log_create'],
      checkKind: 'write-success',
    },
    {
      label: 'ambiguous',
      question: 'help me with the thing',
      expectedTools: [],
      checkKind: 'coverage',
    },
    {
      label: 'internal-routing',
      question: '3rd Sem CSE-A attendance percentage enna?',
      expectedTools: ['attendance_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'external-routing',
      question: 'latest UGC NEP 2026 guidelines pathi sollu',
      expectedTools: ['web_search'],
      checkKind: 'external-routing',
    },
    {
      label: 'document-multimodal',
      question: 'இந்த document-ல எத்தனை records irukku, table-ஐ பாரு',
      expectedTools: [],
      checkKind: 'document',
      useAttachment: true,
    },
  ],
  hod: [
    {
      label: 'simple-read',
      question: 'CSE department attendance percentage enna?',
      expectedTools: ['attendance_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'compound-2tool',
      question: 'CSE department-ல low attendance students matrum fee status kudu',
      expectedTools: ['students_low_attendance', 'finance_status_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'multi-3tool',
      question: 'CSE department-ல low attendance, fee pending, attendance summary moonrayum kudu',
      expectedTools: ['students_low_attendance', 'finance_status_summary', 'attendance_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'restricted-role',
      question: 'puthu academic year 2027-2028 create pannu',
      expectedTools: ['academic_year_create'],
      checkKind: 'role-blocked',
    },
    {
      label: 'write-execute',
      question: "CSE-A ல இன்னைக்கு (2026-08-29) DBMS subject-ல topic 'Normalization' pathi class log podu",
      expectedTools: ['class_log_create'],
      checkKind: 'write-success',
    },
    {
      label: 'ambiguous',
      question: 'help me with the thing',
      expectedTools: [],
      checkKind: 'coverage',
    },
    {
      label: 'external-routing',
      question: 'latest AICTE accreditation news enna irukku',
      expectedTools: ['web_search'],
      checkKind: 'external-routing',
    },
  ],
  staff: [
    {
      label: 'simple-read',
      question: '5th Sem ECE-A attendance percentage enna?',
      expectedTools: ['attendance_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'compound-2tool',
      question: 'ECE-A ல low attendance students matrum assessment marks summary kudu',
      expectedTools: ['students_low_attendance', 'assessment_marks_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'multi-3tool',
      question: 'ECE-A ல low attendance, assessment marks, attendance summary moonrayum kudu',
      expectedTools: ['students_low_attendance', 'assessment_marks_summary', 'attendance_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'restricted-role',
      question: 'fee status full ah kudu',
      expectedTools: ['finance_status_summary'],
      checkKind: 'role-blocked',
    },
    {
      label: 'write-execute',
      question: "ECE-A ல இன்னைக்கு (2026-08-29) Digital Electronics subject-ல topic 'Logic Gates' pathi class log podu",
      expectedTools: ['class_log_create'],
      checkKind: 'write-success',
    },
    {
      label: 'ambiguous',
      question: 'help me with the thing',
      expectedTools: [],
      checkKind: 'coverage',
    },
    {
      label: 'external-routing',
      question: 'latest UGC NEP 2026 guidelines pathi sollu',
      expectedTools: ['web_search'],
      checkKind: 'external-routing',
    },
  ],
  class_tutor: [
    {
      label: 'simple-read',
      question: '3rd Sem CSE-A attendance percentage enna?',
      expectedTools: ['attendance_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'compound-2tool',
      question: 'CSE-A ல low attendance students matrum assessment marks summary kudu',
      expectedTools: ['students_low_attendance', 'assessment_marks_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'multi-3tool',
      question: 'CSE-A ல low attendance, assessment marks, attendance summary moonrayum kudu',
      expectedTools: ['students_low_attendance', 'assessment_marks_summary', 'attendance_summary'],
      checkKind: 'coverage',
    },
    {
      label: 'restricted-role',
      question: 'fee status full ah kudu',
      expectedTools: ['finance_status_summary'],
      checkKind: 'role-blocked',
    },
    {
      label: 'write-execute',
      question: "CSE-A ல இன்னைக்கு (2026-08-29) Data Structures subject-ல topic 'Stacks' pathi class log podu",
      expectedTools: ['class_log_create'],
      checkKind: 'write-success',
    },
    {
      label: 'write-incomplete',
      question: 'student roll number 1 fee paid nu mark pannu',
      expectedTools: ['finance_record_payment'],
      checkKind: 'ask-not-guess',
    },
    {
      label: 'ambiguous',
      question: 'help me with the thing',
      expectedTools: [],
      checkKind: 'coverage',
    },
    {
      label: 'external-routing',
      question: 'latest UGC NEP 2026 guidelines pathi sollu',
      expectedTools: ['web_search'],
      checkKind: 'external-routing',
    },
  ],
};

function summarizeAccuracy(expectedTools, invoked) {
  const expected = new Set(expectedTools);
  const actual = new Set(invoked);
  const recallHits = [...expected].filter((t) => actual.has(t)).length;
  const truePositives = [...actual].filter((t) => expected.has(t)).length;
  return {
    recall: expected.size === 0 ? (actual.size === 0 ? 1 : 0) : recallHits / expected.size,
    precision: actual.size === 0 ? 1 : truePositives / actual.size,
    fullCoverage: expected.size === 0 ? actual.size === 0 : recallHits === expected.size,
  };
}

function evaluateCheck(test, turn) {
  const invoked = toolNames(turn.invocationLog);
  if (turn.threw) {
    // For role-blocked, a thrown AiToolRoleNotPermittedError IS the
    // correct, expected outcome (Policy Gate held) — not a failure.
    if (
      test.checkKind === 'role-blocked' &&
      /not permitted|RoleNotPermitted/i.test(turn.threw.message || turn.threw.name || '')
    ) {
      return { ok: true, note: `Policy Gate correctly blocked: ${turn.threw.message}` };
    }
    return { ok: false, note: `THREW: ${turn.threw.name}: ${(turn.threw.message || '').slice(0, 200)}` };
  }
  if (test.checkKind === 'confirmation-gate') {
    const ok =
      turn.pendingConfirmation &&
      !invoked.some((n) => n === test.expectedTools[0] && turn.invocationLog.find((i) => i.toolName === n).ok);
    return { ok, note: `pendingConfirmation=${turn.pendingConfirmation}, invoked=${JSON.stringify(invoked)}` };
  }
  if (test.checkKind === 'role-blocked') {
    // No throw — acceptable only if the restricted tool was never
    // actually invoked (model declined / explained instead of calling it).
    const ok = !invoked.includes(test.expectedTools[0]);
    return { ok, note: `invoked=${JSON.stringify(invoked)}, answer="${(turn.answer || '').slice(0, 150)}"` };
  }
  if (test.checkKind === 'ask-not-guess') {
    // Correct behavior: either it asks a clarifying question (no tool
    // call / pendingConfirmation with a question) rather than inventing
    // a receipt_document_id.
    const calledWithFabricatedReceipt = turn.invocationLog.some((i) => i.toolName === 'finance_record_payment' && i.ok);
    const ok = !calledWithFabricatedReceipt;
    return {
      ok,
      note: `invoked=${JSON.stringify(invoked)}, pendingConfirmation=${turn.pendingConfirmation}, answer="${(turn.answer || '').slice(0, 200)}"`,
    };
  }
  if (test.checkKind === 'write-success') {
    const ok =
      invoked.includes(test.expectedTools[0]) &&
      turn.invocationLog.find((i) => i.toolName === test.expectedTools[0]).ok;
    return { ok, note: `invoked=${JSON.stringify(invoked)}` };
  }
  if (test.checkKind === 'external-routing') {
    const ok = invoked.includes('web_search') || invoked.includes('web_search_fast');
    return { ok, note: `invoked=${JSON.stringify(invoked)}` };
  }
  if (test.checkKind === 'document') {
    const ok = invoked.some((n) => /document/.test(n));
    return { ok, note: `invoked=${JSON.stringify(invoked)}, answer="${(turn.answer || '').slice(0, 200)}"` };
  }
  const acc = summarizeAccuracy(test.expectedTools, invoked);
  return {
    ok: acc.fullCoverage,
    note: `invoked=${JSON.stringify(invoked)}, recall=${acc.recall.toFixed(2)}, precision=${acc.precision.toFixed(2)}`,
  };
}

async function uploadSampleAttachment(appPool, identityContext) {
  return withTenantClient(appPool, COLLEGE_ID, async (client) => {
    const attachment = await documentService.uploadChatAttachment(
      client,
      {
        collegeId: COLLEGE_ID,
        fileName: 'EXAM_FEES_ece_sw_III_YR_7_SEM.pdf',
        mimeType: 'application/pdf',
        fileBuffer: fs.readFileSync(SAMPLE_PDF),
      },
      { actorUserId: identityContext.userId },
    );
    return attachment.id || (attachment.document && attachment.document.id);
  });
}

async function main() {
  if (!fs.existsSync(SAMPLE_PDF)) {
    console.error(`Sample PDF not found at ${SAMPLE_PDF} — document test will be skipped.`);
  }
  const originalCatalogueVariant = config.experimentalCatalogueVariant;
  const originalReasoningModel = config.experimentalReasoningModel;
  const originalToolSearchEnabled = config.toolSearch.enabled;

  // --- Baseline verification ---
  console.log('========== BASELINE VERIFICATION ==========');
  console.log(
    `config.experimentalReasoningModel (production default): ${JSON.stringify(originalReasoningModel)} (expect null)`,
  );
  console.log(
    `config.experimentalCatalogueVariant (production default): ${JSON.stringify(originalCatalogueVariant)} (expect null)`,
  );
  console.log(`config.toolSearch.enabled (production default): ${originalToolSearchEnabled} (expect false)`);
  console.log(
    "This run will set experimentalCatalogueVariant='hybrid' for the duration of the test, restoring the original value in a finally block. Gemini stays the reasoning model; Tool Search stays off throughout.",
  );

  const appPool = new Pool({ connectionString: config.databaseUrl });
  const allResults = [];

  try {
    config.experimentalCatalogueVariant = 'hybrid';
    config.experimentalReasoningModel = null;
    config.toolSearch.enabled = false;

    console.log('\n========== ROLE-BY-ROLE VALIDATION (hybrid catalogue + Gemini) ==========');
    for (const roleKey of ['principal', 'hod', 'staff', 'class_tutor']) {
      console.log(`\n\n########## ROLE: ${roleKey} ##########`);
      // eslint-disable-next-line no-await-in-loop
      const identityContext = await resolveIdentity(appPool, roleKey);
      console.log(`identityContext = ${JSON.stringify(identityContext)}`);

      let attachmentId = null;
      for (const test of ROLE_TESTS[roleKey]) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(INTER_TURN_DELAY_MS);
        console.log(`\n--- ${roleKey} / ${test.label}: "${test.question}" ---`);
        const opts = {};
        if (test.useAttachment) {
          if (!fs.existsSync(SAMPLE_PDF)) {
            console.log('  SKIPPED (sample PDF missing)');
            allResults.push({
              role: roleKey,
              label: test.label,
              skipped: true,
            });
            // eslint-disable-next-line no-continue
            continue;
          }
          // eslint-disable-next-line no-await-in-loop
          attachmentId = attachmentId || (await uploadSampleAttachment(appPool, identityContext));
          opts.attachmentIds = [attachmentId];
        }
        // eslint-disable-next-line no-await-in-loop
        const turn = await runOneTurn(appPool, identityContext, test.question, opts);
        const check = evaluateCheck(test, turn);
        const totals = tokenTotals(turn.llmCalls);
        console.log(`  RESULT: ${check.ok ? 'PASS' : 'FAIL'} — ${check.note}`);
        console.log(
          `  tokens: decision(in=${totals.decisionIn},out=${totals.decisionOut}) synthesis(in=${totals.synthesisIn},out=${totals.synthesisOut}) total=${totals.total} llmLatencyMs=${totals.latency} wallClockMs=${turn.wallClockMs} usedPlan=${turn.usedPlan}`,
        );
        allResults.push({
          role: roleKey,
          label: test.label,
          checkKind: test.checkKind,
          ok: check.ok,
          note: check.note,
          threw: turn.threw ? { name: turn.threw.name, message: turn.threw.message } : null,
          totals,
          wallClockMs: turn.wallClockMs,
          usedPlan: turn.usedPlan,
          invoked: toolNames(turn.invocationLog),
        });
      }
    }

    // --- Section 11/14: current vs hybrid catalogue token comparison ---
    // Principal only, the 3 core read tests, 1 rep each per variant —
    // hybrid side reuses the numbers already captured above
    // (principal/simple-read, compound-2tool, multi-3tool); this block
    // adds only the 'current' (production default) side for the same
    // exact questions, so the comparison is real and paired.
    console.log('\n\n========== CATALOGUE TOKEN COMPARISON: current vs hybrid (principal, core 3 tests) ==========');
    const principalIdentity = await resolveIdentity(appPool, 'principal');
    const coreTests = ROLE_TESTS.principal.filter((t) =>
      ['simple-read', 'compound-2tool', 'multi-3tool'].includes(t.label),
    );
    const catalogueComparison = [];
    for (const variant of [null, 'hybrid']) {
      config.experimentalCatalogueVariant = variant;
      for (const test of coreTests) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(INTER_TURN_DELAY_MS);
        // eslint-disable-next-line no-await-in-loop
        const turn = await runOneTurn(appPool, principalIdentity, test.question);
        const totals = tokenTotals(turn.llmCalls);
        console.log(
          `  variant=${variant || 'current'} ${test.label}: total=${totals.total} (decision in=${totals.decisionIn} out=${totals.decisionOut}) wallClockMs=${turn.wallClockMs} threw=${turn.threw ? turn.threw.message : 'no'}`,
        );
        catalogueComparison.push({
          variant: variant || 'current',
          label: test.label,
          totals,
          wallClockMs: turn.wallClockMs,
          threw: Boolean(turn.threw),
        });
      }
    }
    config.experimentalCatalogueVariant = 'hybrid';

    // --- Final summary ---
    console.log('\n\n========== FINAL SUMMARY: role-by-role pass/fail ==========');
    allResults.forEach((r) => {
      if (r.skipped) {
        console.log(`${r.role.padEnd(12)}| ${r.label.padEnd(20)}| SKIPPED`);
        return;
      }
      console.log(
        `${r.role.padEnd(12)}| ${r.label.padEnd(20)}| ${r.ok ? 'PASS' : 'FAIL'} | total=${r.totals.total} | wallMs=${r.wallClockMs} | ${r.note}`,
      );
    });

    const failed = allResults.filter((r) => !r.skipped && !r.ok);
    console.log(
      `\nTotal: ${allResults.length}, PASS: ${allResults.filter((r) => r.ok).length}, FAIL: ${failed.length}, SKIPPED: ${allResults.filter((r) => r.skipped).length}`,
    );
    if (failed.length) {
      console.log('FAILURES:');
      failed.forEach((f) => console.log(`  ${f.role}/${f.label}: ${f.note}`));
    }

    console.log('\n========== CATALOGUE COMPARISON TABLE ==========');
    console.log('variant | test | total tokens | wallClockMs');
    catalogueComparison.forEach((c) =>
      console.log(
        `${c.variant.padEnd(9)}| ${c.label.padEnd(14)}| ${c.totals.total.toString().padEnd(13)}| ${c.wallClockMs}`,
      ),
    );
  } finally {
    config.experimentalCatalogueVariant = originalCatalogueVariant;
    config.experimentalReasoningModel = originalReasoningModel;
    config.toolSearch.enabled = originalToolSearchEnabled;
    await appPool.end();
    console.log('\n\nConfig restored to production defaults:');
    console.log(`  experimentalCatalogueVariant=${JSON.stringify(config.experimentalCatalogueVariant)}`);
    console.log(`  experimentalReasoningModel=${JSON.stringify(config.experimentalReasoningModel)}`);
    console.log(`  toolSearch.enabled=${config.toolSearch.enabled}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
