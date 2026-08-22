import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { FileOutput } from 'lucide-react';
import { ChatMessage } from '../components/ChatMessage';
import { Markdown } from '../components/Markdown';
import { ArtifactRevisionComposer } from '../components/ArtifactRevisionComposer';
import { ChatHeader } from '../components/ChatHeader';
import { ChatWorkspace, ChatTranscriptScrollArea, ChatComposerDock } from '../components/ChatWorkspace';
import { ArtifactContextPanel, ArtifactContextDrawer } from '../components/ArtifactContextPanel';
import { SourcesWidget } from '../components/SourcesPopover';
import { useTranscriptScroll } from '../hooks/useTranscriptScroll';
import { useWorkspace } from '../store/WorkspaceProvider';
import { composerScope, useComposer } from '../store/ComposerProvider';
import { artifactsApi } from '@/api/artifacts';
import { ARTIFACT_CONTEXT } from '../lib/mockData';
import { cn } from '../lib/utils';

// Same class ProjectDetail.jsx's own extraSections items use — ChatHeader.jsx
// doesn't export its MENU_ITEM constant, so each caller keeps its own copy.
const MENU_ITEM =
  'flex items-center gap-[9px] h-[32px] px-[9px] rounded-[9px] font-sans text-[12.5px] text-ink cursor-pointer outline-none data-[highlighted]:bg-tint2 disabled:opacity-40 disabled:cursor-not-allowed';

// markdownFormatConverter.js's own FORMATS vocabulary (backend), mirrored
// here as display labels — six values, one shared enum end to end.
const EXPORT_FORMATS = [
  { value: 'markdown', label: 'Markdown (.md)' },
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'pdf', label: 'PDF' },
  { value: 'pptx', label: 'PowerPoint (.pptx)' },
  { value: 'txt', label: 'Text (.txt)' },
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
];

/** Must stay in step with `ArtifactContextPanel`'s own classes. */
const hasColumn = (pinned) =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.(pinned ? '(min-width: 1024px)' : '(min-width: 1360px)').matches;

/**
 * Artifact chat, through the shared ChatWorkspace shell — the document canvas is
 * just the first inline item in the same transcript column, not a split view.
 *
 * ## Layout
 * Three things and no more: a compact header, the canvas and its revision
 * transcript as the dominant centre, and the docked composer. The right-hand
 * surface is **Artifact context** — what the artifact was built from — and it
 * exists only when the artifact actually has recorded inputs, so the page never
 * carries an empty panel. There is no separate "revise" control: the composer
 * under the canvas is the revision affordance, and a button that only prefilled
 * it was a second name for the same thing.
 */
