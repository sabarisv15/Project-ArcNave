'use strict';

// Tool-invocation core for aiService.js's three real entry points —
// invokeTool (Policy Gate -> handler -> Context Builder -> Prompt Safety
// Layer -> audit log, the pipeline every one of routes/ai.js's callers
// eventually goes through), invokeToolIdempotent (the Idempotency-Key
// wrapper for the direct-invoke route), and askAboutTool (invokeTool plus
// a caller-supplied follow-up question answered by the LLM). Split out of
// aiService.js — see that file's own header comment for the full split;
// moved verbatim, no behavior change.

const crypto = require('crypto');
const aiToolRegistry = require('../aiToolRegistry');
const aiContextBuilder = require('../aiContextBuilder');
const aiPromptSafetyLayer = require('../aiPromptSafetyLayer');
const aiActorContext = require('../aiActorContext');
const aiPolicyAssembly = require('../aiPolicyAssembly');
const aiContextAssembly = require('../aiContextAssembly');
const configurationService = require('../configurationService');
const auditLogRepository = require('../../repositories/auditLogRepository');
const idempotencyKeyRepository = require('../../repositories/idempotencyKeyRepository');
const tracer = require('../../tracing/tracer');
const aiExperienceLayer = require('../aiExperience');
const { AiServiceValidationError, AiIdempotencyKeyReusedError } = require('./errors');
const { FILE_TOOL_NAMES } = require('./sharedConstants');
const { buildEvidence, buildEvidenceTrail, verifyNumericClaims } = require('./evidence');
const { completeMaybeStreaming } = require('./llmCall');

function listTools() {
  return aiToolRegistry.listTools();
}

// Runs the whole pipeline for a single tool call: Policy Gate ->
// handler (a Business Service) -> Context Builder -> Prompt Safety
// Layer, then an audit log entry recording what ran and for whom —
// same "write the fact" pattern workflowService.submitRequest already
// uses for workflow_request_submitted. Only reached once the Policy
// Gate has already allowed the call — a rejection throws out of
// aiToolRegistry.invokeTool before any handler, and before this
// function's audit-log call, ever runs.
// Tools whose real result is (or names) a downloadable document row.
// export_artifact_as returns the document row directly (documentService.
// uploadPersonalDocument's own return shape). generate_document and
// export_artifact both go through artifactService.publishArtifact, which
// returns the ARTIFACT row — it only names its document via
// published_document_id, but (specifically so this function never has to
// guess/reconstruct a format that's now caller-chosen rather than always
// markdown) that same return also carries document_file_name/
// document_mime_type straight from the upload call publishArtifact itself
// just made. update_artifact_content deliberately excluded: it edits the
// artifact's draft, it never produces a downloadable file.
function extractDocumentAttachment(toolName, result) {
  if (!result) return null;
  // generate_image (RS-AIG-025) returns documentService.uploadPersonalDocument's
  // own raw row directly (no ArtifactService wrapper — a generated image
  // has no markdown/JSON structured-editable form to publish from, see
  // imageGenerationService.js's own comment), the same raw shape
  // export_artifact_as's underlying call already returns.
  if ((toolName === 'export_artifact_as' || toolName === 'generate_image') && result.id && result.file_name) {
    return {
      id: result.id,
      fileName: result.file_name,
      mimeType: result.mime_type,
      title: result.title,
    };
  }
  if ((toolName === 'generate_document' || toolName === 'export_artifact') && result.published_document_id) {
    return {
      id: result.published_document_id,
      fileName: result.document_file_name,
      mimeType: result.document_mime_type,
      title: result.title,
    };
  }
  // execute_code (consumer-tool-adaptation file-generation slice,
  // 2026-08-26) — keyed off `generatedDocumentId`, deliberately a
  // DIFFERENT field name from `published_document_id` above: a workbook
  // this tool produces went through artifactService.attachGeneratedFile,
  // never publishArtifact, and the two paths must never be confused
  // for one another (see that function's own comment on why they are
  // separate columns). Only present at all when the sandbox actually
  // produced a file AND it passed verification — execute_code's own
  // handler never sets this field on a failed/unverified/no-file result.
  if (toolName === 'execute_code' && result.generatedDocumentId) {
    return {
      id: result.generatedDocumentId,
      fileName: result.document_file_name,
      mimeType: result.document_mime_type,
      title: result.title,
    };
  }
  return null;
}

