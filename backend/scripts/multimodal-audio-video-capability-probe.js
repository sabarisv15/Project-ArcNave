'use strict';

// Does the configured Vertex AI model (GEMINI_MODEL) actually accept
// audio as a native multimodal input part, and can it say something
// correct about the content — or does it reject the mime type / modality
// outright? This project's own explicit rule (ai-chat-file-intelligence-
// router-approved-spec.md, and the task that produced it) is "never
// assume a model's capability from its name" — ADL-058's own history
// here is that native Gemini PDF reading was ASSUMED unusable and later
// measured to be excellent at attribution (just unable to count), so
// guessing in either direction has already been shown to be wrong at
// least once on this exact model family.
//
// This probe only exercises AUDIO. A real, synthesized-in-Node WAV
// file (valid PCM, not a fabricated/corrupt stand-in) is used so a
// rejection response can be trusted to mean "modality/mime type
// rejected", not "the file itself was invalid" — the same
// self-consistency-over-assumption discipline
// native-pdf-vs-deterministic-probe.js already established for PDFs.
//
// VIDEO and HEIC are NOT covered here — synthesizing a genuinely valid
// minimal MP4/MOV or HEIC file requires an encoder (ffmpeg/libheif) not
// available on this host at probe-writing time. Left as an explicitly
// open, unmeasured item (see the approved spec's own Edge cases /
// Testing requirements sections) rather than faked with an invalid
// fixture that would only prove "invalid file rejected", which tells us
// nothing about modality support either way. The runtime code MUST NOT
// assume this probe's audio result generalizes to video/HEIC.
//
// Makes ONE real, billable Vertex call. Read-only, no database.
//
// Run (from backend/):
//   set -a && . ./.env.local.sh && set +a && node scripts/multimodal-audio-video-capability-probe.js

const { GoogleAuth } = require('google-auth-library');
const config = require('../src/config');

// A real, valid 16-bit PCM mono WAV — one second of a 440Hz sine tone
// at an 8000Hz sample rate. Small (~16KB) but a genuine, standards-
// conformant WAV file, not silence-only bytes or a truncated header.
function buildSineWavBase64() {
  const sampleRate = 8000;
  const seconds = 1;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    const sample = Math.round(Math.sin(2 * Math.PI * 440 * t) * 0.5 * 32767);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  return buffer.toString('base64');
}

async function accessToken() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const { token } = await (await auth.getClient()).getAccessToken();
  return token;
}

function modelUrl() {
  const loc = config.gemini.location || 'global';
  const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
  const model = config.gemini.model || 'gemini-3.7-flash';
  return `https://${host}/v1/projects/${config.gemini.projectId}/locations/${loc}/publishers/google/models/${model}:generateContent`;
}

async function main() {
  if (!config.gemini.projectId) {
    console.error('GEMINI_PROJECT_ID is not set — cannot run a live probe.');
    process.exitCode = 1;
    return;
  }
  const token = await accessToken();
  const audioBase64 = buildSineWavBase64();

  const res = await fetch(modelUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'audio/wav', data: audioBase64 } },
          { text: 'Describe, in one short sentence, what you hear in this audio clip (pitch/tone/duration is enough — no transcription is expected since this is a pure tone, not speech).' },
        ],
      }],
      generationConfig: { temperature: 0, maxOutputTokens: 256 },
    }),
  });

  const bodyText = await res.text();
  console.log(`HTTP status: ${res.status}`);
  if (!res.ok) {
    console.log('VERDICT: REJECTED — the model/endpoint returned a non-2xx for an audio/wav inline_data part.');
    console.log('Response body (first 1000 chars):');
    console.log(bodyText.slice(0, 1000));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    console.log('VERDICT: UNCLEAR — 2xx status but response body did not parse as JSON.');
    console.log(bodyText.slice(0, 1000));
    return;
  }
  const text = (payload.candidates || [])
    .flatMap((c) => (c.content && c.content.parts) || [])
    .map((p) => p.text || '')
    .join('');
  console.log('VERDICT: ACCEPTED — the model returned a real response to the audio input.');
  console.log('Model response:');
  console.log(text || '(empty text — check the raw payload below)');
  if (!text) {
    console.log(JSON.stringify(payload, null, 2).slice(0, 2000));
  }
}

main().catch((err) => {
  console.error('Probe failed with an unexpected error:', err.message);
  process.exitCode = 1;
});
