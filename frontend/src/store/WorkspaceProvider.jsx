import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fetchContextFiles,
  generateReply,
  queryKeys,
  GENERATION_DELAY,
} from '../lib/mockApi';
import { fetchChatsReal, fetchProjectsReal, fetchArtifactsReal } from '../lib/realWorkspaceApi';
import { conversationsApi } from '@/api/conversations';
import { projectsApi } from '@/api/projects';
import { artifactsApi } from '@/api/artifacts';
import { CHAT_FILES } from '../lib/mockData';
import { formatBytes } from '../lib/composerAttachments';
import { titleFromPrompt } from '../lib/utils';
import { metaToTimestamp } from '../lib/messageTime';

/** "PNG image", "JPEG image" — the label a file row shows beside its size. */
function imageKind(type) {
  const sub = (type || '').split('/')[1];
  return sub ? `${sub.toUpperCase()} image` : 'Image';
}

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const qc = useQueryClient();

  // Real backend data — no more mockApi fetchers for these three lists.
  const { data: chats = [] } = useQuery({ queryKey: queryKeys.chats, queryFn: fetchChatsReal });
  const { data: projects = [] } = useQuery({ queryKey: queryKeys.projects, queryFn: fetchProjectsReal });
  const { data: artifacts = [] } = useQuery({ queryKey: queryKeys.artifacts, queryFn: fetchArtifactsReal });
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

  const seedThread = useCallback(
    (chat) => {
      const current = qc.getQueryData(queryKeys.threads) || {};
      if (current[chat.id]) return;
      const reply = generateReply(chat.title, chat.kind);
      /*
       * A seeded conversation was never actually sent, so it has no clock of
       * its own — but the Recents row it came from already carries a human
       * age ("2 hours ago", "Last week"), and that is the honest instant to
       * date its messages from. Without this every seeded message would read
       * "Just now" the moment the thread is opened, which is the one thing a
       * timestamp must never be wrong about. The reply lands a few seconds
       * after the question, as it would have.
       */
      const askedAt = metaToTimestamp(chat.meta);
      const repliedAt = new Date(new Date(askedAt).getTime() + 4000).toISOString();
      setThreads((prev) => ({
        ...prev,
        [chat.id]: [
          { id: chat.id + 'u', role: 'user', text: chat.title, createdAt: askedAt },
          {
            id: chat.id + 'a',
            role: 'ai',
            generating: false,
            body: reply.body,
            closing: reply.closing,
            sources: reply.sources ?? [],
            createdAt: repliedAt,
          },
        ],
      }));
    },
    [qc, setThreads]
  );

  /**
   * The first valid message creates the conversation, adds it to Recents and
   * moves the composer to the bottom dock.
   *
   * `text` is required and comes from the calling composer's own scope — this
   * function no longer knows about any composer state, which is what keeps one
   * surface's draft from being sent (or cleared) by another.
   */
  const sendMessage = useCallback(
    ({ scope = 'chat', convId, projectId, artifactId, text, attachments = [] }) => {
      const body = (text ?? '').trim();
      if (!/[a-zA-Z0-9]/.test(body)) return null;

      let id = convId;
      if (!id) {
        id = 'k' + Date.now();
        const project = projects.find((p) => p.id === projectId);
        const record =
          scope === 'project'
            ? { id, title: titleFromPrompt(body), kind: 'project', project: project?.title ?? '', projectId, meta: 'Just now' }
            : { id, title: titleFromPrompt(body), kind: 'chat', meta: 'Just now', artifactId };
        qc.setQueryData(queryKeys.chats, (prev = []) => [record, ...prev]);
        if (scope === 'project') setProjConv((m) => ({ ...m, [projectId]: id }));
        if (scope === 'artifact') setArtConv((m) => ({ ...m, [artifactId]: id }));
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

      const reply = generateReply(body, scope);
      /*
       * Sources belong to the *response*, not to the conversation, and an
       * uploaded file is a source only when the reply actually used it —
       * `generateReply` decides that from the question. Attaching six
       * screenshots and asking something unrelated must not produce six
       * sources, which is exactly what the old "Files in this chat" list did.
       */
      const sources = [
        ...(reply.usesAttachments
          ? sent.map((a) => ({
              id: `src-${a.id}`,
              title: a.name,
              kind: 'uploaded',
              type: a.type, // drives the file-type glyph in the Sources panel
              origin: 'Attached to this chat',
              previewUrl: a.previewUrl,
            }))
          : []),
        ...(reply.sources ?? []),
      ];
      const aiId = 'm' + Date.now();
      const sentAt = new Date().toISOString();
      setThreads((prev) => ({
        ...prev,
        [id]: [
          ...(prev[id] || []),
          { id: 'u' + Date.now(), role: 'user', text: body, attachments: sent, createdAt: sentAt },
          { id: aiId, role: 'ai', generating: true, status: reply.status, createdAt: sentAt },
        ],
      }));

      setTimeout(() => {
        setThreads((prev) => ({
          ...prev,
          [id]: (prev[id] || []).map((m) =>
            m.id === aiId
              ? {
                  id: aiId,
                  role: 'ai',
                  generating: false,
                  body: reply.body,
                  closing: reply.closing,
                  sources,
                  // The reply is dated when it landed, not when it was asked
                  // for — that is the time the reader is looking at.
                  createdAt: new Date().toISOString(),
                }
              : m
          ),
        }));
      }, GENERATION_DELAY);

      return id;
    },
    [addChatFiles, projects, qc, setThreads]
  );

  /**
   * Edit a message already in the transcript, in place.
   *
   * Deliberately narrow: it replaces the text of one message and records when
   * that happened. It does not add a message, remove one, touch the message's
   * attachments, or re-run the reply that followed — this prototype has no
   * server-side history or regeneration rules to honour, and inventing them
   * here would be making up conversation behaviour rather than editing text.
   * An edit that clears the message is refused, since a blank message is a
   * delete wearing an edit's clothes.
   */
  const editMessage = useCallback(
    (convId, messageId, text) => {
      const next = (text ?? '').trim();
      if (!convId || !next) return false;
      setThreads((prev) => ({
        ...prev,
        [convId]: (prev[convId] || []).map((m) =>
          m.id === messageId && m.role === 'user'
            ? { ...m, text: next, editedAt: new Date().toISOString() }
            : m
        ),
      }));
      return true;
    },
    [setThreads]
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
      const row = await artifactsApi.create({ title, content: '' });
      const artifact = { id: String(row.id), title: row.title, type, edited: 'Edited just now', link: '' };
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
      createProject, deleteProject, togglePin, createArtifact, renameArtifact,
      addContextFile, removeContextFile,
    }),
    [
      chats, projects, artifacts, contextFiles, threads, chatFiles,
      addChatFiles, removeChatFile,
      activeWorkspaceMode, activeRole, sidebarMode,
      recentQuery, recentFilter, projectQuery, projectSort, artifactQuery, artifactFilter,
      scheduleOpen, profileDrawerOpen, instructions, projConv, artConv,
      sendMessage, seedThread, editMessage, renameChat, deleteChat, addChatToProject,
      createProject, deleteProject, togglePin, createArtifact, renameArtifact,
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
