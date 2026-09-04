'use strict';

// Research mode's general-chat entry point (askGeneralChat) — the tool-
// selection-by-LLM chat path used when Research mode's own routing picks
// "general chat" rather than a specific tool. Split out of aiService.js —
// see that file's own header comment for the full split; moved verbatim,
// no behavior change.

const config = require('../../config');
const aiToolRegistry = require('../aiToolRegistry');
const aiPromptSafetyLayer = require('../aiPromptSafetyLayer');
const aiPolicyAssembly = require('../aiPolicyAssembly');
const aiContextAssembly = require('../aiContextAssembly');
const aiGuardrailService = require('../aiGuardrailService');
const aiExperienceLayer = require('../aiExperience');
const { buildImageUnavailableNote, buildMediaUnavailableNote } = require('./attachments');
const { verifyResearchNumericClaims, buildResearchVerificationNote } = require('./evidence');
const { invokeTool } = require('./toolInvocation');
const { buildFullInstructionsDocument } = require('./workflowPlan');
const {
  completeMaybeStreaming,
  resolveMediaSupport,
  logLlmCall,
  renderToolResultText,
  addUsage,
} = require('./llmCall');

async function askGeneralChat(
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
    hasHistory,
    historyTurns = [],
    hasAttachedDocuments,
    thinkingLevel,
  },
  onDelta,
  onStep = () => {},
) {
  const { imagesSupported, imageAnalysisUnavailable, mediaSupported, mediaAnalysisUnavailable, supportedMedia } =
    resolveMediaSupport(adapter, aiConfig, images, media);
  // ADR-030 P2(a): builds an ARCNAVE Context instead of a flat
  // systemPrompt/userPrompt pair — representation change only, byte-
  // identical output via aiContextAssembly.flattenToPrompts. identityBlock
  // stays last — ADR-030 P0 (see executeWorkflowPlan's own comment).
  // Research mode offers exactly ONE tool — generate_document — never the
  // Curriculum catalogue, never focus/project context, never a multi-step
  // loop (owner decision 2026-09-03, reversing the prior "no tool is ever
  // added" posture specifically for file-export requests, live-caught:
  // "convert this into Excel/PDF" in Research mode had no honest way to
  // succeed before this). role-gated the same way Curriculum's own
  // roleTools is (aiToolRegistry.listTools({role})) — a role outside
  // generate_document's allowedRoles gets an empty fileTools array and
  // this function's behavior is byte-identical to before.
  const fileTools = aiToolRegistry
    .listTools({ excludeHumanOnly: true, role: identityContext.role })
    .filter((tool) => tool.name === 'generate_document');
  const policy = aiPolicyAssembly.buildPolicy({
    mode: 'general',
    hasHistory,
    toolCount: fileTools.length,
    hasFileTool: fileTools.length > 0,
    focusEntityType: null,
  });
  const userSegments = [
    aiContextAssembly.segment({
      source: 'question',
      stability: aiContextAssembly.STABILITY.TURN,
      target: 'user',
      content: promptQuestion,
    }),
  ];
  if (imageAnalysisUnavailable) {
    userSegments.push(
      aiContextAssembly.segment({
        source: 'image-unavailable-note',
        stability: aiContextAssembly.STABILITY.TURN,
        target: 'user',
        content: buildImageUnavailableNote(images.length),
      }),
    );
  }
  if (mediaAnalysisUnavailable) {
    userSegments.push(
      aiContextAssembly.segment({
        source: 'media-unavailable-note',
        stability: aiContextAssembly.STABILITY.TURN,
        target: 'user',
        content: buildMediaUnavailableNote(media.length),
      }),
    );
  }
  const arcnaveContext = aiContextAssembly.buildContext(
    [
      aiContextAssembly.segment({
        source: 'mode-prefix',
        stability: aiContextAssembly.STABILITY.STATIC,
        target: 'system',
        content: aiPolicyAssembly.MODE_PREFIX.general,
      }),
      aiContextAssembly.segment({
        source: 'policy-modules',
        stability: aiContextAssembly.STABILITY.CONVERSATION,
        target: 'system',
        content: policy,
      }),
      // Priority 3 follow-up (config.experimentalAttachmentDiscipline, off
      // by default) — live session trial only, per explicit user
      // instruction, extended here to cover Research mode specifically
      // because it has NO deterministic tool at all (see this function's
      // own top comment) and the promptQuestion it receives still carries
      // the full raw attachmentHint (aiService.js's own comment a few
      // hundred lines up documents the exact measured failure this
      // reopens: "the pre-routing answer... claimed 14 students when the
      // tool computes 77 arrears across 21"). Strict per instruction: this
      // is the ONLY change to this mode — no tool is added, no other
      // behavior changes.
      // Superseded by the full raw document (config.experimentalFullInstructionsDocument,
      // testing-phase only, per explicit user instruction) when that flag
      // is on — applies on every turn here too, not just attachment turns.
      ...(config.experimentalFullInstructionsDocument
        ? [
            aiContextAssembly.segment({
              source: 'full-instructions-document',
              stability: aiContextAssembly.STABILITY.STATIC,
              target: 'system',
              content: buildFullInstructionsDocument(),
            }),
          ]
        : config.experimentalAttachmentDiscipline && hasAttachedDocuments
          ? [
              aiContextAssembly.segment({
                source: 'attachment-discipline',
                stability: aiContextAssembly.STABILITY.TURN,
                target: 'system',
                content:
                  'This mode has no deterministic computation tool. If asked to count, sum, or compare specific ' +
                  'records from an attached document, do NOT estimate or compute a number from reading it — say plainly ' +
                  'that this mode cannot run a verified computation over the attachment, name the exact figure you would ' +
                  'need to compute, and tell the user to ask again in Curriculum mode instead. Confirm which section, ' +
                  'course, or scope any text you DO quote from the document actually belongs to before quoting it.',
              }),
            ]
          : []),
      // P3 1.16 — same FLAG-tier guardrail reinforcement wiring as
      // askAgent's buildDecisionContext (see that segment's own comment
      // for the full rationale). This mode never loops/continues — one
      // completeMaybeStreaming call below — so `screenInput(question)` is
      // trivially "exactly once per request" here.
      ...(aiGuardrailService.screenInput(question).verdict === 'flag'
        ? [
            aiContextAssembly.segment({
              source: 'guardrail-reinforcement-note',
              stability: aiContextAssembly.STABILITY.TURN,
              target: 'system',
              content: aiGuardrailService.REINFORCEMENT_NOTE,
            }),
          ]
        : []),
      aiContextAssembly.segment({
        source: 'identity',
        stability: aiContextAssembly.STABILITY.CONVERSATION,
        target: 'system',
        content: identityBlock,
      }),
      ...userSegments,
    ],
    {
      images: imagesSupported ? images : undefined,
      media: supportedMedia.length ? supportedMedia : undefined,
      thinkingLevel,
      historyTurns,
      tools: fileTools,
    },
  );

  // Research mode has no tool call to report progress on, but it was
  // previously the one askAgent path that never fired a single onStep
  // event — so a slow provider response left the UI on the initial
  // default status with no real signal at all. One event, right before
  // the only LLM call this path makes.
  let rawAnswer;
  let usage;
  let researchToolUsed = null;
  let researchToolEntries = [];
  if (fileTools.length === 0) {
    // Unchanged from before this owner decision — no tool offered means
    // no reason to give up live token streaming, so this stays on the
    // completeStream path exactly as it always has.
    onStep({ phase: 'synthesizing' });
    ({ text: rawAnswer, usage } = await completeMaybeStreaming(
      client,
      identityContext,
      adapter,
      aiConfig,
      arcnaveContext,
      'general_chat',
      onDelta,
    ));
  } else {
    // A tool is offered (generate_document only), so this must go through
    // completeWithTools instead of completeStream — the same trade every
    // Curriculum-mode turn already makes (askAgent's own decide()/writeUp()
    // never stream either; see this file's own top comment). No multi-step
    // loop: at most one tool call, then one continuation call for the
    // final answer, mirroring the exact writeUp() "model saw the tool
    // result and answered directly, no separate synthesis call" shape.
    onStep({ phase: 'deciding' });
    const decisionStartedAt = Date.now();
    const decision = await adapter.completeWithTools(aiConfig, arcnaveContext);
    await logLlmCall(client, {
      identityContext,
      adapter,
      aiConfig,
      purpose: 'general_chat',
      usage: decision.usage,
      latencyMs: Date.now() - decisionStartedAt,
      toolCount: fileTools.length,
    });
    usage = decision.usage;
    if (decision.type === 'tool_call' && decision.toolName === 'generate_document') {
      onStep({ phase: 'running_tool', toolName: decision.toolName, stepIndex: 0, totalSteps: 1 });
      const toolResult = await invokeTool(client, decision.toolName, decision.arguments || {}, {
        identityContext,
        provider: adapter.name,
        model: aiConfig.model,
      });
      researchToolEntries = toolResult.entries;
      const priorTurns = [
        {
          toolName: decision.toolName,
          arguments: decision.arguments || {},
          callId: decision.callId,
          rawToolCall: decision.rawToolCall,
          resultText: renderToolResultText(toolResult),
        },
      ];
      onStep({ phase: 'synthesizing', toolName: decision.toolName });
      const continuationStartedAt = Date.now();
      const continuation = await adapter.completeWithTools(aiConfig, arcnaveContext, priorTurns);
      await logLlmCall(client, {
        identityContext,
        adapter,
        aiConfig,
        purpose: 'general_chat',
        usage: continuation.usage,
        latencyMs: Date.now() - continuationStartedAt,
        toolCount: fileTools.length,
      });
      usage = addUsage(usage, continuation.usage);
      researchToolUsed = decision.toolName;
      // continuation.type is 'answer' in the overwhelming common case
      // (the model just saw its own tool result). The one edge case this
      // falls back for — a SECOND tool_call from a single-tool offer,
      // something no live turn has produced — reports the tool's own
      // result text directly rather than guessing at a second round this
      // path was deliberately never built to run.
      rawAnswer = continuation.type === 'answer' ? continuation.text : renderToolResultText(toolResult);
    } else {
      onStep({ phase: 'synthesizing' });
      rawAnswer = decision.text;
    }
  }

  // Review Finding #10 — Research mode has no tool/evidence pipeline of
  // its own (this function never builds Curriculum's `evidence` array —
  // see this function's own top comment), so `evidence` is always []
  // here today: the correct, conservative default per this finding's own
  // product principle, not a placeholder for future work. Runs
  // regardless of which adapter/model produced rawAnswer (experimental
  // reasoning-model override included — the check is on the OUTPUT TEXT,
  // never on provider identity), so that override can never bypass this
  // boundary. A general/non-numeric research answer (the common case)
  // returns NOT_APPLICABLE and rawAnswer is returned completely
  // untouched — this must never turn into a blanket "can't verify"
  // disclaimer on ordinary Research-mode traffic.
  const researchVerification = verifyResearchNumericClaims(rawAnswer, []);
  const researchVerificationNote = buildResearchVerificationNote(researchVerification.status);
  const answer = researchVerificationNote ? `${rawAnswer}\n\n${researchVerificationNote}` : rawAnswer;

  const sanitizedContext = aiPromptSafetyLayer.buildSanitizedContext(researchToolEntries);
  const researchTool = researchToolUsed ? fileTools.find((tool) => tool.name === researchToolUsed) || null : null;
  const presentation = aiExperienceLayer.buildPresentation({
    sanitizedContext,
    question,
    answer,
    toolUsed: researchToolUsed,
    tool: researchTool,
    actorRole: identityContext.role,
  });
  return {
    ...sanitizedContext,
    imageCount: imagesSupported ? images.length : 0,
    imageAnalysisUnavailable,
    question,
    toolUsed: researchToolUsed,
    answer,
    verification: researchVerification,
    usage,
    presentation,
  };
}

