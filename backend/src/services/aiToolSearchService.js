'use strict';

// Tool Search (Priority 1, Phase 1) — a dedicated, cheap Vertex AI MaaS
// model (Qwen3-Next-80B-Thinking / MiniMax M2, model-swappable via
// config.toolSearch.model) whose only job is discovering which of a
// role's already-permitted tools are relevant to a question, so the
// expensive Gemini reasoning call never has to receive the full
// tool-name catalogue (aiService.js's buildToolCatalogue — measured
// this session at ~75-80% of the current 4,079-token Principal decision
// context) at all.
//
// Sibling to aiToolRetrievalService.js, NOT a replacement — that
// service's retrieveRelevantTools is reused verbatim, unchanged, both
// as this feature's disabled-path behavior AND as its on-any-failure
// fallback. Same resilience shape that file's own header comment
// already establishes for embedding failures: a transient problem here
// must never break a chat turn, it must just degrade to the existing
// pgvector/lexical path.
//
// Security (CLAUDE.md rule 1, rule 9, this session's explicit
// requirement): this function never receives identityContext,
// credentials, or tenant secrets — only tool names/descriptions
// (already role-filtered by the caller, same as aiToolRetrievalService)
// and the question text. Its OUTPUT is treated as untrusted AI data,
// never an instruction: every returned name is validated against the
// caller-supplied roleTools before being used for anything. This
// function never calls aiToolRegistry.invokeTool and never makes an
// authorization decision — Policy Gate / checkToolPreconditions /
// RLS / audit logging all still run, unchanged, on whatever tool is
// eventually invoked, exactly as they do today.

const configurationService = require('./configurationService');
const aiToolRetrievalService = require('./aiToolRetrievalService');
const aiContextAssembly = require('./aiContextAssembly');
const { logInfo, logWarn } = require('../logging/logger');

// Recall-biased by design (this session's explicit instruction: "if
// uncertain, returning an additional relevant tool is preferable to
// silently missing a required tool") — this is a safety ceiling against
// a pathological/malformed response, never a normal target count, and
// deliberately far above the old fixed TOP_K=8 it replaces.
const MAX_TOOL_SEARCH_RESULTS = 20;

const SELECT_TOOLS_META_TOOL_NAME = 'select_relevant_tools';

// Copied (not imported) from aiService.js's own firstSentence — same
// precedent this session's token-measurement-deferred-loading-probe.js
// already established for a standalone script that needs the identical
// per-tool line format without creating a require() cycle back into
// aiService.js (which will itself require this file).
function firstSentence(text) {
  return String(text || '').split(/(?<=\.)\s/)[0].slice(0, 140).trim();
}

function buildCompactIndex(roleTools) {
  return roleTools.map((t) => `${t.name} — ${firstSentence(t.description)}`).join('\n');
}

// One meta-tool, offered only to the Tool Search model — chosen over a
// freeform "reply with JSON" instruction because every MaaS model this
// adapter targets confirms native OpenAI-compatible function-calling
// support (checked this session), and a schema-validated tool call
// structurally can't come back wrapped in markdown fences or extra
// prose the way a freeform-JSON instruction can. The schema itself is a
// small, fixed overhead (comparable to the existing describe_tools/
// run_workflow_plan meta-tools, ~100 tokens) — negligible next to the
// compact index text this same call already has to send, so it isn't
// re-litigated as a token-cost decision on its own; the benchmark
// script reports the Tool Search call's real total input/output tokens
// either way.
function buildSelectToolsMetaTool() {
  return {
    name: SELECT_TOOLS_META_TOOL_NAME,
    description: 'Return the names of every tool below (zero or more) needed to fully answer the question, plus '
      + 'your confidence that the set you picked covers every material part of the question. '
      + 'Prefer including a tool you are only somewhat sure is relevant over leaving it out — a missed tool is '
      + 'worse than an extra one. Return zero names only if truly nothing below fits the question.',
    // Every provider adapter reads a tool's schema from `tool.params`
    // (aiToolRegistry.js, claude.js, vertexMaas.js, selfHosted.js,
    // openai.js, gemini.js all agree on this) — `params` is this
    // codebase's canonical internal contract; `parameters` is only ever
    // the wire-level field name a given adapter maps `tool.params` into.
    params: {
      type: 'object',
      required: ['names', 'coverageStatus'],
      properties: {
        names: {
          type: 'array',
          items: { type: 'string', description: 'an exact tool name from the list below' },
        },
        // Review Finding #8: a valid tool name is not the same claim as
        // "this set is sufficient" — a model can correctly avoid
        // hallucinating names while still silently under-selecting for a
        // multi-domain question (e.g. picking attendance + student
        // identity tools for a question that also needs fee-due data).
        // This field makes that distinction the model's own explicit,
        // structured claim instead of something the caller has to infer.
        coverageStatus: {
          type: 'string',
          enum: ['complete', 'uncertain', 'insufficient'],
          description: '"complete" — the selected names above fully cover every material part of the question. '
            + '"uncertain" — they might, but you are not fully sure. "insufficient" — a material part of the '
            + 'question has no fitting tool anywhere in the list below.',
        },
        uncoveredRequirements: {
          type: 'array',
          items: { type: 'string', description: 'one short, factual sentence naming a part of the question no selected tool covers' },
          description: 'Only when coverageStatus is not "complete": what the selected tools do not cover. '
            + 'Short and factual — not an explanation of your reasoning.',
        },
      },
    },
  };
}

