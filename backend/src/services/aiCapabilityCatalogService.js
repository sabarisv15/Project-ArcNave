'use strict';

// AI Capability Catalogue — the ARCNAVE form of the consumer platform's
// five catalog tools (search_plugins, search_skills,
// suggest_plugin_install, suggest_skills, recommend_claude_apps).
//
// Those five all assume an installable marketplace: things the user
// does not have yet and could add. ARCNAVE has no marketplace and no
// skills subsystem, so a literal port would have nothing to search.
// What ARCNAVE does have is a real, role-scoped capability inventory —
// the tool registry itself — plus a genuine and repeatedly-observed
// version of the same user need: "what can you actually do for me?",
// and its sharper cousin "why can't you do that?".
//
// So all five collapse into two honest tools:
//
//   capability_search   — what can ARCNAVE do (for THIS role), by topic
//   capability_explain  — why is a named capability unavailable here
//
// The second is the one worth having. A tool can be absent from a
// user's session for three completely different reasons — their role
// does not permit it, their college has not opted in, or the platform
// has no credentials for it — and before this the model could only say
// "I can't do that", which reads as a product failure when it is
// actually a settings question with a clear answer.
//
// Nothing here is an install mechanism. `suggest_plugin_install`'s
// whole point is a one-click "add this"; the ARCNAVE equivalent would
// be enabling a capability for a whole college, which is a
// configuration change and therefore WorkflowService's business, not a
// card the AI renders. This catalogue tells the user what to ask for
// and who can grant it. It never grants anything.

const configurationService = require('./configurationService');

class AiCapabilityCatalogValidationError extends Error {}

const MAX_MATCHES = 10;
const MIN_QUERY_CHARS = 2;

// Capabilities whose availability depends on a per-college opt-in row
// rather than on role alone. Kept as an explicit map rather than
// inferred from the tool: the config category is a fact about how the
// capability was wired, not something readable from its schema, and a
// wrong guess here would tell a principal to change a setting that
// does not exist.
const OPT_IN_CAPABILITIES = {
  web_search: 'web_search',
  web_search_fast: 'web_search',
  image_search: 'web_search',
  weather_fetch: 'weather',
  fetch_trusted_web_page: 'web_retrieval',
};

// Deliberately reuses aiToolRegistry's own significant-word approach
// rather than embeddings: ADL-055 Finding 1 closed retrieval tuning
// permanently, and this is a "list what matches" surface where a miss
// costs a user one rephrase, not a wrong answer.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'can', 'do', 'does', 'you', 'your', 'i', 'me', 'my',
  'what', 'how', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'able', 'any',
]);

function significantWords(text) {
  return (text || '')
    .toLowerCase()
    .match(/[a-z]+/g)
    ?.filter((word) => word.length > 2 && !STOPWORDS.has(word)) || [];
}

function scoreTool(tool, queryWords) {
  const haystack = `${tool.name} ${tool.description}`.toLowerCase();
  return queryWords.reduce((score, word) => (haystack.includes(word) ? score + 1 : score), 0);
}

// Lazy require, not a top-level one: aiToolRegistry requires this
// service in order to register the two tools below, so a top-level
// require here would be a genuine cycle. Resolving it at call time is
// the same technique the registry's own late requires already use.
function registryModule() {
  // eslint-disable-next-line global-require
  return require('./aiToolRegistry');
}

function capabilitySearch(role, query) {
  if (typeof query !== 'string' || query.trim().length < MIN_QUERY_CHARS) {
    throw new AiCapabilityCatalogValidationError(`query is required and must be at least ${MIN_QUERY_CHARS} characters`);
  }
  const queryWords = significantWords(query);
  if (queryWords.length === 0) {
    throw new AiCapabilityCatalogValidationError('query has no searchable words — describe the task in a few plain words');
  }
  // excludeHumanOnly: a human-only tool is not something the AI can do
  // for the user, so listing it here would answer "what can you do"
  // with things it cannot.
  const tools = registryModule().listTools({ role, excludeHumanOnly: true });
  return tools
    .map((tool) => ({ tool, score: scoreTool(tool, queryWords) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHES)
    .map(({ tool }) => ({
      capability: tool.name,
      description: tool.description,
      requiresOptIn: Boolean(OPT_IN_CAPABILITIES[tool.name]),
    }));
}

// Three distinct answers, never collapsed into "unavailable": the
// remedy differs completely per reason, and telling a user to contact
// their principal about a capability the platform has no credentials
// for wastes both their time.
async function capabilityExplain(client, collegeId, role, capabilityName) {
  if (typeof capabilityName !== 'string' || !capabilityName.trim()) {
    throw new AiCapabilityCatalogValidationError('capability is required and must be a non-empty string');
  }
  const name = capabilityName.trim();
  const tool = registryModule().getTool(name);
  if (tool === null) {
    return {
      capability: name,
      available: false,
      reason: 'not_a_capability',
      explanation: 'ARCNAVE has no capability by that name. Use capability_search to find what does exist.',
    };
  }
  if (tool.humanOnly) {
    return {
      capability: name,
      available: false,
      reason: 'human_only',
      explanation: 'This action is deliberately reserved for a person to perform directly in ARCNAVE — the AI is not permitted to do it on anyone\'s behalf.',
    };
  }
  if (!(tool.allowedRoles || []).includes(role)) {
    return {
      capability: name,
      available: false,
      reason: 'role_not_permitted',
      explanation: 'This capability is not available to your role. A colleague whose role does include it would need to do this.',
    };
  }
  const configCategory = OPT_IN_CAPABILITIES[name];
  if (configCategory) {
    const row = await configurationService.getConfiguration(client, { collegeId, category: configCategory });
    const enabled = Boolean(row && row.configuration && row.configuration.enabled);
    if (!enabled) {
      return {
        capability: name,
        available: false,
        reason: 'not_enabled_for_college',
        explanation: `This capability is switched off for your college. Your principal can enable it in settings (${configCategory}); the AI cannot turn it on.`,
      };
    }
  }
  return {
    capability: name,
    available: true,
    reason: 'available',
    explanation: 'This capability is available to you. If a specific attempt still failed, the reason will be in that attempt\'s own error, not in permissions.',
  };
}

module.exports = {
  AiCapabilityCatalogValidationError,
  MAX_MATCHES,
  OPT_IN_CAPABILITIES,
  capabilitySearch,
  capabilityExplain,
};
