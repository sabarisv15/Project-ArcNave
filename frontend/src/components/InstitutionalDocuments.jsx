import { useMemo, useState } from 'react';
import { LayoutGrid, List, Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import { PANE, STICKY_HEAD, StickyTableShell, TABLE_HEAD, TableEmptyState } from './WorkspaceLayout';
import { IconToolbar, SearchPopoverField, SortIconPopover } from './ToolbarIcons';
import { FilterPopover, FilterSelect } from './FilterPopover';
import { DocumentIcon } from './DocumentIcon';
import { DocumentPreviewDrawer } from './DocumentPreviewDrawer';
import { useDocumentsStore } from '../store/DocumentsProvider';
import { INSTITUTIONAL_CATEGORIES, INSTITUTIONAL_FOLDERS, formatSize } from '../lib/documentsData';
import { formatDateDMY } from '../lib/ist';

const GRID = 'grid grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,.6fr)] gap-[12px] items-center';

const SORTS = [
  { key: 'published-desc', label: 'Newest published' },
  { key: 'published-asc', label: 'Oldest published' },
  { key: 'name-asc', label: 'Name A–Z' },
  { key: 'name-desc', label: 'Name Z–A' },
  { key: 'size-desc', label: 'Largest first' },
];

/**
 * Institutional documents — published by an authorised higher authority, and
 * read-only to an ordinary staff member.
 *
 * There is no upload, new-folder, rename, move, replace or delete control in
 * this pane at all. They are not rendered-and-disabled: a control a staff
 * member can never use is noise. The one place the constraint is stated is a
 * single quiet line in the toolbar, so the absence is explained rather than
 * mysterious.
 */
export function InstitutionalDocuments() {
  const { institutional } = useDocumentsStore();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [folder, setFolder] = useState('');
  const [sort, setSort] = useState('published-desc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState('list');
  const [preview, setPreview] = useState(null);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    let out = institutional.filter((d) => {
      if (category && d.category !== category) return false;
      if (folder && d.folder !== folder) return false;
      if (!term) return true;
      return (
        d.name.toLowerCase().includes(term) ||
        d.category.toLowerCase().includes(term) ||
        d.publishedBy.toLowerCase().includes(term)
      );
    });
    const by = {
      'published-desc': (a, b) => b.publishedAt - a.publishedAt,
      'published-asc': (a, b) => a.publishedAt - b.publishedAt,
      'name-asc': (a, b) => a.name.localeCompare(b.name),
      'name-desc': (a, b) => b.name.localeCompare(a.name),
      'size-desc': (a, b) => (b.size ?? 0) - (a.size ?? 0),
    }[sort];
    out = [...out].sort(by);
    return out;
  }, [institutional, query, category, folder, sort]);

  const activeFilters = (category ? 1 : 0) + (folder ? 1 : 0);

  return (
    // `pt-[12px]`, tighter than the shared pane: Documents has a tab row of its
    // own directly above, and the pane's usual top padding on top of the tab
    // row's own bottom edge was a band of empty white with nothing in it.
    <div className={cn(PANE, 'pt-[12px]')}>
      <IconToolbar
        resultCount={`${rows.length} of ${institutional.length}`}
        // The read-only line is the pane's heading in everything but name, so
        // it takes the left of the header row rather than crowding the icons.
        leading={
          <span className="hidden sm:inline-flex items-center gap-[5px] text-[11.5px] text-ink-muted">
            <Lock size={12} strokeWidth={1.9} className="text-ink-ghost" aria-hidden="true" />
            Published by your institution · read-only
          </span>
        }
      >
        <SearchPopoverField
          value={query}
          onChange={setQuery}
          placeholder="Search institutional documents…"
          ariaLabel="Search institutional documents"
        />
        <SortIconPopover options={SORTS} value={sort} onChange={setSort} />
        <FilterPopover
          iconOnly
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          activeCount={activeFilters}
          align="end"
          onClear={() => { setCategory(''); setFolder(''); }}
        >
          <div className="grid gap-[12px]">
            <FilterSelect
              label="Category"
              value={category}
              onChange={setCategory}
              options={[{ value: '', label: 'All categories' }, ...INSTITUTIONAL_CATEGORIES.map((c) => ({ value: c, label: c }))]}
            />
            <FilterSelect
              label="Folder"
              value={folder}
              onChange={setFolder}
              options={[{ value: '', label: 'All folders' }, ...INSTITUTIONAL_FOLDERS.map((f) => ({ value: f, label: f }))]}
            />
          </div>
        </FilterPopover>
        <button
          type="button"
          aria-label={view === 'list' ? 'Switch to grid view' : 'Switch to list view'}
          title={view === 'list' ? 'Grid view' : 'List view'}
          onClick={() => setView((v) => (v === 'list' ? 'grid' : 'list'))}
          className="w-[34px] h-[34px] grid place-items-center rounded-[9px] text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-tint2"
        >
          {view === 'list' ? <LayoutGrid size={15} strokeWidth={1.9} /> : <List size={15} strokeWidth={1.9} />}
        </button>
      </IconToolbar>

      {view === 'list' ? (
        <StickyTableShell minWidth={720}>
          <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'px-[14px] py-[9px]')}>
            <span>Document</span>
            <span>Category</span>
            <span>Folder</span>
            <span>Published by</span>
            <span className="text-right">Size</span>
          </div>
          {rows.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setPreview(d)}
              className={cn(GRID, 'w-full px-[14px] py-[9px] border-b border-line-lighter text-left bg-transparent border-x-0 border-t-0 cursor-pointer hover:bg-tint2 transition-colors duration-150')}
            >
              <span className="flex items-center gap-[9px] min-w-0">
                <DocumentIcon node={{ ...d, kind: 'file' }} />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-[500] text-ink truncate" title={d.name}>{d.name}</span>
                  <span className="block text-[11px] text-ink-faint tabular-nums">{formatDateDMY(d.publishedAt)}</span>
                </span>
              </span>
              <span className="text-[12px] text-ink-muted truncate">{d.category}</span>
              <span className="text-[12px] text-ink-muted truncate">{d.folder}</span>
              <span className="min-w-0">
                <span className="block text-[12px] text-ink-muted truncate">{d.publishedBy}</span>
                <span className="block text-[11px] text-ink-faint truncate">{d.publisherRole}</span>
              </span>
              <span className="text-[12px] text-ink-faint tabular-nums text-right">{formatSize(d.size)}</span>
            </button>
          ))}
          {rows.length === 0 && (
            <TableEmptyState title="No results found" hint="Clear a filter or change the search term to see documents." />
          )}
        </StickyTableShell>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet">
          <div className="grid gap-[10px] grid-cols-[repeat(auto-fill,minmax(210px,1fr))] pb-[6px]">
            {rows.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setPreview(d)}
                className="flex flex-col gap-[8px] p-[12px] border border-line rounded-[14px] bg-paper text-left cursor-pointer transition-colors duration-150 hover:bg-tint2"
              >
                <DocumentIcon node={{ ...d, kind: 'file' }} size={20} />
                <span className="block text-[12.5px] font-[500] text-ink line-clamp-2" title={d.name}>{d.name}</span>
                <span className="block text-[11px] text-ink-faint">{d.category}</span>
                <span className="block text-[11px] text-ink-faint tabular-nums">
                  {formatDateDMY(d.publishedAt)} · {formatSize(d.size)}
                </span>
              </button>
            ))}
          </div>
          {rows.length === 0 && (
            <TableEmptyState title="No results found" hint="Clear a filter or change the search term to see documents." />
          )}
        </div>
      )}

      <DocumentPreviewDrawer open={!!preview} doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