const SYSTEM_PROMPT = 'You are a tool-search assistant for a campus-management system. Given a question and a '
  + 'list of available tools (name and one-line description), decide which tools, if any, would be needed to '
  + `answer it, and call ${SELECT_TOOLS_META_TOOL_NAME} with their exact names. Select every available tool `
  + 'needed to satisfy every material part of the request — a request may span multiple domains (for example '
  + 'attendance AND fees), and if the answer depends on combining information across domains you must include a '
  + 'tool from each one. Report your coverageStatus honestly: if no available tool fits a material part of the '
  + 'question, or you are not sure the set you picked is complete, say so via "insufficient" or "uncertain" '
  + 'rather than selecting a partial subset and implying it fully answers the question. You do not answer the '
  + 'question yourself and you never invent a tool name not in the list.';

// A real, measured quirk (checked live this session against
// minimaxai/minimax-m2-maas, not assumed): this model sometimes
// double-encodes the array — the meta-tool's own arguments JSON comes
// back as {"names": "[\"attendance_summary\"]"}, a JSON string holding
// the array, rather than a native array — despite the schema declaring
// `names` as `type: array`. Unwrapped here, once, shared by validation
// and the "was the raw response genuinely non-empty" check below, so
// neither has to know about this quirk separately. A string that isn't
// valid JSON, or that doesn't decode to an array, returns null exactly
// like a missing/malformed field would.
function toNameArray(raw) {
  let names = raw;
  if (typeof names === 'string') {
    try {
      names = JSON.parse(names);
    } catch {
      return null;
    }
  }
  return Array.isArray(names) ? names : null;
}

// Every returned name validated against roleTools — untrusted AI
// output, never trusted blindly (mirrors CLAUDE.md rule 9 applied to
// AI OUTPUT here, not just input). Deduped, capped at
// MAX_TOOL_SEARCH_RESULTS.
//
// Trimmed before matching — a real, live-caught quirk (this session,
// against qwen/qwen3-next-80b-a3b-thinking-maas, once the MAX_TOKENS fix
// above let a real tool call through for the first time): the model
// returned " attendance_summary" with a leading space. An exact,
// untrimmed match would silently treat a genuinely correct selection as
// invalid — the same class of harm as rejecting a real tool outright,
// just from formatting rather than a hallucinated name.
function validateNames(rawNames, roleTools) {
  const names = toNameArray(rawNames);
  if (names === null) return null;
  const byName = new Map(roleTools.map((t) => [t.name, t]));
  const seen = new Set();
  const valid = [];
  for (const rawName of names) {
    if (typeof rawName !== 'string') continue;
    const name = rawName.trim();
    if (!byName.has(name) || seen.has(name)) continue;
    seen.add(name);
    valid.push(byName.get(name));
    if (valid.length >= MAX_TOOL_SEARCH_RESULTS) break;
  }
  return valid;
}

