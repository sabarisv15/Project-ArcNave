'use strict';

// TOKEN MEASUREMENT ONLY — no production code modified by this script,
// no billable generation calls (countTokens only, same mechanism/model
// as scripts/token-cost-probe.js and scripts/token-measurement-
// deferred-loading-probe.js). Measures 4 catalogue-text representations
// (A = current production text, B/C/D = alternative "Gemini routes
// itself" hypotheses from this session's follow-up request) across the
// same 4 real roles, using the real aiToolRegistry at runtime.
//
// B/C/D per-tool text is DERIVED MECHANICALLY from each tool's real
// `description` field already in the registry — never hand-authored
// per tool, never invented. The exact rule is in toWhenToUse()/
// toKeywords() below, disclosed so the comparison is honest about how
// "short" each variant's text really is, not presented as expertly
// hand-tuned routing copy for all ~101 tools.
//
// Run (from backend/):
//   set -a && . ./.env.local.sh && set +a && node scripts/catalogue-routing-token-probe.js

const { GoogleAuth } = require('google-auth-library');
const config = require('../src/config');
const toolRegistry = require('../src/services/aiToolRegistry');
const { Pool } = require('pg');
require('../src/services/aiInteractionService');
require('../src/services/aiDiagramService');

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const auth = new GoogleAuth({ scopes: CLOUD_PLATFORM_SCOPE });

const ROLES = ['principal', 'hod', 'class_tutor', 'staff'];
const DUMMY_CONTENTS = [{ role: 'user', parts: [{ text: 'What is my attendance today?' }] }];

function modelUrl(cfg, modelId, verb) {
  const loc = cfg.location || 'global';
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${cfg.projectId}/locations/${loc}/publishers/google/models/${modelId}:${verb}`;
}

async function countTokens(body) {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const cfg = config.gemini;
  const modelId = cfg.model || 'gemini-3.7-flash';
  const url = modelUrl(cfg, modelId, 'countTokens');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`countTokens ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = await res.json();
  return json.totalTokens;
}

// --- Variant A: copied verbatim from aiService.js's real buildToolCatalogue/firstSentence (~lines 987-1002) ---
function firstSentence(text) {
  return String(text || '').split(/(?<=\.)\s/)[0].slice(0, 140).trim();
}
function buildCatalogueA(roleTools) {
  const lines = roleTools.map((t) => `${t.name} — ${firstSentence(t.description)}`).join('\n');
  return 'EVERY tool available to you, by name. The ones already described in full above are ready to call '
    + 'directly. For any OTHER name in this list, call describe_tools with that name first to get its '
    + 'parameters — you cannot call it before doing so. If nothing here fits the question, say so plainly '
    + `rather than answering as if you had checked.\n\n${lines}\n\nAlready described in full above: (n/a, floor measurement).`;
}

// --- Variant B: "name + one-line when to use" — mechanically derived
// from the REAL description, not hand-authored per tool. Prefers
// cutting at the first clause boundary (comma/semicolon/period/em-dash/
// open-paren) found within 1.5x the target length; otherwise a clean
// word-boundary cut at the target length (never mid-word). ---
const VARIANT_B_MAX = 55;
function toWhenToUse(description, maxLen) {
  const text = String(description || '').trim();
  const searchWindow = text.slice(0, Math.floor(maxLen * 1.5));
  const boundary = searchWindow.search(/[,.;—(]/);
  if (boundary !== -1 && boundary <= maxLen) return text.slice(0, boundary).trim();
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 10 ? cut.slice(0, lastSpace) : cut).trim();
}
function buildCatalogueB(roleTools) {
  const lines = roleTools.map((t) => `${t.name} — ${toWhenToUse(t.description, VARIANT_B_MAX)}`).join('\n');
  return 'Tool routing guide — name and when to use it. If nothing below fits the question, say so plainly.\n\n'
    + `${lines}`;
}

// --- Variant C: "ultra-short keywords" — Variant B's text with a
// further mechanical pass: strip a leading common-verb boilerplate
// phrase (Records/Returns/Lists/Shows/Fetches/Gets/Retrieves/
// Generates/Creates/Updates/Marks/Finds + optional article), then
// re-cap shorter. Still derived from the real description, not
// invented per tool. ---
const VARIANT_C_MAX = 32;
const LEADING_VERB_RE = /^(records?|returns?|lists?|shows?|fetches?|gets?|retrieves?|generates?|creates?|updates?|marks?|finds?|resolves?|drafts?)\s+(the\s+|a\s+|an\s+|one\s+)?/i;
function toKeywords(description) {
  const shortened = toWhenToUse(description, VARIANT_C_MAX + 25).replace(LEADING_VERB_RE, '');
  return toWhenToUse(shortened, VARIANT_C_MAX);
}
function buildCatalogueC(roleTools) {
  const lines = roleTools.map((t) => `${t.name} — ${toKeywords(t.description)}`).join('\n');
  return 'Tool routing keywords.\n\n' + lines;
}

