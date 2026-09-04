'use strict';

// askAgent's DECIDE/ACT/VERIFY/WRITE-UP phases plus the askAgent
// orchestrator itself (P3 1.16 explicit phase-pipeline rewrite) — decide
// (the single initial completeWithTools call), act (the tool-call loop,
// including run_workflow_plan/describe_tools meta-tool handling), verify
// (local — document-coverage-gap refusal), writeUp (final answer
// synthesis), and askAgent (wires resolveTurnContext/fetchTools/
// buildDecisionContext from services/ai/turnSetup.js together with the
// phases below). Split out of aiService.js — see that file's own header
// comment for the full split; moved verbatim, no behavior change.
//
// ADL-050 (bka/30-decisions/ledger.md#adl-050): the system segments
// services/ai/turnSetup.js's buildDecisionContext builds once per turn
// are consumed here BY REFERENCE across every completeWithTools call in
// decide and every iteration of act's loop — never independently
// reconstructed. Moving these phases into their own file changes
// nothing about that guarantee: decisionCtx/continuationContext are
// passed in as plain JS objects, and object identity survives a
// require() boundary exactly as it did when every phase lived in one
// file.

const config = require('../../config');
const aiToolRegistry = require('../aiToolRegistry');
const aiActorContext = require('../aiActorContext');
const aiContextAssembly = require('../aiContextAssembly');
const aiPromptSafetyLayer = require('../aiPromptSafetyLayer');
const configurationService = require('../configurationService');
const aiModelVersionService = require('../aiModelVersionService');
const { logInfo, logWarn } = require('../../logging/logger');
const aiExperienceLayer = require('../aiExperience');
const { AiServiceValidationError } = require('./errors');
const { detectDocumentCoverageGap, buildCoverageRefusal } = require('./hints');
const { invokeTool } = require('./toolInvocation');
const {
  executeWorkflowPlan,
  validatePlanSteps,
  resolvePlanSteps,
  SCHEMA_TOOL_NAME,
  PLAN_TOOL_NAME,
  BUDGET_EXEMPT_LOOKUP_TOOLS,
  MAX_LOOKUP_CALLS,
  MAX_SCHEMA_FETCHES,
} = require('./workflowPlan');
const { buildEvidence, buildEvidenceTrail, verifyNumericClaims } = require('./evidence');
const {
  logLlmCall,
  renderToolResultText,
  addUsage,
  summarizeToolResult,
  logAttachmentTokenPreflight,
} = require('./llmCall');
const { askGeneralChat } = require('./askGeneralChat');
const { resolveTurnContext, fetchTools, buildDecisionContext } = require('./turnSetup');

// Audit-only, never returned to any caller or included in an API
// response — RS-AIG-027 ("never expose as evidence") still governs the
// SUMMARY's use even though #27 opts into requesting it. A thought
// summary is only ever this thin: logged, for a human to read in the
// logs while deciding whether the rollout is worth keeping.
function logThoughtSummaryIfPresent(identityContext, thoughtSummary) {
  if (!thoughtSummary) return;
  logWarn('ai_thinking_trace_captured', { collegeId: identityContext.collegeId, thoughtSummary });
}

