'use strict';
// Measures whether Vertex multimodal embeddings could back an
// image-similarity capability for ARCNAVE. Read-only: no DB writes, no
// index created, nothing registered as a tool. Run:
//   set -a && . ./.env.local.sh && set +a && node scripts/multimodal-embedding-probe.js
//
// WHAT THIS IS NOT: it is not `image_search`. That tool searched the
// open WEB for images and has no provider since Brave was removed.
// This is similarity over a corpus we index ourselves — a different
// capability that happens to use the word "image".
const { GoogleAuth } = require('google-auth-library');
const config = require('../src/config');

const MODEL = 'multimodalembedding@001';
// Deliberately NOT config.gemini.location. That is 'global' for chat;
// this model is region-served and was verified separately in
// us-central1, asia-south1 and global — all three returned 1408 dims.
const LOCATION = process.env.MM_EMBED_LOCATION || 'us-central1';

function cosine(a, b) {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / Math.sqrt(na * nb);
}

async function main() {
  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  const { token } = await (await auth.getClient()).getAccessToken();
  const host = LOCATION === 'global' ? 'aiplatform.googleapis.com' : `${LOCATION}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${config.gemini.projectId}/locations/${LOCATION}`
    + `/publishers/google/models/${MODEL}:predict`;

  const embed = async (instance) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [instance] }),
    });
    const json = await res.json();
    if (json.error) throw new Error(`${res.status}: ${json.error.message}`);
    return json.predictions[0];
  };

  const probe = await embed({ text: 'a college campus' });
  console.log(`model reachable in ${LOCATION}: textEmbedding dims = ${probe.textEmbedding.length}`);
  console.log('\nTo re-run the retrieval check, pass base64 PNGs as argv:');
  console.log('  node scripts/multimodal-embedding-probe.js <name>=<b64> ... -- "query one" "query two"');

  const sep = process.argv.indexOf('--');
  const imgArgs = process.argv.slice(2, sep === -1 ? undefined : sep);
  const queries = sep === -1 ? [] : process.argv.slice(sep + 1);
  if (!imgArgs.length) return;

  const store = {};
  for (const arg of imgArgs) {
    const [name, b64] = arg.split('=');
    // eslint-disable-next-line no-await-in-loop
    store[name] = (await embed({ image: { bytesBase64Encoded: b64 } })).imageEmbedding;
  }
  for (const q of queries) {
    // eslint-disable-next-line no-await-in-loop
    const qe = (await embed({ text: q })).textEmbedding;
    const ranked = Object.entries(store)
      .map(([name, vec]) => [name, cosine(qe, vec)])
      .sort((a, b) => b[1] - a[1]);
    console.log(`\nquery: "${q}"`);
    ranked.forEach(([name, score], i) => console.log(`  ${i + 1}. ${name.padEnd(14)} ${score.toFixed(4)}`));
  }
}

main().catch((err) => { console.error('FAILED:', err.message); process.exitCode = 1; });