// --- Variant D: category + tool routing, reusing Variant C's per-tool
// text so the comparison isolates grouping/headers, not text length. ---
// Category assignment is a REASONABLE DERIVATION from real, observed
// name prefixes in the current registry (grepped this session) — not
// an officially-defined taxonomy elsewhere in this codebase. Disclosed
// so the reader can judge it, not presented as canonical.
const CATEGORY_RULES = [
  [/^attendance_|^mark_attendance_nl$/, 'ATTENDANCE'],
  [/^students_/, 'STUDENTS'],
  [/^staff_/, 'STAFF'],
  [/^academic_|^class_assign_tutor$|^substitute_/, 'ACADEMIC'],
  [/^assessment_/, 'ASSESSMENT'],
  [/^finance_/, 'FINANCE'],
  [/^departments_/, 'DEPARTMENTS'],
  [/^calendar_|^list_calendar_events$/, 'CALENDAR'],
  [/^reports_/, 'REPORTS'],
  [/^draft_notification$|^request_notification_send$|^class_send_alert$/, 'NOTIFICATIONS'],
  [/^class_log_/, 'CLASS_LOG'],
  [/document|^search_documents$|^upload_institutional_document$|^resolve_document_destination$|^analyze_document_table$|^manage_project_document$|^update_project_instructions$|^export_artifact|^list_own_artifacts$|^update_artifact_content$|^generate_document$/, 'DOCUMENTS'],
  [/^ai_memory_|^personal_notes_|^user_preferences_|^conversation_/, 'MEMORY_PREFS'],
  [/^present_|^decide_output_format$|^decide_image_route$|^describe_diagram_constraints$|^generate_image$|^image_search$/, 'PRESENTATION'],
  [/^web_|^fetch_trusted_web_page$|^weather_fetch$/, 'WEB_EXTERNAL'],
];
function categoryOf(name) {
  const rule = CATEGORY_RULES.find(([re]) => re.test(name));
  return rule ? rule[1] : 'SYSTEM';
}
function buildCatalogueD(roleTools) {
  const byCategory = new Map();
  roleTools.forEach((t) => {
    const cat = categoryOf(t.name);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(t);
  });
  const sections = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(
    ([cat, tools]) => `${cat}\n${tools.map((t) => `- ${t.name} — ${toKeywords(t.description)}`).join('\n')}`,
  );
  return 'Tool routing guide, grouped by category.\n\n' + sections.join('\n\n');
}

async function measureRole(role) {
  const roleTools = toolRegistry.listTools({ excludeHumanOnly: true, role });
  const variants = {
    variantA_current: buildCatalogueA(roleTools),
    variantB_oneLine: buildCatalogueB(roleTools),
    variantC_keywords: buildCatalogueC(roleTools),
    variantD_category: buildCatalogueD(roleTools),
  };

  const results = { role, totalTools: roleTools.length };
  for (const [key, text] of Object.entries(variants)) {
    // eslint-disable-next-line no-await-in-loop
    results[key] = await countTokens({ contents: DUMMY_CONTENTS, systemInstruction: { parts: [{ text }] } });
    results[`${key}_chars`] = text.length;
  }
  results.sampleVariantD = variants.variantD_category.split('\n').slice(0, 12).join('\n');
  return results;
}

async function main() {
  const rows = [];
  for (const role of ROLES) {
    // eslint-disable-next-line no-await-in-loop
    const r = await measureRole(role);
    rows.push(r);
    console.log(`\n=== role: ${role} (${r.totalTools} permitted tools) ===`);
    console.log(`  A current   : ${r.variantA_current} tok (${r.variantA_current_chars} chars)`);
    console.log(`  B one-line  : ${r.variantB_oneLine} tok (${r.variantB_oneLine_chars} chars)`);
    console.log(`  C keywords  : ${r.variantC_keywords} tok (${r.variantC_keywords_chars} chars)`);
    console.log(`  D category  : ${r.variantD_category} tok (${r.variantD_category_chars} chars)`);
  }

  console.log('\n\n=== SAMPLE Variant D output (Principal, first 12 lines) ===');
  console.log(rows[0].sampleVariantD);

  console.log('\n\n=== SUMMARY TABLE (raw countTokens totals, floor NOT subtracted — includes the fixed DUMMY_CONTENTS) ===');
  console.log('role       | tools | A(current) | B(one-line) | C(keywords) | D(category) | B saving | C saving | D saving');
  rows.forEach((r) => {
    const bSave = (((r.variantA_current - r.variantB_oneLine) / r.variantA_current) * 100).toFixed(1);
    const cSave = (((r.variantA_current - r.variantC_keywords) / r.variantA_current) * 100).toFixed(1);
    const dSave = (((r.variantA_current - r.variantD_category) / r.variantA_current) * 100).toFixed(1);
    console.log(
      `${r.role.padEnd(11)}| ${String(r.totalTools).padEnd(6)}| ${String(r.variantA_current).padEnd(12)}| `
      + `${String(r.variantB_oneLine).padEnd(13)}| ${String(r.variantC_keywords).padEnd(12)}| ${String(r.variantD_category).padEnd(12)}| `
      + `${bSave}%     | ${cSave}%     | ${dSave}%`,
    );
  });
}

main().catch((err) => { console.error(err); process.exit(1); });
