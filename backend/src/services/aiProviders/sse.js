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
// async-iterable ReadableStream of chunks — REAL ones are plain
// Uint8Array, not Buffer (confirmed live: `chunk.constructor.name` is
// `Uint8Array`, `Buffer.isBuffer(chunk)` is false). `chunk.toString
// ('utf8')` used to be called directly here — silently wrong on a real
// Uint8Array, because Uint8Array has no Buffer-style toString(encoding)
// override; it falls back to Array.prototype.toString and produces a
// comma-joined list of byte numbers (`"100,97,116,97,58,32,104,105"`),
// never real text. Every fake response in this file's own tests uses
// `Buffer.from(line)` chunks — genuine Buffers, whose toString(encoding)
// override worked fine — so this was invisible in every unit test while
// silently breaking `iterateSseLines` against any real network response:
// no `data:` line was ever found (no real newline character exists in a
// comma-joined digit string), so every real streaming call across every
// adapter (this file is shared by NIM/self-hosted/Claude/Gemini/OpenAI)
// produced zero deltas and an empty final answer. A single TextDecoder
// reused across the whole iteration (not `new TextDecoder()` per chunk)
// is also what correctly reassembles a multi-byte UTF-8 character split
// across two chunks — Tamil script is multi-byte UTF-8, and this app's
// real traffic is heavily Tamil/Tanglish, so that's a real risk here,
// not a theoretical one.
async function* iterateSseLines(response) {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
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