export function ArtifactEditor() {
  const { artifactId } = useParams();
  const {
    artifacts, threads, artConv, sendMessage, seedThread, renameArtifact, publishArtifact, exportArtifactAs,
    deleteChat, editMessage, sidebarMode,
  } = useWorkspace();
  const [contextOpen, setContextOpen] = useState(false);
  const [panelHidden, setPanelHidden] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [sourcesHidden, setSourcesHidden] = useState(false);
  const [exporting, setExporting] = useState(false);
  // The real document body — `artifacts` (fetchArtifactsReal/WorkspaceProvider)
  // deliberately omits `content` for the list view (artifactRepository.js's
  // own LIST_COLUMNS comment: no reason to pull every artifact's full text
  // back for a listing), so opening one specific artifact needs its own
  // fetch, same as seedThread does for messages below. null = not loaded yet
  // (never rendered as if it were a real empty document).
  const [docContent, setDocContent] = useState(null);

  const artifact = artifacts.find((a) => a.id === artifactId);
  const convId = artConv[artifactId] || null;

  // Mirrors ChatRoute's own `if (chat) seedThread(chat)` — without this, a
  // revision chat with a real conversation_id (from artConv's own
  // server-hydration, WorkspaceProvider.jsx) still never loaded its actual
  // messages: `threads` only ever gains an entry through seedThread or a
  // live sendMessage in the current session. seedThread only ever reads
  // `.id` off what it's given (its own comment), so a plain `{ id: convId }`
  // is enough — no need for a matching row in the unrelated `chats` list.
  useEffect(() => {
    if (convId) seedThread({ id: convId });
  }, [convId, seedThread]);

  const messages = (convId && threads[convId]) || [];
  const { ref, onScroll, showJump, jumpToLatest } = useTranscriptScroll(messages);

  useEffect(() => {
    setDocContent(null);
    if (!artifactId) return;
    artifactsApi.get(artifactId).then((row) => setDocContent(row.content)).catch(() => {});
  }, [artifactId]);

  // Refetches the canvas once a turn that may have called
  // update_artifact_content (aiToolRegistry.js) actually finishes —
  // `result.toolUsed` isn't threaded into ChatMessage today, so this
  // re-fetches on every settled AI reply rather than trying to special-case
  // which tool ran; one extra GET on a reply that didn't touch content is
  // cheap, and it stays correct if a future tool also writes content.
  const lastSettledAiId = useRef(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'ai' || last.generating) return;
    if (lastSettledAiId.current === last.id) return;
    lastSettledAiId.current = last.id;
    artifactsApi.get(artifactId).then((row) => setDocContent(row.content)).catch(() => {});
  }, [messages, artifactId]);

  const context = ARTIFACT_CONTEXT[artifactId] ?? [];

  /* Artifact context (what the artifact was built from) and Sources (what one
     revision reply drew on) are two different claims, so they stay two
     different controls: the context panel is unchanged, and Sources behaves
     exactly as it does in every other chat — scoped to the selected assistant
     reply (the latest citing one by default), a popup on the header trigger in
     normal view, and the pinned card in full screen. */
  const cited = messages.filter((m) => m.role === 'ai' && !m.generating && m.sources?.length);
  const selectedResponse = cited.find((m) => m.id === selectedId) ?? cited[cited.length - 1];
  const sources = selectedResponse?.sources ?? [];

  /* Full screen is the sidebar being gone: the rail's width is what the column
     needs, so it pins there and returns to contextual behaviour on exit. */
  const pinned = sidebarMode === 'hidden';
  useEffect(() => {
    if (pinned) setPanelHidden(false);
  }, [pinned]);

  /* Same rule for Sources: entering full screen clears a dismissal, so it
     never pins to an empty right edge. */
  useEffect(() => {
    if (pinned) setSourcesHidden(false);
  }, [pinned]);

  /**
   * Creating the artifact's first message and revising it afterwards are two
   * different drafts of two different things, so they get two different scopes
   * — and both are per-artifact, so artifact A's draft never reaches artifact
   * B. `canRestore` waits for the artifact to resolve.
   *
   * Artifacts open on **Curriculum**: the work here is producing and changing
   * an institutional document via the real ARCNAVE tools (export_artifact,
   * update_artifact_content), which Research mode never offers the model at
   * all. That is a property of these two scopes alone — Home, chats and
   * projects keep opening on Research (wire value still 'general'), and
   * neither can see the other's mode.
   */
  const composer = useComposer(
    convId ? composerScope.artifactRevision(artifactId) : composerScope.artifactCreate(artifactId),
    { canRestore: Boolean(artifact), defaultMode: 'curriculum' }
  );

  if (!artifact) return null;

  return (
    <ChatWorkspace>
      <ChatHeader
        chatId={convId}
        contextPrefix="Artifacts"
        title={convId ? `${artifact.title} / Revision chat` : artifact.title}
        onRename={(next) => renameArtifact(artifact.id, next)}
        onDelete={convId && (() => deleteChat(convId))}
        deleteLabel="Delete revision chat"
        extraSections={[
          // Draft: picking a format publishes it (terminal, one-shot —
          // artifactService.publishArtifact). Already published: the same
          // control becomes "Download as ▾", offering every OTHER format
          // via the separate, repeatable exportArtifactAs action, which
          // never touches the artifact's own status — same submenu shape
          // as ChatHeaderMenu's own "Add to project" above.
          <DropdownMenu.Sub key="export">
            <DropdownMenu.SubTrigger
              disabled={exporting}
              className={cn(MENU_ITEM, 'justify-between data-[state=open]:bg-tint2')}
            >
              <span className="flex items-center gap-[9px]">
                <FileOutput size={14} strokeWidth={1.9} />
                {artifact.status === 'published' ? 'Download as' : 'Export to Documents'}
              </span>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                sideOffset={4}
                alignOffset={-4}
                className="z-[60] w-[180px] p-[5px] bg-raised border border-line-strong rounded-[14px] shadow-pop data-[state=open]:animate-fadeUp motion-reduce:animate-none"
              >
                {EXPORT_FORMATS.map((f) => (
                  <DropdownMenu.Item
                    key={f.value}
                    disabled={exporting}
                    onSelect={async () => {
                      setExporting(true);
                      if (artifact.status === 'published') await exportArtifactAs(artifact.id, f.value);
                      else await publishArtifact(artifact.id, f.value);
                      setExporting(false);
                    }}
                    className={MENU_ITEM}
                  >
                    {f.label}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>,
        ]}
        sources={sources}
        sourcesPinned={pinned}
        sourcesPinnedShown={!sourcesHidden}
        onToggleSources={() => setSourcesHidden((v) => !v)}
        sourceCount={context.length}
        sourcesLabel="Artifact context"
        onOpenSources={() => {
          if (hasColumn(pinned)) setPanelHidden(false);
          else setContextOpen(true);
        }}
      />

      <div className="relative flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <ChatTranscriptScrollArea scrollRef={ref} onScroll={onScroll}>
            <div className="bg-paper border border-line rounded-[12px] pt-[34px] px-[40px] pb-[34px] shadow-docsheet">
              <p className="m-0 mb-[6px] text-[11.5px] tracking-[.08em] uppercase text-ink-faint">
                {artifact.type.toUpperCase()}
              </p>
              <h2 className="m-0 mb-[14px] text-[19px] font-[600]">{artifact.title}</h2>
              {docContent === null ? (
                <p className="m-0 text-[13.5px] text-ink-faint animate-pulseSoft">Loading…</p>
              ) : (
                <Markdown>{docContent}</Markdown>
              )}
            </div>

            {convId && messages.length > 0 && (
              <div className="pt-[16px] border-t border-line-light flex flex-col gap-[18px]">
                {messages.map((m) => (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    selected={selectedResponse?.id === m.id}
                    onSelect={setSelectedId}
                    onEdit={
                      convId
                        ? (id, text) => editMessage({
                          scope: 'artifact', convId, artifactId, messageId: id, text, mode: composer.mode,
                        })
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </ChatTranscriptScrollArea>

          <ChatComposerDock showJump={showJump} onJumpToLatest={jumpToLatest}>
            <ArtifactRevisionComposer
              revising={!!convId}
              artifactType={artifact.type}
              composer={composer}
              onSend={async () => {
                const id = await sendMessage({ scope: 'artifact', convId, artifactId, text: composer.text, attachments: composer.attachments, mode: composer.mode });
                if (id) composer.reset(); // clears this artifact's scope only
              }}
            />
          </ChatComposerDock>
        </div>

        {!panelHidden && (
          <ArtifactContextPanel items={context} pinned={pinned} onClose={() => setPanelHidden(true)} />
        )}

        {/* Clear of the context column when that column is docked, rather than
            floating on top of it. */}
        {pinned && !sourcesHidden && (
          <SourcesWidget
            sources={sources}
            onClose={() => setSourcesHidden(true)}
            rightClass={panelHidden ? 'right-[16px]' : 'right-[296px]'}
          />
        )}
      </div>

      <ArtifactContextDrawer items={context} open={contextOpen} onOpenChange={setContextOpen} />
    </ChatWorkspace>
  );
}
