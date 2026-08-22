import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fetchContextFiles,
  queryKeys,
} from '../lib/mockApi';
import { fetchChatsReal, fetchProjectsReal, fetchArtifactsReal } from '../lib/realWorkspaceApi';
import { conversationsApi } from '@/api/conversations';
import { aiApi } from '@/api/ai';
import { projectsApi } from '@/api/projects';
import { artifactsApi } from '@/api/artifacts';
import { useAuth } from '@/hooks/useAuth';
import { CHAT_FILES } from '../lib/mockData';
import { formatBytes } from '../lib/composerAttachments';
import { titleFromPrompt } from '../lib/utils';
import { stepStatusLabel } from '../lib/aiStepStatus';

/** "PNG image", "JPEG image" — the label a file row shows beside its size. */
function imageKind(type) {
  const sub = (type || '').split('/')[1];
  return sub ? `${sub.toUpperCase()} image` : 'Image';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A real server-issued messages.id (Postgres gen_random_uuid()) vs. the client-generated 'u'+Date.now() placeholder. */
function isUuidLike(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

// Conversation-history persistence must not be silently best-effort: a
// dropped save here doesn't just lose a display row, it erases that turn
// from every future prompt's historyHint (aiService.js), so a later
// follow-up question has nothing real to ground itself in and the model
// fabricates instead. Retries a transient failure (network blip, DB
// hiccup) a few times before giving up; only surfaces a toast on the
// final failure so an ordinary single retry-succeeds case stays silent,
// matching this function's callers' existing "don't block the real
// answer" behavior — this only adds resilience, never blocks on it.
// Returns the saved row (real server id and all) on success, null on
// final failure — callers that need the real id (editMessage's rewind,
// which PATCHes /conversations/:id/messages/:realId) can't work off the
// client-generated 'u'+Date.now() placeholder the optimistic bubble uses.
async function saveMessageWithRetry(conversationId, payload, { attempts = 3, turnLabel } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await conversationsApi.addMessage(conversationId, payload);
    } catch {
      if (attempt < attempts) {
        await delay(attempt * 800);
      }
    }
  }
  toast(
    `Couldn't save ${turnLabel} to this conversation's history — later follow-up questions in this chat may lose that context. Try resending if this matters.`
  );
  return null;
}

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const qc = useQueryClient();
  // WorkspaceProvider sits above the router (main.jsx), so it mounts —
  // and these queries would otherwise fire — before a real access token
  // exists: either still on the login page, or on reload before
  // AuthBootstrap's restoreSession() lands (the in-memory access token,
  // authStorage.js's own comment, starts every reload as null).
  // `sessionReady` alone doesn't gate this: it flips true once the boot
  // sequence finishes trying, including the "no refresh token, nothing to
  // restore" case where the user is still unauthenticated on /login — so
  // gating on it alone still fired these queries pre-login and left them
  // permanently 401'd (queries don't auto-refire just because a sibling
  // provider's state changes later). `isAuthenticated` is the flag that
  // actually flips true at the moment a real token exists (via
  // restoreSession() or login()), which is what these need to wait for.
  const { isAuthenticated } = useAuth();

  // Real backend data — no more mockApi fetchers for these three lists.
  const { data: chats = [] } = useQuery({
    queryKey: queryKeys.chats, queryFn: fetchChatsReal, enabled: isAuthenticated,
  });
  const { data: projects = [] } = useQuery({
    queryKey: queryKeys.projects, queryFn: fetchProjectsReal, enabled: isAuthenticated,
  });
  const { data: artifacts = [] } = useQuery({
    queryKey: queryKeys.artifacts, queryFn: fetchArtifactsReal, enabled: isAuthenticated,
  });
  const { data: contextFiles = [] } = useQuery({ queryKey: queryKeys.contextFiles, queryFn: fetchContextFiles });
  const { data: threads = {} } = useQuery({ queryKey: queryKeys.threads, queryFn: async () => ({}) });

  // UI state
  /**
   * Which sidebar menu is showing. Deliberately its own state, never inferred
   * from the pathname: switching context swaps the menu only, so whatever
   * workspace is open stays open until the user picks an item themselves.
   */
  const [activeWorkspaceMode, setActiveWorkspaceMode] = useState('home');
  /**
   * `pinned`  — docked; occupies real layout width and never overlaps content.
   * `overlay` — floating above the workspace, temporary.
   * `hidden`  — no width reserved; only the left edge trigger remains.
   */
  const [sidebarMode, setSidebarMode] = useState('pinned');
  /**
   * Which institutional seat the prototype is being viewed as.
   *
   * `teaching_staff` — the original experience, unchanged in every respect.
   * `class_tutor_l4` — the Class Tutor seat: one owned class, its own
   *                    Curriculum menu and landing.
   *
   * This is a **review affordance for a design prototype**, not an
   * authorization mechanism. This app has no auth at all, so nothing here
   * protects anything — it only decides which experience renders. In the real
   * product the active seat is resolved server-side from the signed-in
   * Position Account and a switcher like this one does not exist.
   *
   * Explicit state next to `activeWorkspaceMode`, never derived from the
   * pathname, for the same reason that one isn't: a mode that re-derives
   * itself on every remount fights the user.
   */
  const [activeRole, setActiveRole] = useState('teaching_staff');
  /*
   * There is deliberately no `input`/`mode` here any more. A single global
   * composer slot is what let Home's text turn up in a project's composer;
   * every composer now owns a scoped draft in `ComposerProvider`, and
   * `sendMessage` is handed the text explicitly rather than reaching for a
   * shared one.
   */
  const [recentQuery, setRecentQuery] = useState('');
  const [recentFilter, setRecentFilter] = useState('All conversations');
  const [projectQuery, setProjectQuery] = useState('');
  const [projectSort, setProjectSort] = useState('Last updated');
  const [artifactQuery, setArtifactQuery] = useState('');
  const [artifactFilter, setArtifactFilter] = useState('All artifacts');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [projConv, setProjConv] = useState({}); // projectId -> conversationId
  const [artConv, setArtConv] = useState({}); // artifactId -> conversationId

  // artConv otherwise only ever gains an entry when a revision message is
  // sent live in *this* browser session (the `scope === 'artifact'` branch
  // below) — a real live-caught gap: reopening an artifact that already has
  // a conversation_id from a previous session (or after a reload) found
  // nothing in this map and silently rendered no revision chat at all, even
  // though the backend has one. `artifacts` (fetchArtifactsReal) now carries
  // that same conversation_id straight from artifactRepository's own
  // LIST_COLUMNS — seed it in whenever the list loads/changes, additive only
  // (never overwrites a fresher session-created mapping for the same id).
  useEffect(() => {
    const fromServer = artifacts.filter((a) => a.conversationId);
    if (fromServer.length === 0) return;
    setArtConv((m) => {
      let changed = false;
      const next = { ...m };
      for (const a of fromServer) {
        if (next[a.id] === undefined) {
          next[a.id] = a.conversationId;
          changed = true;
        }
      }
      return changed ? next : m;
    });
  }, [artifacts]);

  // chatId -> file[]. This is message/upload **metadata**, not a surface: the
  // "Files in this chat" widget and its header button are gone (Sources
  // replaced them), but a sent attachment still belongs to its conversation
  // and still travels with the message. Nothing about the upload pipeline
  // changed with that removal.
  //
  // Scoped to that chat alone. Deliberately keyed by chat id
  // and never merged with `contextFiles` (which is project-level): a file
  // shared in one conversation must not surface in another, and a project's
  // context must not surface in a general chat.
  const [chatFiles, setChatFiles] = useState(CHAT_FILES);

  /**
   * Sent attachments become files of the conversation they were sent in. Only
   * `sendMessage` calls this, so the sole way a file joins a chat is by being
   * sent to it — there is no path here that writes into another chat's list.
   */
  const addChatFiles = useCallback((chatId, files) => {
    if (!chatId || !files?.length) return;
    setChatFiles((prev) => ({ ...prev, [chatId]: [...(prev[chatId] ?? []), ...files] }));
  }, []);

  const removeChatFile = useCallback((chatId, fileId) => {
    if (!chatId) return;
    setChatFiles((prev) => ({
      ...prev,
      [chatId]: (prev[chatId] ?? []).filter((f) => f.id !== fileId),
    }));
  }, []);

  const setThreads = useCallback(
    (updater) => qc.setQueryData(queryKeys.threads, (prev = {}) => updater(prev || {})),
    [qc]
  );

  /**
   * Loads a chat's REAL transcript from the backend (conversationsApi.
   * listMessages) — every `chat` this is ever called with (ChatRoute,
   * Recents' hover-prefetch) already came from fetchChatsReal, the real
   * `GET /conversations` list, so it always already exists server-side;
   * there is no legitimate case here where fabricating a reply was ever
   * correct. `threads` (react-query's in-memory cache) is wiped by a
   * full page reload, and until this fix that meant every reload — not
   * just a first visit — refired the OLD prototype seeding below and
   * replaced a real multi-turn conversation with one fake title-based
   * Q&A pair. The `current[chat.id]` guard is kept unchanged: a chat
   * whose thread is already populated (mid-stream from sendMessage, or
   * already fetched this session) is never re-fetched or clobbered.
   */
  const seedThread = useCallback(
    (chat) => {
      const current = qc.getQueryData(queryKeys.threads) || {};
      if (current[chat.id]) return;
      conversationsApi
        .listMessages(chat.id)
        .then((rows) => {
          const list = Array.isArray(rows) ? rows : (rows?.messages ?? []);
          const messages = list.map((m) => (
            m.role === 'user'
              ? {
                id: String(m.id), role: 'user', text: m.content, createdAt: m.created_at,
                // Round-tripped from the same `attachments` JSONB column
                // sendMessage's own addMessage call above just wrote —
                // without this, a reloaded transcript showed the prompt
                // text but silently dropped which file(s) had been sent
                // with it (SentFileChip/the image thumbnail above both
                // need this array, not just the ids).
                attachments: m.attachments || undefined,
              }
              : {
                id: String(m.id), role: 'ai', generating: false, body: m.content, createdAt: m.created_at,
                // raw_data is the same generic JSONB column addMessage's
                // own rawData just wrote a { document } payload into
                // (see runAiTurn above) — round-tripped back out here so
                // a reloaded transcript still shows the download card.
                document: m.raw_data?.document,
              }
          ));
          setThreads((prev) => ({ ...prev, [chat.id]: messages }));
        })
        .catch(() => {
          // Best-effort, same restraint runAiTurn's own addMessage call
          // already applies to a background persistence failure — a
          // chat that fails to load here just stays empty rather than
          // crashing the workspace; ChatView already renders an empty
          // transcript correctly (a real new conversation looks the same).
        });
    },
    [qc, setThreads]
  );

  /**
   * The first valid message creates a REAL conversation (conversationsApi —
   * the backend owns conversation identity, never a client-generated id),
   * adds it to Recents, and moves the composer to the bottom dock.
   *
   * `text` is required and comes from the calling composer's own scope — this
   * function no longer knows about any composer state, which is what keeps one
   * surface's draft from being sent (or cleared) by another.
   *
   * The actual answer comes from the real backend (POST /ai/ask/stream —
   * routes/ai.js), not generateReply()/setTimeout: the LLM's tool-select/
   * plan/confirmation logic all runs for real, streamed token-by-token into
   * the assistant message's `body` as it arrives (ChatMessage.jsx renders
   * the partial body once it's non-empty, see that file's own comment).
   *
   * Async, but only up to the point the conversation exists and the user's
   * own message is recorded — the id resolves as soon as navigation has
   * somewhere real to go, same as the old synchronous mock did. The AI
   * turn itself (runAiTurn below) is deliberately NOT awaited here: it
   * keeps streaming into `threads` (react-query cache, not component
   * state) after this function returns and the caller has already
   * navigated to the chat, exactly like the old setTimeout-based mock
   * kept running after send() returned.
   */
  const runAiTurn = useCallback(
    async (id, {
      scope, projectId, artifactId, body, aiId, attachmentIds, sentAttachments = [], mode,
    }) => {
      const patchAiMessage = (patch) => {
        setThreads((prev) => ({
          ...prev,
          [id]: (prev[id] || []).map((m) => (m.id === aiId ? { ...m, ...patch } : m)),
        }));
      };

      let streamedText = '';
      try {
        const result = await aiApi.askStream(
          {
            question: body,
            conversation_id: id,
            project_id: scope === 'project' ? projectId : undefined,
            attachment_ids: attachmentIds && attachmentIds.length ? attachmentIds : undefined,
            // routes/ai.js already accepts+threads this for both /ai/ask and
            // /ai/ask/stream (resolveAskContext's own comment) — the
            // export_artifact tool (aiToolRegistry.js) needs the artifact's
            // real id and has no other way to learn it; without this, "export
            // this as pdf" inside an artifact's revision chat had no id to
            // call that tool with.
            focusContext: scope === 'artifact' && artifactId ? { entityType: 'artifact', id: artifactId } : undefined,
            // General/Curriculum (ScopeToggle.jsx) — the composer's own mode
            // for THIS message, not a session-wide setting. Missing/anything
            // other than 'general' falls through to aiService.askAgent's
            // unchanged Curriculum path (that function's own comment).
            mode,
          },
          (event) => {
            if (event.type === 'delta') {
              streamedText += event.delta;
              patchAiMessage({ body: streamedText, generating: true });
            } else if (event.type === 'step') {
              // Real-time progress (P1) — a step fires right before its
              // tool actually runs (aiService.js's own onStep), so this
              // replaces the generic "Thinking…" with what ArcNave is
              // really doing right now. Only shown before the first delta
              // arrives — once streamedText is non-empty ChatMessage.jsx
              // already renders the growing answer instead of this status.
              const label = stepStatusLabel(event.step);
              if (label) patchAiMessage({ status: label, stepPhase: event.step.phase });
            }
          }
        );
        if (!result) throw new Error('No result from the AI');

        const finalText = result.answer || streamedText || 'I could not generate an answer for that.';
        /*
         * Sources belong to the *response*: each piece of real evidence
         * (P0.4 — aiService.buildEvidence) the backend actually queried
         * to produce this answer, plus (P1) the real files this specific
         * turn actually put in front of the model — the attachment(s) sent
         * with this question, and the document a generate_document/
         * export_artifact tool call just produced. `kind: 'uploaded'` +
         * `documentId` is what SourcesPopover.jsx's SourceRow needs to
         * offer a real download, the same documents.id
         * ChatMessage.jsx's own SentFileChip already downloads through.
         */
        const evidenceSources = (result.evidence || []).map((e) => ({
          id: `src-${e.toolName}-${e.retrievedAt}`,
          title: e.toolName,
          kind: 'tool',
          origin:
            e.recordCount !== undefined
              ? `${e.recordCount} record(s) · retrieved ${e.retrievedAt}`
              : `retrieved ${e.retrievedAt}`,
        }));
        const attachmentSources = sentAttachments.map((a) => ({
          id: `attachment-${a.id}`,
          title: a.name,
          kind: 'uploaded',
          documentId: a.serverId,
          type: a.type,
          origin: 'Attached to this message',
        }));
        const documentSource = result.document
          ? [{
            id: `document-${result.document.id}`,
            title: result.document.fileName || result.document.title,
            kind: 'uploaded',
            documentId: result.document.id,
            type: result.document.mimeType,
            origin: 'Generated by ArcNave',
          }]
          : [];
        const sources = [...evidenceSources, ...attachmentSources, ...documentSource];

        patchAiMessage({
          generating: false,
          body: finalText,
          sources,
          toolUsed: result.toolUsed,
          evidenceTrail: result.evidenceTrail,
          verification: result.verification,
          pendingConfirmation: result.pendingConfirmation,
          // Deterministic signal (aiService.askAgent's own comment on why
          // this is never inferred from the model's text alone) that an
          // attached image was never actually shown to the configured AI
          // model — surfaced regardless of whether the answer text itself
          // mentions it.
          imageAnalysisUnavailable: result.imageAnalysisUnavailable,
          // A real, downloadable document a tool just produced
          // (generate_document/export_artifact — aiService.js's own
          // extractDocumentAttachment) — {id, fileName, mimeType, title}
          // or undefined. ChatMessage.jsx renders this as a download
          // card so the file is reachable from the transcript itself,
          // not only from the Documents module it was also saved into.
          document: result.document || undefined,
          createdAt: new Date().toISOString(),
        });

        saveMessageWithRetry(
          id,
          {
            role: 'assistant',
            content: finalText,
            toolUsed: result.toolUsed,
            presentation: result.presentation,
            // Round-trips through conversation_messages.raw_data (a
            // generic JSONB column already meant for exactly this kind
            // of extra payload) so a reload's seedThread below can
            // rebuild the same download card rather than losing it the
            // moment the in-memory thread is replaced by a fresh fetch.
            rawData: result.document ? { document: result.document } : undefined,
          },
          { turnLabel: 'this reply' }
        );
      } catch {
        patchAiMessage({
          generating: false,
          body: streamedText || 'Sorry, I ran into a problem answering that. Please try again.',
          error: true,
          createdAt: new Date().toISOString(),
        });
      }
    },
    [setThreads]
  );

  const sendMessage = useCallback(
    async ({ scope = 'chat', convId, projectId, artifactId, text, attachments = [], mode }) => {
      const body = (text ?? '').trim();
      if (!/[a-zA-Z0-9]/.test(body)) return null;

      let id = convId;
      if (!id) {
        const project = projects.find((p) => p.id === projectId);
        let conversation;
        try {
          conversation = await conversationsApi.create({
            title: titleFromPrompt(body),
            projectId: scope === 'project' ? projectId : undefined,
          });
        } catch {
          toast('Could not start a new conversation — please try again.');
          return null;
        }
        id = String(conversation.id);
        const record =
          scope === 'project'
            ? { id, title: conversation.title, kind: 'project', project: project?.title ?? '', projectId, meta: 'Just now' }
            : { id, title: conversation.title, kind: 'chat', meta: 'Just now', artifactId };
        qc.setQueryData(queryKeys.chats, (prev = []) => [record, ...prev]);
        if (scope === 'project') setProjConv((m) => ({ ...m, [projectId]: id }));
        if (scope === 'artifact') {
          setArtConv((m) => ({ ...m, [artifactId]: id }));
          // Persists the link server-side (artifactService.updateArtifact's
          // new conversationId param) — setArtConv alone only updates this
          // browser's react-query cache, which a reload wipes. Best-effort:
          // a failure here still leaves the chat fully working for the rest
          // of this session (artConv already has it), it just won't survive
          // a reload, same "best-effort, doesn't block the real work"
          // restraint conversationsApi.addMessage's own calls already use.
          artifactsApi.update(artifactId, { conversationId: id }).catch(() => {});
        }
      }

      // Only attachments that finished uploading are sent. A failed one stays
      // in the composer with its Retry, rather than being quietly dropped into
      // a conversation as a file that does not exist on the server.
      const sent = attachments.filter((a) => a.status === 'ready');
      if (sent.length) {
        addChatFiles(
          id,
          sent.map((a) => ({
            id: a.id,
            name: a.name,
            meta: `${imageKind(a.type)} · ${formatBytes(a.size)}`,
            type: a.type,
            previewUrl: a.previewUrl,
          }))
        );
      }

      const aiId = 'm' + Date.now();
      const localUserId = 'u' + Date.now();
      const sentAt = new Date().toISOString();
      setThreads((prev) => ({
        ...prev,
        [id]: [
          ...(prev[id] || []),
          { id: localUserId, role: 'user', text: body, attachments: sent, createdAt: sentAt },
          // GenerationState (ChatMessage.jsx) renders this as the "still
          // resolving which tool to call" skeleton — its own comment says so
          // — but nothing ever supplied the text, so it always rendered a
          // blank line: the reply looked like it just silently appeared once
          // the stream landed, with nothing shown in between. `status` never
          // changes after this (only `body`/`generating` do, in runAiTurn's
          // own patchAiMessage), which matches GenerationState's own design:
          // it's the one skeleton line shown only until the first real chunk
          // arrives, not a running progress log.
          {
            id: aiId, role: 'ai', generating: true, body: '', status: 'Thinking…', createdAt: sentAt,
          },
        ],
      }));

      // Only the backend-issued serverId is ever sent to the server — the
      // local att-... id (`a.id`) is a React key/removal handle only, never
      // a valid attachment reference on the server (useComposerAttachments'
      // own comment on runUpload). An attachment that finished uploading
      // always has a serverId by the time it reaches 'ready' — filtering
      // again here is just defense against a shape this codebase doesn't
      // currently produce, not a real expected case. Small display objects
      // (not just ids) so a reloaded transcript's seedThread can re-render
      // the same SentFileChip (ChatMessage.jsx) without a second lookup —
      // same {id, serverId, name, type, size} shape that component already
      // expects from the live-send path above.
      const sentAttachments = sent
        .filter((a) => a.serverId)
        .map((a) => ({
          id: a.serverId, serverId: a.serverId, name: a.name, type: a.type, size: a.size,
        }));
      const attachmentIds = sentAttachments.map((a) => a.id);

      // Persisting the user's own turn is a separate, best-effort write —
      // conversationService is a transcript store for display/history, not
      // what the AI itself reads this turn (that's the conversation_id the
      // askStream call below sends; the backend loads history itself). A
      // failed save here must not block the actual answer. On success, the
      // real server-issued id replaces the client-generated localUserId
      // placeholder in local state — editMessage's rewind PATCHes
      // /conversations/:id/messages/:realId, which a 'u'+Date.now() id
      // could never match; without this swap, editing a message sent
      // earlier in the same session (before any reload re-fetches real
      // ids via seedThread) would silently fail.
      saveMessageWithRetry(
        id,
        { role: 'user', content: body, attachments: sentAttachments.length ? sentAttachments : undefined },
        { turnLabel: 'your message' }
      ).then((saved) => {
        if (!saved?.id) return;
        setThreads((prev) => ({
          ...prev,
          [id]: (prev[id] || []).map((m) => (m.id === localUserId ? { ...m, id: String(saved.id) } : m)),
        }));
      });

      // Deliberately not awaited — see this function's own comment above.
      // sentAttachments (not just attachmentIds) rides along so runAiTurn
      // can list the real files this turn attached as Sources — the ids
      // alone have no name/type to show.
      runAiTurn(id, {
        scope, projectId, artifactId, body, aiId, attachmentIds, sentAttachments, mode,
      });

      return id;
    },
    [addChatFiles, projects, qc, setThreads, runAiTurn]
  );

  /**
   * Real rewind (product decision): edit an earlier user message, discard
   * every reply that came after it, and generate a fresh one from the
   * edited text — the standard ChatGPT/Claude "edit" behavior, not just a
   * local text swap. `conversationsApi.editMessage` does the update +
   * truncate atomically server-side (conversationService.editMessage);
   * this only reflects that same truncation locally and starts a new AI
   * turn, reusing runAiTurn exactly the way sendMessage does for a brand
   * new message. An edit that clears the message is refused, since a
   * blank message is a delete wearing an edit's clothes.
   *
   * Options object mirrors sendMessage's own shape (scope/convId/
   * projectId/artifactId/mode) — a route wires this up the same way it
   * already wires onSend, since the AI turn this triggers needs the exact
   * same project/artifact/mode context a brand-new send would.
   */
  const editMessage = useCallback(
    async ({
      scope = 'chat', convId, projectId, artifactId, messageId, text, mode,
    }) => {
      const next = (text ?? '').trim();
      if (!convId || !next) return false;
      // A message sent earlier THIS session keeps its client-generated
      // 'u'+Date.now() placeholder id until saveMessageWithRetry's own
      // success handler swaps in the real one (WorkspaceProvider's own
      // sendMessage) — editing before that swap lands has no real row to
      // PATCH yet, so this refuses rather than sending a request the
      // backend can only 404.
      if (!isUuidLike(messageId)) {
        toast("Still saving your message — try editing again in a moment.");
        return false;
      }

      const thread = (qc.getQueryData(queryKeys.threads) || {})[convId] || [];
      const idx = thread.findIndex((m) => m.id === messageId && m.role === 'user');
      if (idx === -1) return false;
      const sentAttachments = thread[idx].attachments || [];

      try {
        await conversationsApi.editMessage(convId, messageId, next);
      } catch {
        toast('Could not save that edit — please try again.');
        return false;
      }

      const aiId = 'm' + Date.now();
      const editedAt = new Date().toISOString();
      setThreads((prev) => {
        const current = prev[convId] || [];
        const i = current.findIndex((m) => m.id === messageId);
        if (i === -1) return prev;
        const kept = current.slice(0, i + 1);
        kept[i] = { ...kept[i], text: next, editedAt };
        return {
          ...prev,
          [convId]: [
            ...kept,
            {
              id: aiId, role: 'ai', generating: true, body: '', status: 'Thinking…', createdAt: editedAt,
            },
          ],
        };
      });

      const attachmentIds = sentAttachments.map((a) => a.serverId).filter(Boolean);
      // Deliberately not awaited — see sendMessage's own comment on why
      // runAiTurn is fire-and-forget from its caller's point of view.
      runAiTurn(convId, {
        scope, projectId, artifactId, body: next, aiId, attachmentIds, sentAttachments, mode,
      });

      return true;
    },
    [qc, setThreads, runAiTurn]
  );

  const renameChat = useCallback(
    (id, title) => {
      const next = title.trim();
      if (!next) return;
      qc.setQueryData(queryKeys.chats, (prev = []) => prev.map((c) => (c.id === id ? { ...c, title: next } : c)));
      conversationsApi.update(id, { title: next }).catch(() => qc.invalidateQueries({ queryKey: queryKeys.chats }));
    },
    [qc]
  );

  const deleteChat = useCallback(
    (id) => {
      qc.setQueryData(queryKeys.chats, (prev = []) => prev.filter((c) => c.id !== id));
      setThreads((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setProjConv((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== id)));
      setArtConv((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== id)));
      conversationsApi.remove(id).catch(() => qc.invalidateQueries({ queryKey: queryKeys.chats }));
      toast('Chat deleted');
    },
    [qc, setThreads]
  );

  const addChatToProject = useCallback(
    (chatId, projectId) => {
      const project = projects.find((p) => p.id === projectId);
      qc.setQueryData(queryKeys.chats, (prev = []) =>
        prev.map((c) => (c.id === chatId ? { ...c, kind: 'project', project: project?.title ?? '', projectId } : c))
      );
      setProjConv((m) => ({ ...m, [projectId]: chatId }));
      toast(`Added to ${project?.title ?? 'project'}.`);
    },
    [qc, projects]
  );

  const createProject = useCallback(
    async ({ name, goal }) => {
      const row = await projectsApi.create({ name: name.trim() });
      if (goal?.trim()) await projectsApi.updateInstructions(row.id, { instructions: goal.trim() });
      const project = {
        id: String(row.id),
        title: row.name,
        desc: goal?.trim() || 'No description yet.',
        updated: 'Updated just now',
        count: '0 files',
        pinned: false,
      };
      qc.setQueryData(queryKeys.projects, (prev = []) => [project, ...prev]);
      toast('Project created');
      return project;
    },
    [qc]
  );

  const deleteProject = useCallback(
    (id) => {
      qc.setQueryData(queryKeys.projects, (prev = []) => prev.filter((p) => p.id !== id));
      projectsApi.remove(id).catch(() => qc.invalidateQueries({ queryKey: queryKeys.projects }));
      toast('Project deleted');
    },
    [qc]
  );

  const togglePin = useCallback(
    (id) => {
      let nextPinned = false;
      qc.setQueryData(queryKeys.projects, (prev = []) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          nextPinned = !p.pinned;
          return { ...p, pinned: nextPinned };
        })
      );
      projectsApi.setPinned(id, { pinned: nextPinned }).catch(() => qc.invalidateQueries({ queryKey: queryKeys.projects }));
    },
    [qc]
  );

  const createArtifact = useCallback(
    async (type) => {
      const title = 'Untitled ' + type.toLowerCase();
      // artifactService.createArtifact (backend) rejects empty/whitespace-only
      // content outright (ArtifactValidationError) — an artifact always needs
      // *some* body, even a fresh one. A bare heading is the smallest content
      // that satisfies that and still reads correctly as a blank starting point.
      const row = await artifactsApi.create({ title, content: `# ${title}\n\n`, artifactType: type });
      const artifact = {
        id: String(row.id), title: row.title, type, edited: 'Edited just now', link: '', status: row.status,
      };
      qc.setQueryData(queryKeys.artifacts, (prev = []) => [artifact, ...prev]);
      return artifact;
    },
    [qc]
  );

  const renameArtifact = useCallback(
    (id, title) => {
      qc.setQueryData(queryKeys.artifacts, (prev = []) =>
        prev.map((a) => (a.id === id ? { ...a, title } : a))
      );
      artifactsApi.update(id, { title }).catch(() => qc.invalidateQueries({ queryKey: queryKeys.artifacts }));
    },
    [qc]
  );

  // The deterministic counterpart to the export_artifact AI tool
  // (aiToolRegistry.js) — same backend call (artifactService.publishArtifact),
  // reached by a header action instead of asking in chat. Both existed only
  // as unused backend/API-layer code until now (artifactsApi.publish was
  // defined but never called from anywhere in this app).
  //
  // `format` is optional (defaults to markdown server-side) — the export
  // format picker in ArtifactEditor's header menu passes one explicitly.
  const publishArtifact = useCallback(
    async (id, format) => {
      let row;
      try {
        row = await artifactsApi.publish(id, format);
      } catch (err) {
        toast(err?.detail || 'Could not export this artifact — please try again.');
        return;
      }
      qc.setQueryData(queryKeys.artifacts, (prev = []) =>
        prev.map((a) => (a.id === id ? { ...a, status: row.status } : a))
      );
      toast('Exported to Documents → AI Artifacts.');
    },
    [qc]
  );

  // The retroactive "give me this AS docx too" action — the deterministic
  // counterpart to the export_artifact_as AI tool. Unlike publishArtifact
  // above, this never touches the artifact's own status (it's not terminal
  // — can be called any number of times, for any number of formats), so
  // there is no query-cache update here beyond the confirmation toast.
  const exportArtifactAs = useCallback(async (id, format) => {
    try {
      await artifactsApi.export(id, format);
    } catch (err) {
      toast(err?.detail || 'Could not export this artifact — please try again.');
      return;
    }
    toast(`Saved as ${format.toUpperCase()} → Documents / AI Artifacts.`);
  }, []);

  const addContextFile = useCallback(
    (file) => qc.setQueryData(queryKeys.contextFiles, (prev = []) => [...prev, file]),
    [qc]
  );
  const removeContextFile = useCallback(
    (id) => qc.setQueryData(queryKeys.contextFiles, (prev = []) => prev.filter((f) => f.id !== id)),
    [qc]
  );

  const value = useMemo(
    () => ({
      chats, projects, artifacts, contextFiles, threads, chatFiles,
      addChatFiles, removeChatFile,
      activeWorkspaceMode, setActiveWorkspaceMode,
      activeRole, setActiveRole,
      sidebarMode, setSidebarMode,
      pinSidebar: () => setSidebarMode('pinned'),
      collapseSidebar: () => setSidebarMode('hidden'),
      revealSidebar: () => setSidebarMode((m) => (m === 'hidden' ? 'overlay' : m)),
      hideOverlay: () => setSidebarMode((m) => (m === 'overlay' ? 'hidden' : m)),
      recentQuery, setRecentQuery, recentFilter, setRecentFilter,
      projectQuery, setProjectQuery, projectSort, setProjectSort,
      artifactQuery, setArtifactQuery, artifactFilter, setArtifactFilter,
      scheduleOpen, setScheduleOpen,
      profileDrawerOpen, setProfileDrawerOpen,
      instructions, setInstructions,
      projConv, artConv,
      sendMessage, seedThread, editMessage,
      renameChat, deleteChat, addChatToProject,
      createProject, deleteProject, togglePin, createArtifact, renameArtifact, publishArtifact, exportArtifactAs,
      addContextFile, removeContextFile,
    }),
    [
      chats, projects, artifacts, contextFiles, threads, chatFiles,
      addChatFiles, removeChatFile,
      activeWorkspaceMode, activeRole, sidebarMode,
      recentQuery, recentFilter, projectQuery, projectSort, artifactQuery, artifactFilter,
      scheduleOpen, profileDrawerOpen, instructions, projConv, artConv,
      sendMessage, seedThread, editMessage, renameChat, deleteChat, addChatToProject,
      createProject, deleteProject, togglePin, createArtifact, renameArtifact, publishArtifact, exportArtifactAs,
      addContextFile, removeContextFile,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