async function decide({
  client,
  identityContext,
  adapter,
  aiConfig,
  decisionContext,
  tools,
  fallbackState,
  imagesSupported,
  images,
  imageAnalysisUnavailable,
  promptVersionTag,
  onStep,
}) {
  const decisionStartedAt = Date.now();
  // Real progress signal (P1) for the one call in this path that
  // previously fired no onStep event at all.
  onStep({ phase: 'deciding' });
  const decision = await adapter.completeWithTools(aiConfig, decisionContext);
  logThoughtSummaryIfPresent(identityContext, decision.thoughtSummary);
  // CEO Vertex/Gemini audit #41 (2026-08-30) — a drift DETECTOR, not a
  // pin. `provider` is read from `adapter.name` here since that's already
  // the real resolved provider name regardless of which branch produced
  // this adapter.
  aiModelVersionService.recordObservedVersion(
    identityContext.collegeId,
    adapter.name,
    aiConfig.model,
    decision.modelVersion,
  );
  // ARCNAVE modernization P5 ("prompt and model version registry") —
  // both halves of "same input and tools give the same result" in one
  // log line: which prompt modules were assembled (promptVersionTag)
  // and which model actually answered (adapter.name/aiConfig.model, the
  // same values aiModelVersionService's own drift check just used).
  // Diagnostics only — never read back by any code path, so it can
  // never affect a real turn's behavior.
  logInfo('ai_decision_versions', {
    collegeId: identityContext.collegeId,
    provider: adapter.name,
    model: aiConfig.model,
    modelVersion: decision.modelVersion || null,
    promptVersionTag,
  });
  // imageCount reflects images actually included in the request sent to
  // the provider — never the raw attachmentIds count.
  const imageCount = imagesSupported ? images.length : 0;
  await logLlmCall(client, {
    identityContext,
    adapter,
    aiConfig,
    purpose: 'tool_select',
    usage: decision.usage,
    latencyMs: Date.now() - decisionStartedAt,
    imageCount,
    systemPromptChars: aiContextAssembly.flattenToPrompts(decisionContext).systemPrompt.length,
    toolCount: tools.length,
    providerFallbackTriggered: fallbackState ? fallbackState.triggered : undefined,
    providerFallbackReason: fallbackState && fallbackState.triggered ? fallbackState.reason : undefined,
  });
  const imageMeta = { imageCount, imageAnalysisUnavailable };

  return { decision, imageMeta };
}

