import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Archive, PanelRight, Pencil, Pin, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AIComposer } from '../components/AIComposer';
import { ChatMessage } from '../components/ChatMessage';
import { ChatHeader } from '../components/ChatHeader';
import { ChatWorkspace, ChatTranscriptScrollArea, ChatComposerDock, CHAT_GUTTER } from '../components/ChatWorkspace';
import { ProjectContextPanel, ProjectContextDrawer } from '../components/ProjectContextPanel';
import { ProjectContextStrip, ProjectContextBadge } from '../components/ProjectContextStrip';
import { DeleteProjectDialog } from '../components/Dialogs';
import { useTranscriptScroll } from '../hooks/useTranscriptScroll';
import { useWorkspace } from '../store/WorkspaceProvider';
import { composerScope, useComposer } from '../store/ComposerProvider';
import { cn } from '../lib/utils';

const MENU_ITEM =
  'flex items-center gap-[9px] h-[32px] px-[9px] rounded-[9px] font-sans text-[12.5px] text-ink cursor-pointer outline-none data-[highlighted]:bg-tint2';

export function ProjectDetail() {
  const { projectId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const { chats, projects, threads, projConv, sendMessage, togglePin, deleteProject, renameChat, deleteChat, editMessage } =
    useWorkspace();

  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const convId = params.get('c') || projConv[projectId] || null;
  const chatRecord = convId ? chats.find((c) => c.id === convId) : null;
  const messages = (convId && threads[convId]) || [];
  const { ref, onScroll, showJump, jumpToLatest } = useTranscriptScroll(messages);

  /* Sources are per assistant response, not per conversation — the latest by
     default, or whichever reply the reader selected. The header's `Sources (N)`
     trigger and its compact popup are the only surface, exactly as in every
     other chat, and they appear only when a reply actually cites something. */
  const cited = messages.filter((m) => m.role === 'ai' && !m.generating && m.sources?.length);
  const selectedResponse = cited.find((m) => m.id === selectedId) ?? cited[cited.length - 1];
  const sources = selectedResponse?.sources ?? [];

  /**
   * Scoped to this project *and* this conversation, so project A's draft can
   * never appear in project B, and a project's first-message draft is distinct
   * from the draft of a conversation already running inside it. `canRestore`
   * waits until the project actually resolved — a stored draft is never
   * replayed into a project the user can't currently see.
   */
  const composer = useComposer(composerScope.project(projectId, convId), { canRestore: Boolean(project) });

  if (!project) return null;

  const send = async () => {
    const id = await sendMessage({ scope: 'project', convId, projectId, text: composer.text, attachments: composer.attachments, mode: composer.mode });
    if (id) composer.reset(); // clears this project conversation's draft only
  };

  return (
    <div className="flex-1 min-h-0 flex animate-viewIn">
      <ChatWorkspace className="min-w-0 animate-none">
        <ChatHeader
          chatId={convId}
          contextPrefix={convId ? project.title : undefined}
          title={convId ? chatRecord?.title ?? project.title : project.title}
          onRename={convId ? (next) => renameChat(convId, next) : undefined}
          onDelete={
            convId &&
            (() => {
              deleteChat(convId);
              navigate(`/projects/${project.id}`);
            })
          }
          deleteLabel="Delete chat"
          showShare={!!convId}
          sources={sources}
          extraSections={[
            <>
              <DropdownMenu.Item
                onSelect={() => togglePin(project.id)}
                className={cn(MENU_ITEM, project.pinned && 'text-accent')}
              >
                <Pin size={14} strokeWidth={1.9} />
                {project.pinned ? 'Unpin project' : 'Pin project'}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => toast('Editing project details is not available in this preview')}
                className={MENU_ITEM}
              >
                <Pencil size={14} strokeWidth={1.9} />
                Edit project details
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => toast('Project archived')} className={MENU_ITEM}>
                <Archive size={14} strokeWidth={1.9} />
                Archive project
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => setContextOpen(true)}
                className={cn(MENU_ITEM, 'md:hidden')}
              >
                <PanelRight size={14} strokeWidth={1.9} />
                Project context
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => setDeleteOpen(true)}
                className="flex items-center gap-[9px] h-[32px] px-[9px] rounded-[9px] font-sans text-[12.5px] text-danger cursor-pointer outline-none data-[highlighted]:bg-danger-soft"
              >
                <Trash2 size={14} strokeWidth={1.9} />
                Delete project
              </DropdownMenu.Item>
            </>,
          ]}
        />

        {!convId ? (
          /*
           * The project's first-message state is a chat that hasn't started
           * yet — not a landing page for the project.
           *
           * So it is anchored near the top of the reading column instead of
           * being centred in the canvas. Centred, the same three elements read
           * as a hero block announcing the project, and the composer lands
           * wherever the viewport height happens to put it. Anchored, the
           * composer sits close to where it will be once the conversation
           * starts, the context above it reads as a label rather than a title,
           * and the space below is simply the transcript nobody has written
           * yet. Same gutter scale, same left alignment, same 780px column as
           * every other chat surface.
           */
          <div className={cn('flex-1 min-h-0 overflow-y-auto scroll-quiet flex flex-col pt-[28px] pb-[34px]', CHAT_GUTTER)}>
            <div className="w-full max-w-[780px] mr-auto">
              {/* Compact context, at interface scale — deliberately smaller
                  than the chat title in the header above it. */}
              <h1 className="m-0 mb-[2px] text-[15px] font-[600] tracking-[-.008em] text-ink">{project.title}</h1>
              <p className="mt-0 mb-[14px] text-[13px] text-ink-muted">{project.desc}</p>
              <AIComposer
                composer={composer}
                value={composer.text}
                onChange={composer.setText}
                onSend={send}
                mode={composer.mode}
                onMode={composer.setMode}
                variant="start"
                placeholder="Ask ArcNave about this project…"
              />
              <ProjectContextStrip projectTitle={project.title} />
            </div>
          </div>
        ) : (
          <>
            <ProjectContextBadge projectTitle={project.title} />
            <ChatTranscriptScrollArea scrollRef={ref} onScroll={onScroll}>
              {messages.map((m) => (
                <ChatMessage
                  key={m.id}
                  message={m}
                  selected={selectedResponse?.id === m.id}
                  onSelect={setSelectedId}
                  onEdit={convId ? (id, text) => editMessage(convId, id, text) : undefined}
                />
              ))}
            </ChatTranscriptScrollArea>
            <ChatComposerDock showJump={showJump} onJumpToLatest={jumpToLatest}>
              <AIComposer
                composer={composer}
                value={composer.text}
                onChange={composer.setText}
                onSend={send}
                mode={composer.mode}
                onMode={composer.setMode}
                variant="chat"
                placeholder="Ask ArcNave about this project…"
              />
            </ChatComposerDock>
          </>
        )}
      </ChatWorkspace>

      <ProjectContextPanel />
      <ProjectContextDrawer open={contextOpen} onOpenChange={setContextOpen} />

      <DeleteProjectDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        projectTitle={project.title}
        onConfirm={() => {
          deleteProject(project.id);
          setDeleteOpen(false);
          navigate('/projects');
        }}
      />
    </div>
  );
}