async function invokeTool(client, toolName, params, { identityContext, provider, model } = {}) {
  // ARCNAVE modernization P1 (PDF 1.15: "one turn shows as one tree")
  // — every tool call an AI turn makes becomes its own span, sharing
  // the request's traceId (tracer.js) with every LLM-call span
  // completeMaybeStreaming opens, so a real trace viewer (once one is
  // wired to an exporter) renders one turn as one tree, not
  // disconnected log lines.
  const result = await tracer.withSpan('ai_tool_call', { toolName }, () =>
    aiToolRegistry.invokeTool(toolName, { client, identityContext, params }),
  );
  const tool = aiToolRegistry.getTool(toolName);
  const document = extractDocumentAttachment(toolName, result);

  const contextEntry = aiContextBuilder.buildToolContext({
    toolName,
    dataClassification: tool.dataClassification,
    data: result,
  });
  const sanitizedContext = aiPromptSafetyLayer.buildSanitizedContext([contextEntry]);

  // Round 10 P2/P3 finding: neither the provider/model that made this
  // call, nor (for an L3 submission) which workflow_requests row it
  // produced, was ever captured here — only toolName/estimatedAffectedRows.
  // provider/model are optional: invokeToolIdempotent's direct-invoke
  // route (POST /ai/tools/:name/invoke) calls this with neither, since
  // no LLM chose that tool call — there is no provider/model to record.
  // workflowRequestId is read straight off the handler's own result,
  // never re-queried: every L3 handler in this registry returns the
  // entity row it just updated, and that row carries workflow_request_id
  // as a plain column (see notificationService.submitForApproval and its
  // siblings) — the same value already sitting in the response, not a
  // second fact to look up.
  const metadata = { toolName };
  if (tool.maxAffectedRows) {
    // estimate() is a pure function over already-known params (no extra
    // DB call) — recomputed here only so the audit trail records the
    // same affected-row estimate the bulk-operation ceiling in
    // aiToolRegistry.checkToolPreconditions already evaluated.
    metadata.estimatedAffectedRows = tool.maxAffectedRows.estimate(params);
  }
  if (provider) metadata.provider = provider;
  if (model) metadata.model = model;
  if (tool.level === 'L3' && result && result.workflow_request_id) {
    metadata.workflowRequestId = result.workflow_request_id;
  }

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: identityContext.collegeId,
    userId: identityContext.userId,
    action: 'ai_tool_invoked',
    entity: 'ai_tools',
    entityId: null,
    metadata,
  });

  const presentation = aiExperienceLayer.buildPresentation({
    sanitizedContext,
    toolUsed: toolName,
    tool,
    actorRole: identityContext.role,
  });
  return { ...sanitizedContext, presentation, document };
}

function hashParams(params) {
  // Good-enough canonicalization, not a deep canonical-JSON sort: a
  // genuine retry re-sends the exact same client-constructed object,
  // which serializes identically. This only needs to catch "the same
  // key was reused for different params," not survive adversarial key
  // reordering — see AiIdempotencyKeyReusedError's own comment.
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(params || {}))
    .digest('hex');
}

// Idempotency wrapper around invokeTool for POST /ai/tools/:name/invoke
// (routes/ai.js) — opt-in via an Idempotency-Key header, so a client
// that never sends one sees no change in behavior. Not wired into
// askAgent/askAboutTool: those are the LLM-tool-selection and read-only
// paths respectively, neither of which this audit finding was about,
// and extending scope there was explicitly not asked for.
//
// The reserve -> invokeTool -> markCompleted sequence below runs
// entirely on the SAME `client` — the caller's own per-request
// transaction (tenantTransaction.js) — which is what makes this
// correct across a mid-request crash without any extra application-
// level compensation logic. See the idempotency_keys migration's own
// comment for the full crash-timing analysis (before COMMIT: nothing
// persisted, safe fresh retry; after COMMIT: the real response is
// already stored, safe replay) — this function does not need to
// special-case either case itself, Postgres's own transaction
// atomicity already guarantees both.
async function invokeToolIdempotent(client, toolName, params, { identityContext, idempotencyKey }) {
  const paramsHash = hashParams(params);

  let reservation;
  // A SAVEPOINT, not a bare try/catch around the INSERT alone: Postgres
  // aborts the ENTIRE surrounding transaction on any statement error,
  // including an ordinary unique-violation — every later statement on
  // this same client (this function's own findByKey below, and every
  // other query the rest of this request would still need to run)
  // would otherwise fail with "current transaction is aborted" even
  // though the conflict itself is an expected, handled case, not a
  // real failure. ROLLBACK TO SAVEPOINT undoes only the failed
  // reservation attempt and leaves the rest of the transaction usable
  // — the other existing 23505-catch patterns in this codebase
  // (financeService/workflowService) never needed this because they
  // always just re-throw and let the whole request fail; this
  // function is the one case that needs to keep going afterward.
  await client.query('SAVEPOINT idempotency_reserve');
  try {
    reservation = await idempotencyKeyRepository.reserve(client, {
      collegeId: identityContext.collegeId,
      userId: identityContext.userId,
      idempotencyKey,
      toolName,
      paramsHash,
    });
    await client.query('RELEASE SAVEPOINT idempotency_reserve');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT idempotency_reserve');
    if (err.code !== idempotencyKeyRepository.UNIQUE_VIOLATION) throw err;

    // Lost the reservation race (or this key was already used, in an
    // earlier request) — by the time our own blocked INSERT above was
    // able to proceed far enough to hit this real conflict, the other
    // transaction that owns this key had already committed (an
    // uncommitted conflicting row would have blocked us, not failed
    // us) — so this lookup is guaranteed to find a fully-completed row,
    // never a half-finished one. See the migration's own comment.
    const existing = await idempotencyKeyRepository.findByKey(client, {
      collegeId: identityContext.collegeId,
      userId: identityContext.userId,
      idempotencyKey,
    });
    if (!existing || existing.response_body === null) {
      throw new AiServiceValidationError(
        `Idempotency-Key ${JSON.stringify(idempotencyKey)} is in an unexpected state — please retry with a new key`,
      );
    }
    if (existing.params_hash !== paramsHash) {
      throw new AiIdempotencyKeyReusedError(
        `Idempotency-Key ${JSON.stringify(idempotencyKey)} was already used with different parameters`,
      );
    }
    return existing.response_body;
  }

  const result = await invokeTool(client, toolName, params, { identityContext });
  await idempotencyKeyRepository.markCompleted(client, reservation.id, result);
  return result;
}

