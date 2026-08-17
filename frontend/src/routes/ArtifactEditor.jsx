import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChatMessage } from '../components/ChatMessage';
import { ArtifactRevisionComposer } from '../components/ArtifactRevisionComposer';
import { ChatHeader } from '../components/ChatHeader';
import { ChatWorkspace, ChatTranscriptScrollArea, ChatComposerDock } from '../components/ChatWorkspace';
import { ArtifactContextPanel, ArtifactContextDrawer } from '../components/ArtifactContextPanel';
import { SourcesWidget } from '../components/SourcesPopover';
import { useTranscriptScroll } from '../hooks/useTranscriptScroll';
import { useWorkspace } from '../store/WorkspaceProvider';
import { composerScope, useComposer } from '../store/ComposerProvider';
import { ARTIFACT_CONTEXT, DOC_PARAGRAPHS } from '../lib/mockData';

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
  const { artifacts, threads, artConv, sendMessage, renameArtifact, deleteChat, editMessage, sidebarMode } = useWorkspace();
  const [contextOpen, setContextOpen] = useState(false);
  const [panelHidden, setPanelHidden] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [sourcesHidden, setSourcesHidden] = useState(false);

  const artifact = artifacts.find((a) => a.id === artifactId);
  const convId = artConv[artifactId] || null;
  const messages = (convId && threads[convId]) || [];
  const { ref, onScroll, showJump, jumpToLatest } = useTranscriptScroll(messages);

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
   * Artifacts open on **Act**: the work here is producing and changing a
   * document, not asking about one. That is a property of these two scopes
   * alone — Home, chats and projects keep opening on Ask, and neither can see
   * the other's mode.
   */
  const composer = useComposer(
    convId ? composerScope.artifactRevision(artifactId) : composerScope.artifactCreate(artifactId),
    { canRestore: Boolean(artifact), defaultMode: 'act' }
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
              {DOC_PARAGRAPHS.map((p) => (
                <p key={p.slice(0, 24)} className="m-0 mb-[11px] text-[13.5px] leading-[1.72] text-ink-soft">
                  {p}
                </p>
              ))}
              <p className="mt-[22px] mb-0 text-[13px] text-ink-muted">
                Priya Ramesh
                <br />
                Academic Coordinator
              </p>
            </div>

            {convId && messages.length > 0 && (
              <div className="pt-[16px] border-t border-line-light flex flex-col gap-[18px]">
                {messages.map((m) => (
                  <ChatMessage
                    key={m.id}
                    message={m}
                    selected={selectedResponse?.id === m.id}
                    onSelect={setSelectedId}
                    onEdit={convId ? (id, text) => editMessage(convId, id, text) : undefined}
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
              onSend={() => {
                const id = sendMessage({ scope: 'artifact', convId, artifactId, text: composer.text, attachments: composer.attachments });
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
