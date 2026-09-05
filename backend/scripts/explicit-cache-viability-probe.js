'use strict';

// ARCNAVE modernization P2 / clash C2 — explicit prompt caching viability probe.
//
// ADL-054/055 closed "build explicit caching" as NOT-YET-JUSTIFIED and
// found implicit Vertex caching returns ~0 signal for this deployment.
// The modernization plan re-opens it ("hi = 4,500 words"). Before
// building a whole cachedContent subsystem into gemini.js/aiService.js,
// this probe answers the two questions that decide whether it is even
// worth building:
//
//   1. Does Vertex AI accept an explicit `cachedContents` resource for
//      the actually-configured model (gemini-3.7-flash) at the endpoint
//      it actually resolves in? Context caching has historically had a
//      MINIMUM cacheable token count and regional-endpoint constraints.
//   2. If accepted, does referencing it on a follow-up generateContent
//      call actually reduce BILLED input tokens (promptTokenCount minus
//      cachedContentTokenCount), by how much, and is that saving larger
//      than ARCNAVE's real stable-prefix size makes worthwhile?
//
// Real, billable Vertex calls (~6). Authorised for the P2 measurement
// session. Creates a cachedContent with a short TTL (120s) and deletes
// it at the end.
//
// Run (inside the app container):
//   node scripts/explicit-cache-viability-probe.js

const { GoogleAuth } = require('google-auth-library');
const config = require('../src/config');
const aiPolicyAssembly = require('../src/services/aiPolicyAssembly');

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

function hostFor(loc) {
  return loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
}

async function token() {
  const auth = new GoogleAuth({ scopes: CLOUD_PLATFORM_SCOPE });
  const client = await auth.getClient();
  const { token: t } = await client.getAccessToken();
  return t;
}

async function api(loc, path, method, body) {
  const url = `https://${hostFor(loc)}/v1/projects/${config.gemini.projectId}/locations/${loc}/${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// A realistic stand-in for askAgent's stable decision-call prefix: the
// real curriculum policy for a principal, plus the mode prefix, repeated
// to roughly the size the always-on tool catalogue adds (~2,200 tok) so
// the total (~4k tok) matches what a real turn's cacheable prefix would
// be.
function buildStablePrefix() {
  const policy = aiPolicyAssembly.buildPolicy({
    mode: 'curriculum',
    hasHistory: false,
    toolCount: 8,
    hasFileTool: true,
  });
  const modePrefix = aiPolicyAssembly.MODE_PREFIX.curriculum;
  const catalogueStandIn = Array.from(
    { length: 90 },
    (_, i) =>
      `tool_${i}: a domain capability the assistant may call when the question needs it; ` +
      `arguments are validated server-side and every invocation re-checks tenant, role and classification.`,
  ).join('\n');
  return `${modePrefix}\n\n${policy}\n\n[Tool routing keywords]\n${catalogueStandIn}`;
}

async function tryLocation(loc) {
  console.log(`\n===== location: ${loc} =====`);
  const systemText = buildStablePrefix();
  console.log(`stable prefix chars: ${systemText.length} (~${Math.round(systemText.length / 4)} tokens est.)`);

  const modelPath = `projects/${config.gemini.projectId}/locations/${loc}/publishers/google/models/${config.gemini.model}`;

  const create = await api(loc, 'cachedContents', 'POST', {
    model: modelPath,
    systemInstruction: { role: 'system', parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: 'Context loaded. Await the real question.' }] }],
    ttl: '120s',
  });
  if (create.status !== 200) {
    console.log(`cachedContents CREATE -> HTTP ${create.status}: ${JSON.stringify(create.json).slice(0, 400)}`);
    return { loc, viable: false, reason: `create ${create.status}` };
  }
  const cacheName = create.json.name;
  const cachedTokens = create.json.usageMetadata && create.json.usageMetadata.totalTokenCount;
  console.log(`cachedContents CREATE -> OK  name=${cacheName}  cachedTokenCount=${cachedTokens}`);

  const gen = async (useCache) => {
    const body = {
      contents: [{ role: 'user', parts: [{ text: 'Question: 3rd Sem CSE-A attendance percentage enna?' }] }],
    };
    if (useCache) body.cachedContent = cacheName;
    else body.systemInstruction = { role: 'system', parts: [{ text: systemText }] };
    const r = await api(loc, `publishers/google/models/${config.gemini.model}:generateContent`, 'POST', body);
    const um = (r.json && r.json.usageMetadata) || {};
    return {
      status: r.status,
      prompt: um.promptTokenCount,
      cached: um.cachedContentTokenCount || 0,
      billedInput: (um.promptTokenCount || 0) - (um.cachedContentTokenCount || 0),
      err: r.status !== 200 ? JSON.stringify(r.json).slice(0, 300) : undefined,
    };
  };

  const withCache = [await gen(true), await gen(true)];
  const withoutCache = [await gen(false), await gen(false)];
  console.log('WITH    cachedContent:', JSON.stringify(withCache));
  console.log('WITHOUT cachedContent:', JSON.stringify(withoutCache));

  const del = await api(loc, cacheName.split(`/locations/${loc}/`)[1], 'DELETE');
  console.log(`cachedContents DELETE -> HTTP ${del.status}`);

  const avgBilledWith = withCache.reduce((s, x) => s + x.billedInput, 0) / withCache.length;
  const avgBilledWithout = withoutCache.reduce((s, x) => s + x.billedInput, 0) / withoutCache.length;
  return {
    loc,
    viable: withCache.every((x) => x.status === 200),
    avgBilledInputWithCache: avgBilledWith,
    avgBilledInputWithoutCache: avgBilledWithout,
    billedInputSaved: avgBilledWithout - avgBilledWith,
  };
}

async function main() {
  console.log(
    `project=${config.gemini.projectId} model=${config.gemini.model} configuredLocation=${config.gemini.location}`,
  );
  const results = [];
  for (const loc of [config.gemini.location, 'us-central1'].filter((v, i, a) => v && a.indexOf(v) === i)) {
    try {
      results.push(await tryLocation(loc));
    } catch (e) {
      results.push({ loc, viable: false, reason: e.message });
    }
  }
  console.log('\n===== VERDICT =====');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