// Phase 5 — ACT. The bounded tool-use loop: schema lookups, the bounded
// plan meta-tool, L3/bulk-guard confirmation, tool invocation, and
// continuation decision calls. May return early (pending confirmation, or
// full delegation to executeWorkflowPlan) — same shapes as before this
// refactor. Every completeWithTools call here reads
// `holder.continuationContext`, never `decisionContext` (that one
// consumer already ran in decide()) — same system segments either way
// (sharedSystemSegments is reused by reference in both, via
// continuationSegments), only the user 'question' segment differs.
async function act({
  client,
  identityContext,
  question,
  roleTools,
  tools,
  adapter,
  aiConfig,
  historyTurns,
  identityBlock,
  answerPromptQuestion,
  imageMeta,
  contextInputs,
  holder,
  initialDecision,
  onStep,
  onDelta,
}) {
  const priorTurns = [];
  const mergedEntries = [];
  const invokedTools = []; // aiToolRegistry tool objects, in call order
  let usageTotal = initialDecision.usage ? { ...initialDecision.usage } : undefined;
  let blockedActionNote;
  let decision = initialDecision;

  let schemaFetches = 0;
  // Tool calls that actually spent the turn's budget. Distinct from
  // invokedTools.length, which also counts BUDGET_EXEMPT_LOOKUP_TOOLS.
  let budgetedCalls = 0;
  let lookupCalls = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Schema lookup, not a business action: runs no handler, touches no
    // Business Service. Does NOT push to invokedTools and does NOT
    // consume config.maxToolCallsPerTurn. See ai-tool-catalogue-approved-spec.md.
    if (decision.type === 'tool_call' && decision.toolName === SCHEMA_TOOL_NAME) {
      schemaFetches += 1;
      const requested = ((decision.arguments && decision.arguments.names) || []).filter((n) => typeof n === 'string');
      let resultText;
      if (schemaFetches > MAX_SCHEMA_FETCHES) {
        // A plain refusal, never a throw — a loop backstop must not end
        // the user's turn in an error.
        resultText =
          `No more tool lookups are available this turn (limit ${MAX_SCHEMA_FETCHES}). ` +
          'Answer with the tools you already have, or say plainly what you would need.';
      } else {
        // Resolved against roleTools only. An unpermitted name and a
        // nonexistent one return the SAME message.
        const resolvedTools = requested.map((n) => roleTools.find((t) => t.name === n)).filter(Boolean);
        const added = resolvedTools.filter((t) => !holder.offeredTools.some((o) => o.name === t.name));
        if (added.length > 0) {
          holder.offeredTools = [...holder.offeredTools, ...added];
          // Same segment objects, larger tools array — the ADL-050
          // constraint holds by construction, not by convention. Only
          // continuationContext needs rebuilding here — decisionContext's
          // one consumer has already run.
          holder.continuationContext = aiContextAssembly.buildContext(contextInputs.continuationSegments, {
            tools: holder.offeredTools,
            images: contextInputs.decisionImages,
            media: contextInputs.decisionMedia,
            thinkingLevel: contextInputs.thinkingLevel,
            cachedSystemInstructionName: contextInputs.cachedSystemInstructionName,
            historyTurns,
          });
        }
        const unknown = requested.filter((n) => !resolvedTools.some((t) => t.name === n));
        resultText = [
          resolvedTools.length > 0
            ? `These tools are now callable: ${resolvedTools.map((t) => t.name).join(', ')}.`
            : null,
          unknown.length > 0 ? `No such tool available to you: ${unknown.join(', ')}.` : null,
        ]
          .filter(Boolean)
          .join(' ');
      }
      priorTurns.push({
        toolName: SCHEMA_TOOL_NAME,
        arguments: decision.arguments || {},
        callId: decision.callId,
        rawToolCall: decision.rawToolCall,
        resultText,
      });
      onStep({ phase: 'deciding' });
      // eslint-disable-next-line no-await-in-loop
      decision = await adapter.completeWithTools(aiConfig, holder.continuationContext, priorTurns);
      usageTotal = addUsage(usageTotal, decision.usage);
      // eslint-disable-next-line no-continue
      continue;
    }

    if (decision.type === 'tool_call' && decision.toolName === PLAN_TOOL_NAME) {
      const steps = (decision.arguments && decision.arguments.steps) || [];
      validatePlanSteps(steps, tools);
      const { resolved, needsConfirmation, confirmationLines } = await resolvePlanSteps(steps, {
        client,
        identityContext,
      });

      if (needsConfirmation) {
        const confirmationQuestion = `This plan involves:\n${confirmationLines.join('\n')}\n\nShall I go ahead?`;
        const sanitizedContext = aiPromptSafetyLayer.buildSanitizedContext([]);
        const presentation = aiExperienceLayer.buildPresentation({
          sanitizedContext,
          question,
          answer: confirmationQuestion,
          toolUsed: null,
          tool: null,
          actorRole: identityContext.role,
        });
        return {
          earlyReturn: true,
          response: {
            ...sanitizedContext,
            ...imageMeta,
            question,
            toolUsed: null,
            answer: confirmationQuestion,
            presentation,
            pendingConfirmation: { steps: resolved },
          },
        };
      }

      // answerPromptQuestion, not promptQuestion: plan_synthesis is the
      // same "compose an answer from tool results" step as the
      // single-tool path below, reached by a different route.
      // Not awaited here (same as the pre-refactor bare `return
      // executeWorkflowPlan(...)`) — `response` carries the promise, and
      // askAgent's own `return actResult.response` auto-flattens it, same
      // as returning a promise directly from any async function.
      return {
        earlyReturn: true,
        response: executeWorkflowPlan(
          client,
          resolved,
          answerPromptQuestion,
          {
            identityContext,
            identityBlock,
            adapter,
            aiConfig,
            hasHistory: historyTurns.length > 0,
            historyTurns,
          },
          onDelta,
          onStep,
        ),
      };
    }

    if (decision.type !== 'tool_call') break;

    // RS-AIG-005: before filing any WorkflowService submission, the AI
    // must ask for explicit confirmation and only a clear affirmative
    // reply may trigger it. Runs on EVERY iteration, not just the first.
    const tool = aiToolRegistry.getTool(decision.toolName);

    // Lookup backstop, checked BEFORE the handler runs so the limit is
    // real. Budget-exempt does not mean cost-free: each one still spends
    // a completeWithTools round-trip. A plain refusal fed back as a tool
    // result, never a throw.
    if (BUDGET_EXEMPT_LOOKUP_TOOLS.has(decision.toolName) && lookupCalls >= MAX_LOOKUP_CALLS) {
      priorTurns.push({
        toolName: decision.toolName,
        arguments: decision.arguments || {},
        callId: decision.callId,
        rawToolCall: decision.rawToolCall,
        resultText:
          `No more capability lookups are available this turn (limit ${MAX_LOOKUP_CALLS}). ` +
          'Use what you already know to answer, or say plainly what you would need.',
      });
      onStep({ phase: 'deciding' });
      // eslint-disable-next-line no-await-in-loop
      decision = await adapter.completeWithTools(aiConfig, holder.continuationContext, priorTurns);
      usageTotal = addUsage(usageTotal, decision.usage);
      // eslint-disable-next-line no-continue
      continue;
    }

    const isL3 = Boolean(tool && tool.level === 'L3');
    // A bulk-capable L1/L2 tool reuses this exact same pause-and-ask flow
    // once its estimated affected-row count crosses its own confirmAt
    // threshold. checkToolPreconditions already enforces the hard
    // rejectAt ceiling regardless of whether this branch runs at all.
    const hasBulkGuard = Boolean(tool && tool.maxAffectedRows && !isL3);
    if (isL3 || hasBulkGuard) {
      const { safeParams, estimatedAffectedRows } = await aiToolRegistry.checkToolPreconditions(decision.toolName, {
        client,
        identityContext,
        params: decision.arguments || {},
      });
      const needsConfirmation = isL3 || estimatedAffectedRows > tool.maxAffectedRows.confirmAt;
      if (needsConfirmation) {
        if (invokedTools.length === 0) {
          // Iteration 0: identical to pre-loop behavior — pause and ask,
          // nothing has run yet.
          const confirmationQuestion = isL3
            ? `${tool.description} Shall I go ahead and submit this for approval?`
            : `${tool.description} This will affect approximately ${estimatedAffectedRows} record(s) — shall I go ahead?`;
          const sanitizedContext = aiPromptSafetyLayer.buildSanitizedContext([]);
          const presentation = aiExperienceLayer.buildPresentation({
            sanitizedContext,
            question,
            answer: confirmationQuestion,
            toolUsed: null,
            tool: null,
            actorRole: identityContext.role,
          });
          return {
            earlyReturn: true,
            response: {
              ...sanitizedContext,
              ...imageMeta,
              question,
              toolUsed: null,
              answer: confirmationQuestion,
              presentation,
              pendingConfirmation: { toolName: decision.toolName, params: safeParams },
            },
          };
        }
        // Mid-loop (iteration > 0): a tool already ran earlier this turn.
        // Do NOT run this one and do NOT silently drop it — stop the loop
        // and let the fallback synthesis in writeUp say so plainly.
        blockedActionNote = `A further action was identified but NOT taken because it needs explicit user confirmation first — say so plainly in the answer, never silently omit it: ${tool.description}`;
        break;
      }
      // hasBulkGuard but below confirmAt: falls through to the normal
      // invoke path below with no pause.
    }

    onStep({
      // totalSteps is the turn's own ceiling (MAX_TOOL_CALLS_PER_TURN),
      // not a pre-planned exact count — this loop is adaptive.
      phase: 'running_tool',
      toolName: decision.toolName,
      stepIndex: budgetedCalls,
      totalSteps: config.maxToolCallsPerTurn,
    });
    const sanitizedContext = await invokeTool(client, decision.toolName, decision.arguments || {}, {
      identityContext,
      provider: adapter.name,
      model: aiConfig.model,
    });
    mergedEntries.push(...sanitizedContext.entries);
    invokedTools.push(tool);
    const wasLookup = BUDGET_EXEMPT_LOOKUP_TOOLS.has(decision.toolName);
    if (wasLookup) {
      lookupCalls += 1;
    } else {
      budgetedCalls += 1;
    }
    priorTurns.push({
      toolName: decision.toolName,
      arguments: decision.arguments || {},
      callId: decision.callId,
      rawToolCall: decision.rawToolCall,
      resultText: renderToolResultText(sanitizedContext),
    });

    // Budget is spent by real work only. A lookup answered "how should I
    // do this" and left the turn's actual capability untouched.
    if (budgetedCalls >= config.maxToolCallsPerTurn) {
      // Cap reached — fall through to the synthesis fallback in writeUp
      // without another completeWithTools call.
      break;
    }

    onStep({ phase: 'deciding' });
    const continuationStartedAt = Date.now();
    // No model switching across continuation calls — same raw aiConfig
    // every time.
    // eslint-disable-next-line no-await-in-loop
    decision = await adapter.completeWithTools(aiConfig, holder.continuationContext, priorTurns);
    usageTotal = addUsage(usageTotal, decision.usage);
    // eslint-disable-next-line no-await-in-loop
    await logLlmCall(client, {
      identityContext,
      adapter,
      aiConfig,
      purpose: 'tool_select_continue',
      usage: decision.usage,
      latencyMs: Date.now() - continuationStartedAt,
      imageCount: imageMeta.imageCount,
      systemPromptChars: aiContextAssembly.flattenToPrompts(holder.continuationContext).systemPrompt.length,
      toolCount: tools.length,
    });
  }

  return {
    earlyReturn: false,
    decision,
    priorTurns,
    mergedEntries,
    invokedTools,
    usageTotal,
    blockedActionNote,
  };
}

