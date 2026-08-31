import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatMessage } from './ChatMessage';
import { AIComposer } from './AIComposer';
import { ChatHeader } from './ChatHeader';
import { SourcesWidget } from './SourcesPopover';
import { ChatWorkspace, ChatTranscriptScrollArea, ChatComposerDock } from './ChatWorkspace';
import { useTranscriptScroll } from '../hooks/useTranscriptScroll';
import { useWorkspace } from '../store/WorkspaceProvider';
import { composerScope, useComposer } from '../store/ComposerProvider';

/**
 * Normal chat, through the shared ChatWorkspace shell: inline top bar, transcript
 * as the primary scroll area, one bottom-docked compact composer.
 *
 * `onSend` is handed this chat's own draft text, its own attachments, and its
 * own Research/Curriculum scope mode, and is responsible for clearing them —
 * the composer state belongs to `chat:<chatId>` and to nothing else.
 *
 * ## Sources
 * Scoped to **one assistant response**: the latest by default, or whichever
 * reply the reader selected, with the header's `Sources (N)` trigger and its
 * count following that reply. In normal view it is a compact popup on that
 * trigger; in full screen the same list is pinned beside the transcript as a
 * card and the trigger dismisses and restores it. Never a drawer and never a
 * reserved column, and a chat whose replies cite nothing shows no trigger at
 * all.
 */
export function ChatView({ chatId, title, meta, messages, placeholder, onSend, badge, columnClass = 'max-w-[780px]' }) {
  const navigate = useNavigate();
  const { projects, renameChat, deleteChat, addChatToProject, editMessage, sidebarMode } = useWorkspace();
  const composer = useComposer(composerScope.chat(chatId), { canRestore: Boolean(chatId) });
  const { ref, onScroll, showJump, jumpToLatest } = useTranscriptScroll(messages);
  const [selectedId, setSelectedId] = useState(null);
  const [pinnedHidden, setPinnedHidden] = useState(false);

  /* Full screen is the sidebar being gone: the width the rail was using is
     what the pinned card needs, so Sources pins there and returns to the
     popup on exit. Entering only clears a dismissal, so full screen never
     lands on an empty right edge. */
  const fullScreen = sidebarMode === 'hidden';
  useEffect(() => {
    if (fullScreen) setPinnedHidden(false);
  }, [fullScreen]);

  const cited = messages.filter((m) => m.role === 'ai' && !m.generating && m.sources?.length);
  const selected = cited.find((m) => m.id === selectedId) ?? cited[cited.length - 1];
  const sources = selected?.sources ?? [];

  return (
    <ChatWorkspace>
      {title && (
        <ChatHeader
          chatId={chatId}
          title={title}
          contextPrefix={meta}
          sources={sources}
          sourcesPinned={fullScreen}
          sourcesPinnedShown={!pinnedHidden}
          onToggleSources={() => setPinnedHidden((v) => !v)}
          onRename={chatId && ((next) => renameChat(chatId, next))}
          onAddToProject={
            chatId &&
            ((projectId) => {
              addChatToProject(chatId, projectId);
              navigate(`/projects/${projectId}?c=${chatId}`);
            })
          }
          projects={projects}
          onDelete={
            chatId &&
            (() => {
              deleteChat(chatId);
              navigate('/');
            })
          }
        />
      )}
      {badge}
      <div className="relative flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <ChatTranscriptScrollArea scrollRef={ref} onScroll={onScroll} columnClass={columnClass}>
            {messages.map((m) => (
              <ChatMessage
                key={m.id}
                message={m}
                selected={selected?.id === m.id}
                onSelect={setSelectedId}
                onEdit={
                  chatId
                    ? (id, text) =>
                        editMessage({
                          scope: 'chat',
                          convId: chatId,
                          messageId: id,
                          text,
                          mode: composer.mode,
                          thinkingLevel: composer.thinkingLevel,
                        })
                    : undefined
                }
              />
            ))}
          </ChatTranscriptScrollArea>
          <ChatComposerDock showJump={showJump} onJumpToLatest={jumpToLatest}>
            <AIComposer
              composer={composer}
              variant="chat"
              value={composer.text}
              onChange={composer.setText}
              onSend={() => {
                if (onSend(composer.text, composer.attachments, composer.mode, composer.thinkingLevel) !== false)
                  composer.reset();
              }}
              mode={composer.mode}
              onMode={composer.setMode}
              thinkingLevel={composer.thinkingLevel}
              onThinkingLevel={composer.setThinkingLevel}
              placeholder={placeholder}
            />
          </ChatComposerDock>
        </div>
        {fullScreen && !pinnedHidden && <SourcesWidget sources={sources} onClose={() => setPinnedHidden(true)} />}
      </div>
    </ChatWorkspace>
  );
}
