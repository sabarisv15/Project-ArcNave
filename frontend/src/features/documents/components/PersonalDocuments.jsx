import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import {
  ChevronRight,
  Copy,
  Download,
  FolderPlus,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Upload,
  FolderUp,
  X,
  MoveRight,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PANE, STICKY_HEAD, StickyTableShell, TABLE_HEAD } from '@/components/WorkspaceLayout';
import { SearchPopoverField, SortIconPopover } from '@/components/ToolbarIcons';
import { DocumentIcon } from './DocumentIcon';
import { DocumentPreviewDrawer } from './DocumentPreviewDrawer';
import { RenameNodeDialog } from './RenameNodeDialog';
import { useDocumentsStore } from '../store/useDocumentsStore';
import { documentsApi } from '@/api/documents';
import { PERSONAL_ROOT, canMoveInto, formatSize, pathTo } from '../lib/documentsData';
import { formatDateDMY } from '@/lib/ist';
import { FILTER_SURFACE } from '@/components/FilterPopover';

const GRID = 'grid grid-cols-[minmax(0,2.6fr)_minmax(0,1fr)_minmax(0,.8fr)_36px] gap-[12px] items-center';

const SORTS = [
  { key: 'name-asc', label: 'Name A–Z' },
  { key: 'name-desc', label: 'Name Z–A' },
  { key: 'modified-desc', label: 'Recently modified' },
  { key: 'size-desc', label: 'Largest first' },
];

const MENU_ITEM =
  'flex items-center gap-[9px] w-full h-[32px] px-[10px] border-0 bg-transparent rounded-[9px] font-sans text-[12.5px] text-ink-soft cursor-pointer outline-none select-none data-[highlighted]:bg-tint2';

const TOOL_BTN =
  'w-[34px] h-[34px] grid place-items-center rounded-[9px] text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-tint2';

/** Folders sort ahead of files in every sort order — Explorer's convention, and the useful one. */
function sortNodes(list, sort) {
  const by = {
    'name-asc': (a, b) => a.name.localeCompare(b.name),
    'name-desc': (a, b) => b.name.localeCompare(a.name),
    'modified-desc': (a, b) => b.updatedAt - a.updatedAt,
    'size-desc': (a, b) => (b.size ?? 0) - (a.size ?? 0),
  }[sort];
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return by(a, b);
  });
}

