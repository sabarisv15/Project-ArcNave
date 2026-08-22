'use strict';

// A chat message's own attachment(s) never made it to the DB at all —
// sendMessage (WorkspaceProvider.jsx) only ever persisted {role, content}
// for the user's turn, even though the same function had the uploaded
// attachments' metadata (name/type/size/serverId) available a few lines
// away — it just never passed them through. So reopening a conversation
// after a reload showed the prompt text but silently dropped which
// file(s) had been attached to it — real live-reported gap, not a
// hypothetical.
//
// `attachments` is a plain JSONB array of small display objects
// (`{id, serverId, name, type, size}`, one per sent file) — not just a
// list of documents.id values, so the transcript can be re-rendered by
// ChatMessage.jsx's existing SentFileChip on reload without a second
// round trip to look up each file's name. Same "extra payload lives in
// a JSONB column, not a new join table" convention this table's own
// raw_data column already established for the assistant side's
// generated-document round-trip (aiService.js's
// extractDocumentAttachment). No FK: an attachment id is resolved (and
// re-authorized) through resolveChatAttachments/documentService at the
// point it's actually used by the AI turn, the same place that already
// validates it — this column is a display record of what was already
// sent, not a new access grant, consistent with presentation/raw_data
// on this same table, neither of which is FK-checked either.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql('ALTER TABLE messages ADD COLUMN attachments JSONB');
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE messages DROP COLUMN IF EXISTS attachments');
};