async function askAboutTool(client, toolName, params, question, { identityContext } = {}, onDelta) {
  if (!question || typeof question !== 'string') {
    throw new AiServiceValidationError('question is required and must be a non-empty string');
  }

  // aiConfig resolved before invokeTool now (was after) so the tool's
  // own ai_tool_invoked audit row can carry provider/model — a config
  // read, not the LLM call itself, so the tool-call-is-audited-
  // regardless-of-downstream-LLM-failure ordering above is unaffected.
  const { adapter, config: aiConfig } = await configurationService.getAiConfig(client, identityContext.collegeId);
  const sanitizedContext = await invokeTool(client, toolName, params, {
    identityContext,
    provider: adapter.name,
    model: aiConfig.model,
  });
  const { systemPrompt, userPrompt } = aiPromptSafetyLayer.renderForLlm(sanitizedContext, question);
  const identityBlock = await aiActorContext.describeIdentityContext(client, identityContext);
  // ADR-030 P2(a): builds an ARCNAVE Context (ordered segments) instead
  // of a flat systemPrompt string — flattened back to today's exact
  // shape by each adapter via aiContextAssembly.flattenToPrompts, so
  // this is a representation change only, byte-identical output.
  // identityBlock stays last — ADR-030 P0, see executeWorkflowPlan's own
  // comment above for the full rationale (stable-prefix boundary for
  // future caching).
  const policy = aiPolicyAssembly.buildPolicy({
    mode: 'curriculum',
    hasHistory: false,
    toolCount: 1,
    hasFileTool: FILE_TOOL_NAMES.has(toolName),
    focusEntityType: null,
  });
  const arcnaveContext = aiContextAssembly.buildContext([
    aiContextAssembly.segment({
      source: 'safety-preamble',
      stability: aiContextAssembly.STABILITY.STATIC,
      target: 'system',
      content: systemPrompt,
    }),
    aiContextAssembly.segment({
      source: 'mode-prefix',
      stability: aiContextAssembly.STABILITY.STATIC,
      target: 'system',
      content: aiPolicyAssembly.MODE_PREFIX.curriculum,
    }),
    aiContextAssembly.segment({
      source: 'policy-modules',
      stability: aiContextAssembly.STABILITY.CONVERSATION,
      target: 'system',
      content: policy,
    }),
    aiContextAssembly.segment({
      source: 'identity',
      stability: aiContextAssembly.STABILITY.CONVERSATION,
      target: 'system',
      content: identityBlock,
    }),
    aiContextAssembly.segment({
      source: 'tool-result-data',
      stability: aiContextAssembly.STABILITY.VOLATILE,
      target: 'user',
      content: userPrompt,
    }),
  ]);
  const { text: answer, usage } = await completeMaybeStreaming(
    client,
    identityContext,
    adapter,
    aiConfig,
    arcnaveContext,
    'tool_question',
    onDelta,
  );

  const presentation = aiExperienceLayer.buildPresentation({
    sanitizedContext,
    question,
    answer,
    toolUsed: toolName,
    tool: aiToolRegistry.getTool(toolName),
    actorRole: identityContext.role,
  });
  const evidence = buildEvidence(sanitizedContext);
  return {
    ...sanitizedContext,
    question,
    answer,
    usage,
    presentation,
    evidence,
    evidenceTrail: buildEvidenceTrail(evidence),
    verification: verifyNumericClaims(answer, evidence),
  };
}

module.exports = {
  listTools,
  extractDocumentAttachment,
  invokeTool,
  hashParams,
  invokeToolIdempotent,
  askAboutTool,
};