// Priority 2 — Reasoning model benchmark, EXPERIMENTAL, off-by-default
// (config.experimentalReasoningModel, unset -> today's exact
// configurationService.getAiConfig() resolution, zero behavior change).
// Isolates the reasoning-model variable per this session's benchmark
// requirement: everything downstream of this call (tool selection,
// Policy Gate, business services, run_workflow_plan, synthesis) reuses
// the SAME adapter interface (completeWithTools/complete), so swapping
// which {adapter, aiConfig} pair askAgent resolves to is the entire
// change — no other code path in this file is touched. Reuses the
// already-built vertex_maas adapter (Priority 1's own Tool Search
// work) and Gemini's own projectId/location/ADC, same "no new
// credential system" precedent that adapter's own header comment
// already established.
//
// Multimodal: NOT redesigned here, per this session's explicit
// instruction. vertex_maas.supportsVision is false, so when this
// override is active, askAgent's own existing "honest degradation"
// path (imagesSupported/imageAnalysisUnavailable, a few lines below
// this function's call sites) takes over exactly as it already does
// for any non-vision provider — images are marked unavailable, no new
// Gemini-preprocessing handoff is built. A real limitation, disclosed,
// not invented around.
//
// Review Finding #7 (2026-08-29) — this used to be a local function here
// that applied the override unconditionally, with no idea whether
// configurationService.getAiConfig's result came from an explicit
// college_ai_config row or the platform default. That meant a college
// with its OWN configured provider/model could be silently rerouted to
// the experimental model whenever the global flag was on — the whole
// precedence logic has moved to configurationService.resolveAiConfig,
// the same file that already owns tenant-vs-default resolution, so this
// file never re-implements that distinction. Both call sites below now
// call it directly with { allowExperimentalFallback: true } — the only
// two places in this codebase that ever want this benchmark; every other
// configurationService.getAiConfig call site (askAboutTool, etc.) is
// untouched and structurally cannot be affected by this flag.

// ARCNAVE modernization P3 1.16 / clash C10 — askAgent rewritten as a
// step-by-step machine: route, fetch tools, decide, act, verify, write up.
// Structural change only — every phase below is the same logic that used
// to live inline in one ~1,100-line function, moved into named functions
// with explicit inputs/outputs. See each phase's own comment for what it
// owns. The one invariant every phase must respect (ADL-050): the system
// segments built once in buildDecisionContext are reused BY REFERENCE for
// every completeWithTools call in the turn — decide, and every iteration
// of act's loop — never independently reconstructed.

// Phase 1 — ROUTE (inputs). Resolves everything about this turn that is
// independent of which mode/pipeline the question ends up in: quota,
// attachments, and every hint/promptQuestion variant. Returns only what
// later phases need — not a single "turn state" object.

module.exports = {
  askGeneralChat,
};
