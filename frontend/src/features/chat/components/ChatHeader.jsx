import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { BookOpen, ChevronDown, FolderInput, Pencil, Share2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SourcesTrigger } from './SourcesPopover';
import { cn } from '../../../lib/utils';

const ICON_BTN =
  'w-[30px] h-[30px] grid place-items-center border-0 bg-transparent rounded-[9px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-faint';

const MENU_ITEM =
  'flex items-center gap-[9px] h-[32px] px-[9px] rounded-[9px] font-sans text-[12.5px] text-ink cursor-pointer outline-none data-[highlighted]:bg-tint2';

/**
 * The chevron dropdown next to a chat title. Rename/Add-to-project/Delete are the
 * baseline (each hidden if the caller doesn't wire it up); `extraSections` lets a
 * route add its own supplementary actions (e.g. Project-level settings) as a
 * clearly divided second group, without teaching this shared menu route-specific
 * concepts.
 */
export function ChatHeaderMenu({
  onRenameRequested,
  onAddToProject,
  projects,
  onDelete,
  deleteLabel = 'Delete',
  extraSections,
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Chat options"
          aria-expanded={open}
          className={cn(
            'flex-none w-[22px] h-[22px] grid place-items-center border-0 bg-transparent rounded-[6px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent',
            open && 'bg-accent-soft text-accent',
          )}
        >
          <ChevronDown size={15} strokeWidth={2} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-[60] w-[208px] p-[5px] bg-raised border border-line-strong rounded-[14px] shadow-pop data-[state=open]:animate-fadeUp motion-reduce:animate-none"
        >
          {onRenameRequested && (
            <DropdownMenu.Item onSelect={onRenameRequested} className={MENU_ITEM}>
              <Pencil size={14} strokeWidth={1.9} />
              Rename
            </DropdownMenu.Item>
          )}

          {onAddToProject && (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={cn(MENU_ITEM, 'justify-between data-[state=open]:bg-tint2')}>
                <span className="flex items-center gap-[9px]">
                  <FolderInput size={14} strokeWidth={1.9} />
                  Add to project
                </span>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={4}
                  alignOffset={-4}
                  className="z-[60] w-[200px] max-h-[240px] overflow-y-auto p-[5px] bg-raised border border-line-strong rounded-[14px] shadow-pop data-[state=open]:animate-fadeUp motion-reduce:animate-none"
                >
                  {!projects?.length && (
                    <div className="px-[9px] py-[8px] text-[12px] text-ink-faint">No projects yet.</div>
                  )}
                  {projects?.map((p) => (
                    <DropdownMenu.Item
                      key={p.id}
                      onSelect={() => onAddToProject(p.id)}
                      className={cn(MENU_ITEM, 'truncate')}
                    >
                      {p.title}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          )}

          {extraSections?.map((section, i) => (
            <div key={i}>
              <div className="h-px bg-line my-[4px]" />
              {section}
            </div>
          ))}

          {onDelete && (
            <>
              <div className="h-px bg-line my-[4px]" />
              <DropdownMenu.Item
                onSelect={onDelete}
                className="flex items-center gap-[9px] h-[32px] px-[9px] rounded-[9px] font-sans text-[12.5px] text-danger cursor-pointer outline-none data-[highlighted]:bg-danger-soft"
              >
                <Trash2 size={14} strokeWidth={1.9} />
                {deleteLabel}
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Compact icon control for a chat's *own* right-hand surface — currently just
 * the artifact's context panel. Sources no longer uses it: it owns a text
 * trigger and its own popup (`SourcesTrigger`), because a count that changes
 * with the selected reply is worth spelling out.
 *
 * It exists **only** when there is something to show — there is no permanently
 * reserved slot and no empty state.
 */
export function ChatSourcesButton({ count, onOpen, label = 'Sources for this response' }) {
  if (!count) return null;

  return (
    <button
      type="button"
      aria-label={`${label} (${count})`}
      title={label}
      onClick={onOpen}
      className={cn(ICON_BTN, 'relative')}
    >
      <BookOpen size={16} strokeWidth={1.8} />
      <span className="absolute top-[2px] right-[2px] min-w-[13px] h-[13px] px-[3px] grid place-items-center rounded-full bg-accent text-white text-[9px] font-[600] leading-none">
        {count}
      </span>
    </button>
  );
}

/** Compact icon button — the existing/appropriate share action for this chat. */
export function ChatShareButton({ title }) {
  return (
    <button
      type="button"
      aria-label="Share chat"
      title="Share"
      onClick={() => toast(`Share link copied for "${title}".`)}
      className={ICON_BTN}
    >
      <Share2 size={16} strokeWidth={1.8} />
    </button>
  );
}

/**
 * The one ArcNave chat header, used by every chat workspace — normal chat,
 * Project chat, Artifact chat, and anything added later. A quiet inline top
 * bar, never a card: no background tint, no shadow, no full-width divider, no
 * page title, no model picker, no breadcrumb row.
 *
 *   [ contextPrefix / ] Title ⌄                        Sources  Share
 *
 * ## Renaming
 * The title is the rename control, in the two steps a file name has everywhere
 * else: the first click selects it (a quiet highlight — nothing navigates,
 * nothing opens), the second click, or Enter/Space while it has focus, turns it
 * into an input with the current name selected. Enter commits, Escape restores,
 * and blur commits only a changed, non-empty name. The chevron menu keeps
 * Rename as well, for anyone who goes looking for it there.
 *
 * The whole band is 46px — the row itself, plus symmetric 6px padding that
 * seats it on the canvas. On narrow screens it insets from the left so the
 * AppShell's floating navigation button (`lg:hidden`) has room; on desktop
 * that button doesn't exist, so the space is given back to the transcript
 * instead of being reserved unconditionally.
 *
 * `chatId` doubles as the key into per-chat files and (when actions are wired
 * up) the record renameChat/deleteChat act on.
 */
export function ChatHeader({
  contextPrefix,
  title,
  chatId,
  onRename,
  onAddToProject,
  projects,
  onDelete,
  deleteLabel,
  extraSections,
  showShare = true,
  // The selected assistant response's sources. Handed straight to
  // `SourcesTrigger`, which renders nothing when the reply cites nothing.
  sources,
  // Full screen: the list is pinned beside the transcript, and the trigger
  // toggles that card rather than opening a popup.
  sourcesPinned = false,
  sourcesPinnedShown = false,
  onToggleSources,
  sourceCount = 0,
  onOpenSources,
  // Artifact chat reuses the icon control for its own right-hand surface,
  // which is a different thing entirely — the label has to say so.
  sourcesLabel,
}) {
  const [renaming, setRenaming] = useState(false);
  const [selected, setSelected] = useState(false);
  const [status, setStatus] = useState(''); // '' | 'Saving…' | 'Saved'
  const [draft, setDraft] = useState(title);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!renaming) setDraft(title);
  }, [title, renaming]);

  useEffect(() => {
    if (!renaming) return;
    const el = inputRef.current;
    el?.focus();
    el?.select(); // the current name is pre-filled *and* selected
  }, [renaming]);

  // Changing chats drops any half-finished rename state with it. Keyed on the
  // chat, never on the title — a rename changes the title, and clearing the
  // status here would wipe the confirmation it just produced.
  useEffect(() => {
    setSelected(false);
    setRenaming(false);
    setStatus('');
  }, [chatId]);

  const commitRename = () => {
    const next = draft.trim();
    setRenaming(false);
    setSelected(false);
    if (!next || next === title) return; // blur with nothing changed is not a save
    setStatus('Saving…');
    onRename?.(next);
    // Quiet confirmation, then out of the way. The rename itself is optimistic;
    // this only reports it, and a real async failure would replace it.
    setTimeout(() => setStatus('Saved'), 120);
    setTimeout(() => setStatus(''), 1600);
  };

  const activateTitle = () => {
    if (!onRename) return;
    if (selected) setRenaming(true);
    else setSelected(true);
  };

  const hasMenu = !!(onRename || onAddToProject || onDelete || extraSections?.length);

  return (
    <header className="shrink-0 py-[6px] pr-[18px] pl-[56px] lg:pl-[18px]">
      <div className="h-[34px] flex items-center gap-[8px]">
        <div className="flex-1 min-w-0 flex items-center gap-[4px]">
          {renaming ? (
            <input
              ref={inputRef}
              aria-label="Chat title"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setDraft(title);
                  setRenaming(false);
                  setSelected(false);
                }
              }}
              // Same box as the static title: same size, same weight, same
              // height, so committing or cancelling never shifts the header.
              className="min-w-0 flex-1 h-[24px] border-0 outline-none focus-visible:outline-none rounded-[6px] px-[4px] -mx-[4px] bg-tint2 font-chat text-[14.5px] font-[600] text-ink"
            />
          ) : onRename ? (
            <button
              type="button"
              onClick={activateTitle}
              onBlur={() => setSelected(false)}
              aria-label={`Chat title: ${title}. Activate to rename`}
              title={title}
              className={cn(
                // Sized to its own text (and only shrinking when the header
                // runs out of room), so the chevron sits immediately after the
                // title rather than at the far end of the bar.
                'min-w-0 h-[24px] flex items-center border-0 rounded-[6px] px-[4px] -mx-[4px] bg-transparent font-chat text-[14.5px] font-[600] text-ink text-left cursor-text truncate transition-colors duration-200 hover:bg-tint2/60',
                selected && 'bg-accent-soft',
              )}
            >
              <span className="truncate">
                {contextPrefix && <span className="text-ink-faint font-[500]">{contextPrefix} / </span>}
                {title}
              </span>
            </button>
          ) : (
            <span className="min-w-0 font-chat text-[14.5px] font-[600] text-ink truncate">
              {contextPrefix && <span className="text-ink-faint font-[500]">{contextPrefix} / </span>}
              {title}
            </span>
          )}

          {!renaming && hasMenu && (
            <ChatHeaderMenu
              onRenameRequested={onRename && (() => setRenaming(true))}
              onAddToProject={onAddToProject}
              projects={projects}
              onDelete={onDelete}
              deleteLabel={deleteLabel}
              extraSections={extraSections}
            />
          )}

          {status && (
            <span aria-live="polite" className="flex-none text-[11.5px] text-ink-faint">
              {status}
            </span>
          )}
        </div>

        <div className="flex-none flex items-center gap-[2px]">
          <SourcesTrigger
            sources={sources}
            pinned={sourcesPinned}
            pinnedShown={sourcesPinnedShown}
            onTogglePinned={onToggleSources}
          />
          <ChatSourcesButton count={sourceCount} onOpen={onOpenSources} label={sourcesLabel} />
          {showShare && <ChatShareButton title={title} />}
        </div>
      </div>
    </header>
  );
}
