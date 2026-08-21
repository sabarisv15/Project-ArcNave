'use strict';

// Shared Server-Sent-Events line reader for the streaming variant of
// each adapter's complete() (P0.5 of the AI capability roadmap,
// CHECKPOINT.md). Every vendor here (NIM/self-hosted's OpenAI-
// compatible SSE, Claude's SSE, Gemini's `alt=sse`) sends the same
// wire framing — lines starting with `data: `, a blank line between
// events, a final `data: [DONE]` sentinel for the OpenAI-compatible
// two — so the byte-stream parsing lives in exactly one place;
// interpreting each event's JSON payload stays in each adapter, which
// is the only part that's actually vendor-specific.
//
// Node's built-in fetch (undici) exposes `response.body` as an
// async-iterable ReadableStream of Buffer/Uint8Array chunks — this
// does not depend on any extra package.

async function* iterateSseLines(response) {
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += chunk.toString('utf8');
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trimEnd();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.startsWith('data:')) {
        const payload = line.slice('data:'.length).trim();
        if (payload) yield payload;
      }
      newlineIndex = buffer.indexOf('\n');
    }
  }
}

module.exports = { iterateSseLines };
