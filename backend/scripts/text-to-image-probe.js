'use strict';
// Measures Vertex AI Imagen (text -> generated image) as a candidate
// backend for the `image_search` tool, which currently throws
// WebSearchNotConfiguredError unconditionally (webSearchService.js:307)
// because Brave, its only provider, was removed and Vertex search
// grounding has no image index. This is a DIFFERENT capability —
// GENERATING a new image from a prompt, not finding an existing one on
// the web — proposed 2026-08-28 as an alternative route for the same
// product need ("staff wants a picture for a presentation").
//
// Read-only in the sense that it registers no tool and touches no DB;
// it DOES make a real, billable Vertex call and writes one PNG to
// backend/scripts/.out/ for visual inspection. Run:
//   set -a && . ./.env.local.sh && set +a && \
//     node scripts/text-to-image-probe.js "a futuristic neon city with flying cars, cinematic lighting"
//
// Model: imagen-4.0-generate-001 (GA as of 2026; imagen-3.0-generate-*
// is the deprecated predecessor, migration deadline 2026-06-30 per
// Google's own docs). Region-served like multimodalembedding@001 —
// deliberately NOT config.gemini.location.
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const config = require('../src/config');

const MODEL = process.env.IMAGEN_MODEL || 'imagen-4.0-generate-001';
const LOCATION = process.env.IMAGEN_LOCATION || 'us-central1';
const OUT_DIR = path.join(__dirname, '.out');

async function main() {
  const prompt = process.argv.slice(2).join(' ').trim();
  if (!prompt) throw new Error('pass a text prompt as argv, e.g. node scripts/text-to-image-probe.js "a campus library, watercolor"');

  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  const { token } = await (await auth.getClient()).getAccessToken();
  const host = LOCATION === 'global' ? 'aiplatform.googleapis.com' : `${LOCATION}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${config.gemini.projectId}/locations/${LOCATION}`
    + `/publishers/google/models/${MODEL}:predict`;

  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: '16:9',
        safetySetting: 'block_medium_and_above',
        personGeneration: 'allow_adult',
      },
    }),
  });
  const elapsedMs = Date.now() - started;
  const json = await res.json();
  if (json.error) throw new Error(`${res.status}: ${json.error.message}`);

  const prediction = (json.predictions || [])[0];
  console.log(`model: ${MODEL}  region: ${LOCATION}  latency: ${elapsedMs}ms`);
  console.log(`prompt: "${prompt}"`);

  if (!prediction) {
    console.log('predictions: 0 (empty array — nothing generated, no error field either)');
    return;
  }
  if (prediction.raiFilteredReason) {
    console.log(`BLOCKED by safety filter: ${prediction.raiFilteredReason}`);
    return;
  }
  if (!prediction.bytesBase64Encoded) {
    console.log('unexpected prediction shape:', JSON.stringify(prediction).slice(0, 300));
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const bytes = Buffer.from(prediction.bytesBase64Encoded, 'base64');
  const outPath = path.join(OUT_DIR, `imagen-${Date.now()}.png`);
  fs.writeFileSync(outPath, bytes);
  console.log(`mimeType: ${prediction.mimeType || '(none reported)'}  size: ${Math.round(bytes.length / 1024)}KB`);
  console.log(`saved: ${outPath}`);
}

main().catch((err) => { console.error('FAILED:', err.message); process.exitCode = 1; });
