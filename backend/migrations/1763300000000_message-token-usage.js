'use strict';

// Token/cost telemetry (P1.6) was captured only into audit_log metadata,
// and only for the non-streaming LLM path — invisible to the frontend,
// and the streaming path (the one the real chat UI actually uses) never
// captured it at all (aiService.js's own completeMaybeStreaming comment
// flagged this as deliberately deferred, not an oversight). Now that
// every provider adapter's completeStream reports usage when the vendor
// stream carries it (ADL-048), the assistant's own messages row is where
// the frontend can render it per-turn — the same "extra payload lives in
// a plain column on this table" convention message-attachments.js and
// message-edit-and-rewind.js already established, not a new join table.
//
// Nullable on purpose: usage is genuinely unknown for a message sent
// before this migration, for a provider/path where the vendor never
// returned a usage block, or when a stream was interrupted before the
// usage-bearing final chunk arrived — never fabricated as 0.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE messages ADD COLUMN input_tokens INTEGER');
  pgm.sql('ALTER TABLE messages ADD COLUMN output_tokens INTEGER');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE messages DROP COLUMN IF EXISTS input_tokens');
  pgm.sql('ALTER TABLE messages DROP COLUMN IF EXISTS output_tokens');
};