const VALID_COVERAGE_STATUSES = new Set(['complete', 'uncertain', 'insufficient']);
const MAX_UNCOVERED_REQUIREMENTS = 5;
const MAX_UNCOVERED_REQUIREMENT_LENGTH = 200;

// The model's own coverage self-assessment is untrusted AI output, same
// as the tool names above (CLAUDE.md rule 9) — missing, misspelled, or
// outright malformed defaults to 'uncertain', never 'complete'. Treating
// an unreadable coverage claim as "complete" would let a malformed
// response silently unlock catalogue omission the same way a forged one
// could; 'uncertain' instead routes it through the same broader-catalogue
// recovery attempt a genuine "uncertain" answer gets.
function normalizeCoverageStatus(raw) {
  return VALID_COVERAGE_STATUSES.has(raw) ? raw : 'uncertain';
}

// Bounded and string-only so a malformed or oversized field can't bloat
// the prompt this feeds into (aiService.js's coverage-limitation note) —
// mirrors the bounded, safe-to-expose-internally convention the task
// requires, not user-facing text as-is.
function normalizeUncoveredRequirements(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => typeof item === 'string' && item.trim() !== '')
    .slice(0, MAX_UNCOVERED_REQUIREMENTS)
    .map((item) => item.trim().slice(0, MAX_UNCOVERED_REQUIREMENT_LENGTH));
}

// Union by name, capped exactly like validateNames — used to merge a
// Tool-Search selection with the broader retrieval fallback's own result
// when coverage is uncertain/insufficient, never unbounded.
function mergeToolLists(base, extra) {
  const seen = new Set(base.map((t) => t.name));
  const merged = [...base];
  for (const tool of extra) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    merged.push(tool);
    if (merged.length >= MAX_TOOL_SEARCH_RESULTS) break;
  }
  return merged;
}

