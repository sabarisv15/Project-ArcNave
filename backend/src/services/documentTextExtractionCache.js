'use strict';

// ARCNAVE modernization P3 (2.3) — "Each new turn re-downloads and
// re-extracts the file ... extracted text is not saved."
//
// Scope, deliberately narrow (see the comment on `getOrExtract` below
// for why the DOWNLOAD half of that sentence is NOT addressed here):
// this caches only `documentTextExtractionService.extractPlainText`'s
// result — the real CPU-heavy work (pdf-parse/mammoth/exceljs parsing a
// whole document) — keyed by the chat attachment's document id. A chat
// attachment (`documentService.CHAT_ATTACHMENT_DOC_TYPE`) has exactly
// one write path (`uploadChatAttachment`) and no update-in-place path,
// so its content is immutable for the row's lifetime — a stable id-keyed
// cache needs no content-hash/invalidation logic, unlike a cache over
// mutable data.
//
// In-memory, per-process, same posture `aiExplicitCache.js` already
// established for this exact reason (no new infra, single app instance
// today — see D1's own "revisit once there are multiple app instances"
// decision, ADL-072's sibling banner in CURRENT-STATE.md): lost on
// restart, not shared across instances. Acceptable because the
// consequence of a miss is identical to today's behavior (re-extract),
// never a correctness problem — this is a latency/cost optimization
// layer, not a source of truth.

// TTL matches the practical lifetime of a chat conversation referencing
// the same attachment repeatedly, generous because content never
// changes (unlike aiExplicitCache's 60-min TTL, which exists because a
// Vertex-side handle genuinely expires) — this TTL exists only to bound
// memory for attachments nobody references again, not for correctness.
const TTL_MS = 24 * 60 * 60 * 1000;
// A hard cap on distinct cached attachments, independent of TTL — same
// "bound memory even under a burst of distinct keys before their TTL
// naturally expires them" reasoning as any other unbounded-key
// in-memory cache. Evicts the oldest entry (insertion order, a plain
// Map already preserves this) when a new entry would exceed it.
const MAX_ENTRIES = 2000;

// attachmentId -> { result, cachedAt }
const cache = new Map();

function isExpired(entry) {
  return Date.now() - entry.cachedAt > TTL_MS;
}

function evictOldestIfFull() {
  if (cache.size < MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

// Returns the extraction result ({ text, method?, pages?, failureReason? }
// — documentTextExtractionService.extractPlainText's own shape,
// untouched) plus `cacheHit: boolean` so a caller can distinguish a
// cached serve from a fresh extraction (e.g. for audit metadata,
// without changing what gets logged, just adding a fact to it).
//
// `extractFn` is called (and its result cached) only on a miss/expiry —
// the caller still must have already downloaded the buffer to pass to
// it on a miss, so this does NOT skip the disk read/File Intelligence
// Router classification step that happens before extraction in
// resolveChatAttachments (aiService.js) — that classification runs
// real magic-byte sniffing on the actual bytes and is deliberately NOT
// trusted to a cached/declared mime type alone (the whole reason that
// router exists). Only the expensive PARSE step is ever skipped.
async function getOrExtract(attachmentId, extractFn) {
  const existing = cache.get(attachmentId);
  if (existing && !isExpired(existing)) {
    return { ...existing.result, cacheHit: true };
  }
  if (existing) {
    cache.delete(attachmentId); // expired — falls through to re-extract
  }

  const result = await extractFn();
  evictOldestIfFull();
  cache.set(attachmentId, { result, cachedAt: Date.now() });
  return { ...result, cacheHit: false };
}

function _reset() {
  cache.clear();
}

module.exports = { getOrExtract, _reset, TTL_MS, MAX_ENTRIES };