// Phase 6 — VERIFY. Deterministic document-coverage check, computed from
// what the tools were ACTUALLY invoked with — never from the model's own
// sense of how much it covered. ai-chat-document-coverage-refusal-approved-spec.md / ADL-055.
function verify({ invokedTools, documents, priorTurns, mergedEntries, imageMeta, question, usageTotal }) {
  // The tool the ANSWER is about, which is not always the first one
  // called once BUDGET_EXEMPT_LOOKUP_TOOLS can precede it. Falls back to
  // the first tool when every call was a lookup.
  const primaryTool = invokedTools.find((t) => !BUDGET_EXEMPT_LOOKUP_TOOLS.has(t.name)) || invokedTools[0];

  const coverageGap = invokedTools.length > 0 ? detectDocumentCoverageGap(documents, priorTurns) : null;
  if (coverageGap) {
    // The answer call is SKIPPED, not merely overridden. Nothing computed
    // is lost — evidence still carries the real tool result.
    const mergedSanitizedContext = {
      preamble: aiPromptSafetyLayer.SAFETY_PREAMBLE,
      boundaryStart: aiPromptSafetyLayer.BOUNDARY_START,
      boundaryEnd: aiPromptSafetyLayer.BOUNDARY_END,
      entries: mergedEntries,
    };
    const evidence = buildEvidence(mergedSanitizedContext);
    return {
      earlyReturn: true,
      response: {
        ...mergedSanitizedContext,
        ...imageMeta,
        question,
        // From invokedTools, never priorTurns: priorTurns also carries
        // describe_tools schema lookups, which run no handler and are not
        // a tool USE.
        toolUsed: primaryTool.name,
        toolsUsed: invokedTools.map((t) => t.name),
        answer: buildCoverageRefusal(coverageGap),
        documentCoverageIncomplete: true,
        usage: usageTotal,
        presentation: null,
        evidence,
        evidenceTrail: buildEvidenceTrail(evidence),
        // No model-authored numeric claim exists to check — this text is
        // composed here, from the coverage facts.
        verification: { status: 'INSUFFICIENT_EVIDENCE' },
      },
    };
  }

  return { earlyReturn: false, primaryTool };
}

