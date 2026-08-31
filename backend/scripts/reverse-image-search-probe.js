'use strict';
// Measures Cloud Vision WEB_DETECTION as a reverse-image-search backend
// (image -> visually similar images on the open web). Read-only: sends
// one image, registers no tool, writes nothing.
//
//   set -a && . ./.env.local.sh && set +a && \
//     node scripts/reverse-image-search-probe.js <image-url-or-path>
//
// TWO THINGS THIS IS NOT:
//   * Not `image_search`. That was TEXT -> web image URLs, served by the
//     Custom Search JSON API, which is dead for this project (403
//     PERMISSION_DENIED, re-measured 2026-08-28 — Google closed it to
//     new projects ahead of its 2027-01-01 discontinuation).
//   * Not the multimodalembedding path either. That searches a corpus we
//     index ourselves; this searches Google's web index.
const fs = require('fs');
const { GoogleAuth } = require('google-auth-library');
const config = require('../src/config');

// ADC needs an explicit quota project for vision.googleapis.com — without
// this header the call fails PERMISSION_DENIED with a message about
// quota projects that reads like a permissions problem but is not.
const QUOTA_PROJECT_HEADER = 'x-goog-user-project';

async function loadImageBase64(source) {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { redirect: 'follow' });
    if (!res.ok) throw new Error(`could not download ${source}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  }
  return fs.readFileSync(source).toString('base64');
}

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error('pass an image URL or local path');
  // Bytes, not an imageUri: Google's own fetcher is blocked by plenty of
  // hosts (Wikipedia among them), and that failure arrives as a
  // per-image "URL does not appear to be accessible by us" rather than
  // as a request error.
  const content = await loadImageBase64(source);

  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  const { token } = await (await auth.getClient()).getAccessToken();
  const res = await fetch('https://vision.googleapis.com/v1/images:annotate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [QUOTA_PROJECT_HEADER]: config.gemini.projectId,
    },
    body: JSON.stringify({
      requests: [{ image: { content }, features: [{ type: 'WEB_DETECTION', maxResults: 10 }] }],
    }),
  });
  const json = await res.json();
  const first = json.responses && json.responses[0];
  if (json.error) throw new Error(json.error.message);
  if (first && first.error) throw new Error(`per-image: ${first.error.message}`);

  const wd = (first && first.webDetection) || {};
  console.log(`image: ${source}  (${Math.round((content.length * 0.75) / 1024)}KB)`);
  console.log(`visuallySimilarImages:  ${(wd.visuallySimilarImages || []).length}`);
  console.log(`fullMatchingImages:     ${(wd.fullMatchingImages || []).length}`);
  console.log(`pagesWithMatchingImages:${(wd.pagesWithMatchingImages || []).length}`);
  (wd.visuallySimilarImages || []).slice(0, 5).forEach((i) => console.log('   -', i.url));
  // Entity quality tracks how distinctive the image is. A canyoning
  // photo returned "Canyoning, Extreme sport, Canyon, Hiking, Climbing"
  // — accurate. A generic stock landscape returned "Psychiatric-mental
  // health nurse practitioner" and "Nascar" — nonsense. So treat entity
  // labels as a hint whose confidence varies with the subject, never as
  // a claim about the image.
  console.log(
    'webEntities:',
    (wd.webEntities || [])
      .slice(0, 5)
      .map((e) => e.description)
      .filter(Boolean)
      .join(', ') || '(none)',
  );
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
});
