'use strict';

// Real rewind (product decision, this round): editing an earlier user
// message deletes every message that came after it in that conversation
// and a fresh reply is generated from the edited point — the standard
// ChatGPT/Claude "edit" behavior, chosen explicitly over a soft-branch
// alternative that would have kept every superseded reply and needed a
// branch-switcher UI. That means genuinely reversing this table's own
// "immutable, append-only" design (see 1761500000000_ai-conversations-
// and-projects.js's own comment) — a deliberate earlier choice, not an
// oversight, so this migration only grants exactly what the new feature
// needs and nothing more:
//   - UPDATE is granted on the `content` column ONLY (column-level
//     GRANT), never the whole row — role/tool_used/tool_params/
//     presentation/raw_data/attachments/parent_message_id stay
//     unchangeable even after this migration. Enforced at the database
//     level, not just by conversationService.editMessage only ever
//     writing `content` — a defense-in-depth match for the column-
//     scoped allowlist pattern this codebase already uses elsewhere
//     (e.g. aiToolRegistry.js's AI_ALLOWED_PREFERENCE_KEYS).
//   - DELETE has no column-level equivalent (a DELETE removes whole
//     rows), so it's granted normally; conversationService.editMessage
//     is the only caller, always scoped to one conversation_id and
//     `created_at > $editedMessage.created_at`, never an unscoped
//     delete.
//
// Postgres's own trigger AFTER INSERT (messages_touch_conversation)
// already increments message_count and sets last_message_preview from
// the newest row; that migration's own comment flagged exactly this
// gap: "if a future feature ever allows deleting... an individual
// message, this invariant breaks and message_count would need an AFTER
// DELETE counterpart." This is that counterpart — decrements
// message_count per deleted row and recomputes last_message_preview
// from whatever the new latest remaining message is (NULL if none is
// left, i.e. the edited message itself was the conversation's only
// message).
const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`GRANT UPDATE (content) ON messages TO ${APP_ROLE}`);
  pgm.sql(`GRANT DELETE ON messages TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE FUNCTION untouch_conversation_on_message_delete() RETURNS trigger AS $$
    BEGIN
      UPDATE conversations
         SET updated_at = now(),
             message_count = GREATEST(message_count - 1, 0),
             last_message_preview = (
               SELECT left(content, 140) FROM messages
                WHERE conversation_id = OLD.conversation_id
                ORDER BY created_at DESC
                LIMIT 1
             )
       WHERE id = OLD.conversation_id;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql
  `);
  pgm.sql(`
    CREATE TRIGGER messages_untouch_conversation
      AFTER DELETE ON messages
      FOR EACH ROW EXECUTE FUNCTION untouch_conversation_on_message_delete()
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS messages_untouch_conversation ON messages');
  pgm.sql('DROP FUNCTION IF EXISTS untouch_conversation_on_message_delete()');
  pgm.sql(`REVOKE DELETE ON messages FROM ${APP_ROLE}`);
  pgm.sql(`REVOKE UPDATE (content) ON messages FROM ${APP_ROLE}`);
};
