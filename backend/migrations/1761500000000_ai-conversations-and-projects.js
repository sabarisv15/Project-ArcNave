'use strict';

// ADL-032 — AI Conversations/Projects move from client-side-only
// localStorage (frontend/src/components/ai/lib/conversationStorage.js
// — its own comment said "no backend concept exists") to real,
// tenant-scoped, self-owned persistence. Same RLS/grant pattern as
// 1761400000000_staff-profile-specialization-and-work-history.js:
// RLS is tenant-only (college_id), per-user ownership is enforced in
// the service layer, not RLS — same split personal_notes' own
// migration already documents.
//
// messages is immutable, append-only — no update/remove function
// exists in messageRepository.js, and the GRANT below omits UPDATE/
// DELETE at the DB level too, same as timetable_revisions. A
// conversation delete still cascades its messages via the FK's own
// ON DELETE CASCADE action, which doesn't need a separate DELETE
// grant on messages for that to work.
//
// Regenerate is relational, not a JSONB re-issue blob: an assistant
// message's parent_message_id points at the user message it answers;
// a tool-invoking user message carries its own tool_used/tool_params
// alongside its content. Regenerating a turn means re-reading the
// parent user message's own columns and posting a new assistant
// message with the same parent_message_id — no separate payload shape
// to construct or parse.
//
// pendingConfirmation (the AI's live L3 propose/confirm prompt) is
// deliberately NOT a column here — transient per-turn frontend state,
// same category as WorkspaceContext.jsx's already-ephemeral
// askResult, never persisted.
//
// conversations.message_count/last_message_preview are trigger-
// maintained (messages_touch_conversation below), never written by
// application code directly — safe to keep as a persisted counter
// only because messages is append-only and a conversation's messages
// only ever disappear as a whole via ON DELETE CASCADE; if a future
// feature ever allows deleting/editing an individual message, this
// invariant breaks and message_count would need an AFTER DELETE
// counterpart or to become a derived COUNT(*).

const APP_ROLE = 'arcnave_app';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE projects (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id    TEXT NOT NULL REFERENCES colleges(college_id),
        user_id       UUID NOT NULL REFERENCES users(id),
        name          TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql('CREATE INDEX projects_user_id_idx ON projects (user_id)');
  pgm.sql('ALTER TABLE projects ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE projects FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON projects
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE TABLE conversations (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id             TEXT NOT NULL REFERENCES colleges(college_id),
        user_id                UUID NOT NULL REFERENCES users(id),
        project_id             UUID REFERENCES projects(id) ON DELETE SET NULL,
        title                  TEXT NOT NULL DEFAULT 'New chat',
        message_count          INTEGER NOT NULL DEFAULT 0,
        last_message_preview   TEXT,
        pinned                 BOOLEAN NOT NULL DEFAULT false,
        archived               BOOLEAN NOT NULL DEFAULT false,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql('CREATE INDEX conversations_user_id_idx ON conversations (user_id)');
  pgm.sql('CREATE INDEX conversations_project_id_idx ON conversations (project_id)');
  pgm.sql('ALTER TABLE conversations ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE conversations FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON conversations
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON conversations TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE TABLE messages (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        college_id        TEXT NOT NULL REFERENCES colleges(college_id),
        conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
        role              TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content           TEXT NOT NULL,
        tool_used         TEXT,
        tool_params       JSONB,
        presentation      JSONB,
        raw_data          JSONB,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  pgm.sql('CREATE INDEX messages_conversation_id_idx ON messages (conversation_id, created_at)');
  pgm.sql('CREATE INDEX messages_parent_message_id_idx ON messages (parent_message_id)');
  pgm.sql('ALTER TABLE messages ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE messages FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY tenant_isolation ON messages
        USING (college_id = current_setting('app.current_tenant', true))
  `);
  pgm.sql(`GRANT SELECT, INSERT ON messages TO ${APP_ROLE}`);

  pgm.sql(`
    CREATE FUNCTION touch_conversation_on_message() RETURNS trigger AS $$
    BEGIN
      UPDATE conversations
         SET updated_at = now(),
             message_count = message_count + 1,
             last_message_preview = left(NEW.content, 140)
       WHERE id = NEW.conversation_id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  pgm.sql(`
    CREATE TRIGGER messages_touch_conversation
      AFTER INSERT ON messages
      FOR EACH ROW EXECUTE FUNCTION touch_conversation_on_message()
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS messages_touch_conversation ON messages');
  pgm.sql('DROP FUNCTION IF EXISTS touch_conversation_on_message()');
  pgm.sql('DROP TABLE IF EXISTS messages');
  pgm.sql('DROP TABLE IF EXISTS conversations');
  pgm.sql('DROP TABLE IF EXISTS projects');
};