// Phase 7 — WRITE UP. The three existing response branches: no tool
// picked (falls through to a plain answer below), a merged in-turn
// answer, or a synthesis fallback via summarizeToolResult.
async function writeUp({
  client,
  identityContext,
  question,
  decision,
  invokedTools,
  primaryTool,
  mergedEntries,
  priorTurns,
  usageTotal,
  answerPromptQuestion,
  identityBlock,
  adapter,
  aiConfig,
  historyTurns,
  imageMeta,
  blockedActionNote,
  onDelta,
  onStep,
}) {
  if (invokedTools.length === 0) {
    // No tool was ever picked, iteration 0 — falls through to the
    // plain-answer path below, unchanged.
  } else if (decision.type === 'answer') {
    // The model saw the tool result(s) and answered directly, in the
    // SAME conversation — no separate synthesis call. This is the actual
    // cost win P2(c) exists to realize.
    const mergedSanitizedContext = {
      preamble: aiPromptSafetyLayer.SAFETY_PREAMBLE,
      boundaryStart: aiPromptSafetyLayer.BOUNDARY_START,
      boundaryEnd: aiPromptSafetyLayer.BOUNDARY_END,
      entries: mergedEntries,
    };
    const firstToolName = primaryTool.name;
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: mergedSanitizedContext,
      question,
      answer: decision.text,
      toolUsed: firstToolName,
      tool: primaryTool,
      actorRole: identityContext.role,
    });
    const evidence = buildEvidence(mergedSanitizedContext);
    return {
      ...mergedSanitizedContext,
      ...imageMeta,
      question,
      toolUsed: firstToolName,
      toolsUsed: invokedTools.map((t) => t.name),
      answer: decision.text,
      usage: usageTotal,
      presentation,
      evidence,
      evidenceTrail: buildEvidenceTrail(evidence),
      verification: verifyNumericClaims(decision.text, evidence),
    };
  } else {
    // Cap reached, or a mid-loop tool needed confirmation and was
    // intentionally not run — fallback synthesis, generalized from the
    // original single-tool call.
    const mergedSanitizedContext = {
      preamble: aiPromptSafetyLayer.SAFETY_PREAMBLE,
      boundaryStart: aiPromptSafetyLayer.BOUNDARY_START,
      boundaryEnd: aiPromptSafetyLayer.BOUNDARY_END,
      entries: mergedEntries,
    };
    const firstToolName = primaryTool.name;
    // The tool(s) themselves are done — summarizeToolResult below is a
    // SEPARATE LLM call turning the result(s) into the answer. Without
    // this, the frontend kept showing "Running <tool>…" for that whole
    // second call too.
    onStep({ phase: 'synthesizing', toolName: priorTurns[priorTurns.length - 1].toolName });
    const { text: answer, usage: synthUsage } = await summarizeToolResult(
      client,
      identityContext,
      mergedSanitizedContext,
      answerPromptQuestion,
      invokedTools,
      adapter,
      aiConfig,
      identityBlock,
      historyTurns.length > 0,
      historyTurns,
      onDelta,
      blockedActionNote,
    );
    const finalUsageTotal = addUsage(usageTotal, synthUsage);
    const presentation = aiExperienceLayer.buildPresentation({
      sanitizedContext: mergedSanitizedContext,
      question,
      answer,
      toolUsed: firstToolName,
      tool: primaryTool,
      actorRole: identityContext.role,
    });
    const evidence = buildEvidence(mergedSanitizedContext);
    return {
      ...mergedSanitizedContext,
      ...imageMeta,
      question,
      toolUsed: firstToolName,
      toolsUsed: invokedTools.map((t) => t.name),
      answer,
      usage: finalUsageTotal,
      presentation,
      evidence,
      evidenceTrail: buildEvidenceTrail(evidence),
      verification: verifyNumericClaims(answer, evidence),
    };
  }

  // No tool was picked. The direct answer still passes through the
  // Prompt Safety Layer's own envelope (preamble/boundary markers) before
  // reaching the caller, so every /ai/ask response has the same shape
  // regardless of which path executed.
  const sanitizedContext = aiPromptSafetyLayer.buildSanitizedContext([]);
  const presentation = aiExperienceLayer.buildPresentation({
    sanitizedContext,
    question,
    answer: decision.text,
    toolUsed: null,
    tool: null,
    actorRole: identityContext.role,
  });
  return {
    ...sanitizedContext,
    ...imageMeta,
    question,
    toolUsed: null,
    answer: decision.text,
    presentation,
    usage: decision.usage,
  };
}