// { tools, viaToolSearch } — viaToolSearch is true ONLY when the LLM
// Tool Search call itself succeeded and returned a response this
// service trusts (even if that response is a legitimate empty list —
// "no tool fits" is a valid outcome, not a failure). aiService.js uses
// viaToolSearch to decide whether to omit the full catalogue text from
// Gemini's context (Phase 1's actual point) or fall back to including
// it exactly as today.
async function discoverRelevantTools(client, { roleTools, question }) {
  // usage/provider/model (ADR-030 P0/P1 telemetry convention, same
  // shape logLlmCall already normalizes everywhere else): attached
  // whenever a real Tool Search call actually completed, EVEN if this
  // service then decides not to trust its answer and falls back — a
  // distrusted response still cost real tokens, and the benchmark
  // (Section 19 of this session's plan: "do NOT assume the Tool Search
  // model is free") needs that number regardless of the trust decision.
  // undefined when no call was ever attempted (disabled, zero tools, or
  // the call itself threw before returning anything).
  const fallback = async (usage) => ({
    tools: await aiToolRetrievalService.retrieveRelevantTools(client, { roleTools, question }),
    viaToolSearch: false,
    usage,
    provider: usage ? 'vertex_maas' : undefined,
    model: usage ? configurationService.getToolSearchConfig().config.model : undefined,
  });

  if (roleTools.length === 0) return { tools: [], viaToolSearch: false, usage: undefined };

  const toolSearchConfig = configurationService.getToolSearchConfig();
  if (!toolSearchConfig) return fallback();

  // Only logged once Tool Search is actually configured/attempted — the
  // disabled-by-default path above is not a failure and stays silent, so
  // this can't spam logs on the common (currently default) case. Fields
  // are counts/a short fixed reason only — never the question, tool
  // descriptions, or the model's raw response.
  const logToolSearchFallback = (reason) => logWarn('tool_search_fallback', { reason, availableToolCount: roleTools.length });

  let decision;
  try {
    const context = aiContextAssembly.contextFromFlatPrompts({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Question: ${question}\n\nAvailable tools:\n${buildCompactIndex(roleTools)}`,
      tools: [buildSelectToolsMetaTool()],
    });
    decision = await toolSearchConfig.adapter.completeWithTools(toolSearchConfig.config, context);
  } catch {
    // Any provider failure (unconfigured, timeout, non-2xx, malformed
    // JSON, network error — all already normalized to LlmRequestError/
    // LlmNotConfiguredError by the adapter) degrades to the existing
    // retrieval path. A chat turn must never fail because Tool Search
    // did. No usage available — the call never returned a response to
    // read one from.
    logToolSearchFallback('provider_error');
    return fallback();
  }

  if (decision.type !== 'tool_call' || decision.toolName !== SELECT_TOOLS_META_TOOL_NAME) {
    // The model answered in prose instead of calling the meta-tool, or
    // called something else entirely — not a shape this service trusts.
    logToolSearchFallback('model_did_not_call_meta_tool');
    return fallback(decision.usage);
  }

  const rawNames = decision.arguments && decision.arguments.names;
  const validated = validateNames(rawNames, roleTools);
  if (validated === null) {
    logToolSearchFallback('unparseable_names');
    return fallback(decision.usage);
  }
  // Every name came back invalid despite a non-empty raw response — the
  // model likely hallucinated names outside the list, not a genuine
  // "zero tools needed" answer. Falls back rather than silently
  // proceeding with zero tools and no catalogue, which would be the
  // exact ADL-055 regression this architecture has to avoid.
  const rawNameArray = toNameArray(rawNames);
  if (validated.length === 0 && rawNameArray && rawNameArray.length > 0) {
    logToolSearchFallback('all_names_invalid');
    return fallback(decision.usage);
  }

  const coverageStatus = normalizeCoverageStatus(decision.arguments && decision.arguments.coverageStatus);
  const uncoveredRequirements = normalizeUncoveredRequirements(decision.arguments && decision.arguments.uncoveredRequirements);
  const commonReturn = {
    usage: decision.usage, provider: 'vertex_maas', model: toolSearchConfig.config.model,
  };

  // Review Finding #8: valid tool names are not the same claim as
  // sufficient coverage. 'complete' is the only status trusted as-is —
  // 'uncertain'/'insufficient' get one recovery attempt via the same
  // broader retrieval path this function already falls back to on
  // outright failure, before this reduced subset is trusted for
  // catalogue omission (aiService.js's own use of viaToolSearch).
  if (coverageStatus === 'complete') {
    logInfo('tool_search_success', {
      availableToolCount: roleTools.length, selectedToolCount: validated.length, coverageStatus,
    });
    return {
      tools: validated, viaToolSearch: true, coverageStatus, uncoveredRequirements: [], ...commonReturn,
    };
  }

  logToolSearchFallback(`coverage_${coverageStatus}`);
  // Tool Search is an optimization layer, not a gate (this session's own
  // explicit instruction) — an uncertain/insufficient self-report gets a
  // chance to recover through the existing broader retrieval path rather
  // than becoming a hard failure. retrieveRelevantTools searches the full
  // roleTools set the same way it does on a provider error, so this is
  // the project's existing "broader/full catalogue fallback", not a new
  // retrieval mechanism.
  const broaderTools = await aiToolRetrievalService.retrieveRelevantTools(client, { roleTools, question });
  const merged = mergeToolLists(validated, broaderTools);
  // Recovery is judged structurally, not re-asked of a model: if the
  // broader path surfaced a tool Tool Search itself did not already
  // select, that's new coverage the reduced subset was missing — treat
  // as recovered. If it found nothing new, the gap is real and the
  // original self-reported status stands.
  const recovered = merged.length > validated.length;
  const finalCoverageStatus = recovered ? 'complete' : coverageStatus;
  const finalUncoveredRequirements = finalCoverageStatus === 'complete' ? [] : uncoveredRequirements;

  logInfo('tool_search_success', {
    availableToolCount: roleTools.length,
    selectedToolCount: merged.length,
    coverageStatus: finalCoverageStatus,
    broaderCatalogueFallbackAttempted: true,
    broaderCatalogueFallbackRecovered: recovered,
  });
  return {
    tools: merged, viaToolSearch: true, coverageStatus: finalCoverageStatus, uncoveredRequirements: finalUncoveredRequirements, ...commonReturn,
  };
}

module.exports = {
  MAX_TOOL_SEARCH_RESULTS,
  SELECT_TOOLS_META_TOOL_NAME,
  discoverRelevantTools,
};