function Breadcrumbs({ trail, onNavigate }) {
  return (
    <nav aria-label="Folder path" className="flex items-center gap-[2px] min-w-0 overflow-x-auto scroll-quiet">
      {trail.map((node, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={node.id} className="flex items-center gap-[2px] flex-none">
            {i > 0 && <ChevronRight size={13} strokeWidth={2} className="text-ink-faint" aria-hidden="true" />}
            <button
              type="button"
              onClick={() => !last && onNavigate(node.id)}
              aria-current={last ? 'page' : undefined}
              disabled={last}
              className={cn(
                'h-[26px] px-[7px] border-0 bg-transparent rounded-[8px] font-sans text-[12.5px] whitespace-nowrap transition-colors duration-200',
                last
                  ? 'text-ink font-[600] cursor-default'
                  : 'text-ink-muted font-[500] cursor-pointer hover:bg-tint2 hover:text-ink',
              )}
            >
              {node.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

function UploadTray({ uploads, onDismiss }) {
  if (!uploads.length) return null;
  return (
    <div className="flex-none mb-[8px] grid gap-[5px]" aria-live="polite">
      {uploads.map((u) => (
        <div
          key={u.id}
          className="flex items-center gap-[10px] px-[11px] py-[7px] border border-line rounded-[11px] bg-paper"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-[500] text-ink truncate">{u.name}</span>
            <span className="block text-[11px] text-ink-faint">
              {u.status === 'failed' ? 'Upload failed' : u.status === 'done' ? 'Uploaded' : `Uploading… ${u.progress}%`}
            </span>
          </span>
          {u.status !== 'failed' && (
            <span className="flex-none w-[92px] h-[4px] rounded-full bg-frame overflow-hidden" aria-hidden="true">
              <span
                className="block h-full bg-accent transition-[width] duration-200"
                style={{ width: `${u.progress}%` }}
              />
            </span>
          )}
          {u.status === 'failed' && (
            <span className="inline-flex items-center gap-[4px] text-[11px] text-danger">
              <AlertCircle size={12} strokeWidth={2.2} aria-hidden="true" /> Retry
            </span>
          )}
          <button
            type="button"
            aria-label={`Dismiss ${u.name}`}
            onClick={() => onDismiss(u.id)}
            className="flex-none text-ink-faint hover:text-ink"
          >
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Personal documents — the staff member's own private files, in a File
 * Explorer *information architecture* (breadcrumbs, folders-first listing,
 * list/grid, New menu, per-item actions) rather than a fake Windows shell.
 *
 * Two behaviours matter more than the chrome:
 *  - Opening a file never changes the current folder. The preview is a drawer
 *    over this pane, so the path and the selection survive it.
 *  - Delete is a confirmed action that moves items to Trash with an Undo, so
 *    the one destructive control in the module is recoverable.
 */
export function PersonalDocuments() {
  const {
    root,
    childrenOf,
    createFolder,
    rename,
    move,
    duplicate,
    remove,
    uploads,
    upload,
    dismissUpload,
    personal,
    loading,
  } = useDocumentsStore();

  const [folderId, setFolderId] = useState(root);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name-asc');
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [moving, setMoving] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInput = useRef(null);
  const folderInput = useRef(null);

  const trail = useMemo(() => pathTo(personal, folderId), [personal, folderId]);
  const items = useMemo(() => {
    const term = query.trim().toLowerCase();
    const base = childrenOf(folderId);
    const filtered = term ? base.filter((n) => n.name.toLowerCase().includes(term)) : base;
    return sortNodes(filtered, sort);
  }, [childrenOf, folderId, query, sort]);

  // A folder that no longer exists (deleted while open) must not strand the user.
  useEffect(() => {
    if (folderId === root) return;
    if (!personal.some((n) => n.id === folderId)) setFolderId(root);
  }, [personal, folderId, root]);

  // Selection is per-folder: it survives preview, rename and sort, and resets
  // only when the current folder actually changes.
  useEffect(() => {
    setSelected(new Set());
  }, [folderId]);

  const toggleSelect = useCallback((id, additive) => {
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set();
      if (next.has(id) && additive) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openNode = (node) => {
    if (node.kind === 'folder') setFolderId(node.id);
    else setPreview(node);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) upload(folderId, e.dataTransfer.files);
  };

  const moveTargets = useMemo(
    () =>
      [{ id: root, name: 'Personal documents' }, ...personal.filter((n) => n.kind === 'folder')].filter((t) =>
        moving ? canMoveInto(personal, moving.id, t.id) : false,
      ),
    [personal, moving, root],
  );

  const rowMenu = (node) => (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${node.name}`}
          onClick={(e) => e.stopPropagation()}
          className="w-[28px] h-[28px] grid place-items-center rounded-[8px] border-0 bg-transparent text-ink-faint cursor-pointer hover:bg-tint2 hover:text-ink"
        >
          <MoreHorizontal size={15} strokeWidth={2} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={cn(FILTER_SURFACE, 'p-[5px] min-w-[188px]')}>
          <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setRenaming(node)}>
            <Pencil size={13} strokeWidth={1.9} /> Rename
          </DropdownMenu.Item>
          <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setMoving(node)}>
            <MoveRight size={13} strokeWidth={1.9} /> Move to…
          </DropdownMenu.Item>
          {node.kind === 'file' && (
            <>
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => duplicate(node.id)}>
                <Copy size={13} strokeWidth={1.9} /> Duplicate
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={MENU_ITEM}
                onSelect={() =>
                  documentsApi.download(node.id, node.name).catch(() => toast(`Could not download “${node.name}”.`))
                }
              >
                <Download size={13} strokeWidth={1.9} /> Download
              </DropdownMenu.Item>
            </>
          )}
          <DropdownMenu.Separator className="h-px my-[4px] bg-line" />
          <DropdownMenu.Item
            className={cn(MENU_ITEM, 'text-danger data-[highlighted]:bg-danger-soft')}
            onSelect={() => setConfirmDelete([node])}
          >
            <Trash2 size={13} strokeWidth={1.9} /> Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  const selectedNodes = items.filter((n) => selected.has(n.id));

  return (
    <div
      className={PANE}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* Command row: path on the left, tools and New on the right. */}
      <div className="flex-none flex items-center gap-[8px] mb-[10px]">
        <Breadcrumbs trail={trail} onNavigate={setFolderId} />
        <div className="flex-1" />
        <span className="hidden sm:block text-[11.5px] text-ink-faint whitespace-nowrap">
          {selectedNodes.length > 0
            ? `${selectedNodes.length} selected`
            : `${items.length} item${items.length === 1 ? '' : 's'}`}
        </span>
        <SearchPopoverField
          value={query}
          onChange={setQuery}
          placeholder="Search this folder…"
          ariaLabel="Search personal documents"
        />
        <SortIconPopover options={SORTS} value={sort} onChange={setSort} />
        <button
          type="button"
          aria-label={view === 'list' ? 'Switch to grid view' : 'Switch to list view'}
          title={view === 'list' ? 'Grid view' : 'List view'}
          onClick={() => setView((v) => (v === 'list' ? 'grid' : 'list'))}
          className={TOOL_BTN}
        >
          {view === 'list' ? <LayoutGrid size={15} strokeWidth={1.9} /> : <List size={15} strokeWidth={1.9} />}
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="flex-none inline-flex items-center gap-[6px] h-[34px] px-[13px] border-0 rounded-[10px] bg-accent text-white font-sans text-[12.5px] font-[500] cursor-pointer transition-colors duration-200 hover:bg-accent-hover"
            >
              <Plus size={14} strokeWidth={2.2} /> New
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className={cn(FILTER_SURFACE, 'p-[5px] min-w-[190px]')}>
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setCreatingFolder(true)}>
                <FolderPlus size={13} strokeWidth={1.9} /> New folder
              </DropdownMenu.Item>
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => fileInput.current?.click()}>
                <Upload size={13} strokeWidth={1.9} /> Upload files
              </DropdownMenu.Item>
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => folderInput.current?.click()}>
                <FolderUp size={13} strokeWidth={1.9} /> Upload folder
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          upload(folderId, e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        webkitdirectory=""
        // Legacy non-prefixed folder-picker attribute kept alongside
        // webkitdirectory for older-browser compat; not a real DOM
        // property React knows about, but harmless to pass through.
        // eslint-disable-next-line react/no-unknown-property
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          upload(folderId, e.target.files);
          e.target.value = '';
        }}
      />

      <UploadTray uploads={uploads} onDismiss={dismissUpload} />

      {selectedNodes.length > 1 && (
        <div className="flex-none flex items-center gap-[8px] mb-[8px] px-[11px] py-[7px] border border-accent-line rounded-[11px] bg-accent-soft">
          <span className="text-[12px] font-[500] text-accent">{selectedNodes.length} selected</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setConfirmDelete(selectedNodes)}
            className="h-[28px] px-[10px] border border-line rounded-[9px] bg-paper font-sans text-[11.5px] font-[500] text-danger cursor-pointer hover:bg-danger-soft"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="h-[28px] px-[10px] border border-line rounded-[9px] bg-paper font-sans text-[11.5px] font-[500] text-ink-soft cursor-pointer hover:bg-tint2"
          >
            Clear
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex-1 min-h-0 grid place-items-center border border-line rounded-[16px] bg-paper">
          <div className="text-[12.5px] text-ink-faint">Loading your documents…</div>
        </div>
      ) : items.length === 0 ? (
        <div
          className={cn(
            'flex-1 min-h-0 grid place-items-center border rounded-[16px] bg-paper',
            dragOver ? 'border-accent-line bg-accent-soft' : 'border-line',
          )}
        >
          <div className="text-center px-[20px]">
            <div className="text-[13.5px] font-[500] text-ink">
              {query ? 'No results found' : 'This folder is empty'}
            </div>
            <div className="mt-[4px] text-[12px] text-ink-faint">
              {query
                ? 'Change the search term to see files in this folder.'
                : 'Drop files here, or start with an action below.'}
            </div>
            {!query && (
              <div className="flex items-center justify-center gap-[8px] mt-[12px]">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="h-[32px] px-[13px] border-0 rounded-[10px] bg-accent text-white font-sans text-[12.5px] font-[500] cursor-pointer hover:bg-accent-hover"
                >
                  Upload files
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingFolder(true)}
                  className="h-[32px] px-[13px] border border-line rounded-[10px] bg-paper font-sans text-[12.5px] font-[500] text-ink-soft cursor-pointer hover:bg-tint2"
                >
                  Create folder
                </button>
              </div>
            )}
          </div>
        </div>
      ) : view === 'list' ? (
        <StickyTableShell minWidth={560} className={dragOver ? 'border-accent-line' : undefined}>
          <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'px-[14px] py-[9px]')}>
            <span>Name</span>
            <span>Modified</span>
            <span className="text-right">Size</span>
            <span className="sr-only">Actions</span>
          </div>
          {items.map((node) => (
            <div
              key={node.id}
              role="button"
              tabIndex={0}
              // `aria-pressed`, not `aria-selected` — this row is
              // `role="button"`, and `aria-selected` is only valid on
              // roles that model a selection (option/row/tab/gridcell),
              // not button; `aria-pressed` is button's own toggle-state
              // attribute and matches what clicking here actually does.
              aria-pressed={selected.has(node.id)}
              onClick={(e) => toggleSelect(node.id, e.ctrlKey || e.metaKey)}
              onDoubleClick={() => openNode(node)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  openNode(node);
                }
                if (e.key === ' ') {
                  e.preventDefault();
                  toggleSelect(node.id, true);
                }
              }}
              className={cn(
                GRID,
                'px-[14px] py-[9px] border-b border-line-lighter cursor-pointer outline-none transition-colors duration-150',
                selected.has(node.id) ? 'bg-accent-soft' : 'hover:bg-tint2 focus-visible:bg-tint2',
              )}
            >
              <span className="flex items-center gap-[9px] min-w-0">
                <DocumentIcon node={node} />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openNode(node);
                  }}
                  className="min-w-0 border-0 bg-transparent p-0 text-left font-sans text-[12.5px] font-[500] text-ink truncate cursor-pointer hover:text-accent"
                  title={node.name}
                >
                  {node.name}
                </button>
              </span>
              <span className="text-[12px] text-ink-muted tabular-nums">{formatDateDMY(node.updatedAt)}</span>
              <span className="text-[12px] text-ink-faint tabular-nums text-right">
                {node.kind === 'folder' ? '—' : formatSize(node.size)}
              </span>
              <span className="grid place-items-center">{rowMenu(node)}</span>
            </div>
          ))}
        </StickyTableShell>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet">
          <div className="grid gap-[10px] grid-cols-[repeat(auto-fill,minmax(184px,1fr))] pb-[6px]">
            {items.map((node) => (
              <div
                key={node.id}
                role="button"
                tabIndex={0}
                // `aria-pressed`, not `aria-selected` — this row is
                // `role="button"`, and `aria-selected` is only valid on
                // roles that model a selection (option/row/tab/gridcell),
                // not button; `aria-pressed` is button's own toggle-state
                // attribute and matches what clicking here actually does.
                aria-pressed={selected.has(node.id)}
                onClick={(e) => toggleSelect(node.id, e.ctrlKey || e.metaKey)}
                onDoubleClick={() => openNode(node)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    openNode(node);
                  }
                }}
                className={cn(
                  'relative flex flex-col gap-[7px] p-[12px] border rounded-[14px] cursor-pointer outline-none transition-colors duration-150',
                  selected.has(node.id) ? 'border-accent-line bg-accent-soft' : 'border-line bg-paper hover:bg-tint2',
                )}
              >
                <span className="flex items-start justify-between gap-[6px]">
                  <DocumentIcon node={node} size={20} />
                  {rowMenu(node)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openNode(node);
                  }}
                  className="border-0 bg-transparent p-0 text-left font-sans text-[12.5px] font-[500] text-ink line-clamp-2 cursor-pointer hover:text-accent"
                  title={node.name}
                >
                  {node.name}
                </button>
                <span className="text-[11px] text-ink-faint tabular-nums">
                  {formatDateDMY(node.updatedAt)}
                  {node.kind === 'file' ? ` · ${formatSize(node.size)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Opening a file never leaves the folder — the viewer is a drawer over this pane. */}
      <DocumentPreviewDrawer open={!!preview} doc={preview} onClose={() => setPreview(null)} />

      <RenameNodeDialog
        open={!!renaming}
        node={renaming}
        onClose={() => setRenaming(null)}
        onSubmit={(name) => {
          rename(renaming.id, name);
          setRenaming(null);
        }}
      />

      <RenameNodeDialog
        open={creatingFolder}
        mode="create"
        folderId={folderId}
        onClose={() => setCreatingFolder(false)}
        onSubmit={(name) => {
          createFolder(folderId, name);
          setCreatingFolder(false);
        }}
      />

      {/* Move-to list: drag-and-drop between folders isn't reliable enough to be
          the only path, so the explicit action is the supported one. */}
      <AlertDialog.Root open={!!moving} onOpenChange={(v) => !v && setMoving(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[130] bg-overlay/20 animate-fadeUp" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[131] w-[calc(100%-48px)] max-w-[400px] bg-paper rounded-[16px] p-[20px] shadow-dialog outline-none animate-fadeUp">
            <AlertDialog.Title className="m-0 mb-[4px] text-[15.5px] font-[600]">
              Move “{moving?.name}”
            </AlertDialog.Title>
            <AlertDialog.Description className="m-0 mb-[12px] text-[12.5px] text-ink-muted">
              Choose a destination folder.
            </AlertDialog.Description>
            <div className="max-h-[260px] overflow-y-auto scroll-quiet grid gap-[3px]">
              {moveTargets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    move(moving.id, t.id);
                    setMoving(null);
                  }}
                  className="flex items-center gap-[8px] h-[34px] px-[10px] border-0 bg-transparent rounded-[9px] font-sans text-[12.5px] text-ink-soft text-left cursor-pointer hover:bg-tint2"
                >
                  <DocumentIcon node={{ kind: 'folder' }} /> {t.name}
                </button>
              ))}
              {moveTargets.length === 0 && (
                <p className="m-0 py-[10px] text-[12px] text-ink-faint">There is no other folder to move this to.</p>
              )}
            </div>
            <div className="flex justify-end mt-[16px]">
              <AlertDialog.Cancel asChild>
                <button
                  type="button"
                  className="h-[32px] px-[14px] border border-line rounded-[10px] bg-paper font-sans text-[12.5px] font-[500] text-ink-muted cursor-pointer hover:bg-tint2"
                >
                  Cancel
                </button>
              </AlertDialog.Cancel>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[130] bg-overlay/20 animate-fadeUp" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[131] w-[calc(100%-48px)] max-w-[400px] bg-paper rounded-[16px] p-[20px] shadow-dialog outline-none animate-fadeUp">
            <AlertDialog.Title className="m-0 mb-[6px] text-[15.5px] font-[600]">
              {confirmDelete?.length === 1
                ? `Delete “${confirmDelete[0].name}”?`
                : `Delete ${confirmDelete?.length} items?`}
            </AlertDialog.Title>
            <AlertDialog.Description className="m-0 mb-[18px] text-[12.5px] leading-[1.6] text-ink-muted">
              This can&rsquo;t be undone.
              {confirmDelete?.length === 1 && confirmDelete[0].kind === 'folder'
                ? ' Everything inside this folder is deleted too.'
                : ''}
            </AlertDialog.Description>
            <div className="flex justify-end gap-[9px]">
              <AlertDialog.Cancel asChild>
                <button
                  type="button"
                  className="h-[32px] px-[14px] border border-line rounded-[10px] bg-paper font-sans text-[12.5px] font-[500] text-ink-muted cursor-pointer hover:bg-tint2"
                >
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  onClick={() => {
                    remove(confirmDelete.map((n) => n.id));
                    setSelected(new Set());
                    setConfirmDelete(null);
                  }}
                  className="h-[32px] px-[14px] border-0 rounded-[10px] bg-danger text-white font-sans text-[12.5px] font-[500] cursor-pointer hover:bg-danger-hover"
                >
                  Delete
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