// The orchestrator. Reads top-to-bottom as the pipeline it is: route,
// fetch tools, decide, act, verify, write up. Research mode (mode ===
// 'general') is a different pipeline entirely — an early return to
// askGeneralChat, never folded into the Curriculum state machine below.
async function askAgent(
  client,
  question,
  { identityContext, focusContext, projectContext, history, attachmentIds, mode, thinkingLevel, modelChoice } = {},
  onDelta,
  onStep = () => {},
) {
  if (!question || typeof question !== 'string') {
    throw new AiServiceValidationError('question is required and must be a non-empty string');
  }

  // ROUTE (inputs).
  const turnContext = await resolveTurnContext(client, question, {
    identityContext,
    focusContext,
    projectContext,
    history,
    attachmentIds,
  });
  const {
    images,
    documents,
    media,
    historyTurns,
    attachmentHint,
    promptQuestion,
    compactPromptQuestion,
    answerPromptQuestion,
  } = turnContext;

  // Research mode short-circuits before a single ARCNAVE tool is even
  // listed — see askGeneralChat's own comment above it. Anything other
  // than the literal 'general' string falls through to the unchanged
  // Curriculum path below.
  if (mode === 'general') {
    const identityBlock = await aiActorContext.describeIdentityContext(client, identityContext);
    const { adapter, config: aiConfig } = await configurationService.resolveAiConfig(
      client,
      identityContext.collegeId,
      { allowExperimentalFallback: true, modelChoice },
    );
    logAttachmentTokenPreflight({
      adapter,
      aiConfig,
      identityContext,
      attachmentHint,
      images,
      media,
    });
    return askGeneralChat(
      client,
      question,
      promptQuestion,
      {
        identityContext,
        identityBlock,
        adapter,
        aiConfig,
        images,
        media,
        hasHistory: historyTurns.length > 0,
        historyTurns,
        hasAttachedDocuments: documents.length > 0,
        thinkingLevel,
      },
      onDelta,
      onStep,
    );
  }

  // FETCH TOOLS.
  const toolCtx = await fetchTools(client, identityContext, question, {
    images,
    documents,
    media,
    focusContext,
    projectContext,
    modelChoice,
  });

  // Build the decision context — see buildDecisionContext's own comment
  // for the ADL-050 invariant this phase owns.
  const decisionCtx = await buildDecisionContext({
    identityContext,
    identityBlock: toolCtx.identityBlock,
    focusContext,
    question,
    promptQuestion,
    compactPromptQuestion,
    images,
    documents,
    media,
    historyTurns,
    roleTools: toolCtx.roleTools,
    tools: toolCtx.tools,
    toolsWithPlan: toolCtx.toolsWithPlan,
    viaToolSearch: toolCtx.viaToolSearch,
    zeroToolFastPathActive: toolCtx.zeroToolFastPathActive,
    toolCoverageStatus: toolCtx.toolCoverageStatus,
    toolUncoveredRequirements: toolCtx.toolUncoveredRequirements,
    adapter: toolCtx.adapter,
    aiConfig: toolCtx.aiConfig,
    attachmentHint,
    thinkingLevel,
  });

  // DECIDE.
  const { decision: initialDecision, imageMeta } = await decide({
    client,
    identityContext,
    adapter: toolCtx.adapter,
    aiConfig: toolCtx.aiConfig,
    decisionContext: decisionCtx.decisionContext,
    tools: toolCtx.tools,
    fallbackState: toolCtx.fallbackState,
    imagesSupported: decisionCtx.imagesSupported,
    images,
    imageAnalysisUnavailable: decisionCtx.imageAnalysisUnavailable,
    promptVersionTag: decisionCtx.promptVersionTag,
    onStep,
  });

  // ACT.
  const actResult = await act({
    client,
    identityContext,
    question,
    roleTools: toolCtx.roleTools,
    tools: toolCtx.tools,
    adapter: toolCtx.adapter,
    aiConfig: toolCtx.aiConfig,
    historyTurns,
    identityBlock: toolCtx.identityBlock,
    answerPromptQuestion,
    imageMeta,
    contextInputs: {
      continuationSegments: decisionCtx.continuationSegments,
      decisionImages: decisionCtx.decisionImages,
      decisionMedia: decisionCtx.decisionMedia,
      thinkingLevel,
      cachedSystemInstructionName: decisionCtx.cachedSystemInstructionName,
    },
    holder: decisionCtx.holder,
    initialDecision,
    onStep,
    onDelta,
  });
  if (actResult.earlyReturn) return actResult.response;

  // VERIFY.
  const verifyResult = verify({
    invokedTools: actResult.invokedTools,
    documents,
    priorTurns: actResult.priorTurns,
    mergedEntries: actResult.mergedEntries,
    imageMeta,
    question,
    usageTotal: actResult.usageTotal,
  });
  if (verifyResult.earlyReturn) return verifyResult.response;

  // WRITE UP.
  return writeUp({
    client,
    identityContext,
    question,
    decision: actResult.decision,
    invokedTools: actResult.invokedTools,
    primaryTool: verifyResult.primaryTool,
    mergedEntries: actResult.mergedEntries,
    priorTurns: actResult.priorTurns,
    usageTotal: actResult.usageTotal,
    answerPromptQuestion,
    identityBlock: toolCtx.identityBlock,
    adapter: toolCtx.adapter,
    aiConfig: toolCtx.aiConfig,
    historyTurns,
    imageMeta,
    blockedActionNote: actResult.blockedActionNote,
    onDelta,
    onStep,
  });
}

module.exports = {
  decide,
  act,
  verify,
  writeUp,
  askAgent,
};
