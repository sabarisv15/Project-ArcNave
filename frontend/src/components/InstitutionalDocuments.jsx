import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { PANE, STICKY_HEAD, StickyTableShell, TABLE_HEAD, TableEmptyState } from './WorkspaceLayout';
import { IconToolbar, SearchPopoverField, SortIconPopover } from './ToolbarIcons';
import { FilterPopover, FilterSelect } from './FilterPopover';
import { DocumentIcon } from './DocumentIcon';
import { DocumentPreviewDrawer } from './DocumentPreviewDrawer';
import { documentsApi } from '../api/documents';
import { formatSize } from '../lib/documentsData';
import { formatDateDMY } from '../lib/ist';

const GRID =
  'grid grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,.6fr)] gap-[12px] items-center';

const SORTS = [
  { key: 'published-desc', label: 'Newest uploaded' },
  { key: 'published-asc', label: 'Oldest uploaded' },
  { key: 'name-asc', label: 'Name A–Z' },
  { key: 'name-desc', label: 'Name Z–A' },
  { key: 'size-desc', label: 'Largest first' },
];

function documentToRow(d, categoryById, departmentById) {
  return {
    id: d.id,
    name: d.title || d.file_name,
    mimeType: d.mime_type,
    category: d.category_id ? (categoryById.get(d.category_id) ?? '—') : '—',
    department: d.department_id ? (departmentById.get(d.department_id) ?? '—') : 'College-wide',
    status: d.publication_status,
    publishedAt: new Date(d.created_at),
    size: d.file_size_bytes,
    scope: 'institutional',
  };
}

/**
 * Institutional documents — published by an authorised higher authority, and
 * read-only to an ordinary staff member.
 *
 * Real backend (GET /documents/institutional): category and department are
 * server-side filters, search matches title or file name server-side too;
 * sort stays client-side over whatever page of results came back.
 *
 * There is no upload, new-folder, rename, move, replace or delete control in
 * this pane at all. They are not rendered-and-disabled: a control a staff
 * member can never use is noise. The one place the constraint is stated is a
 * single quiet line in the toolbar, so the absence is explained rather than
 * mysterious.
 */
export function InstitutionalDocuments() {
  const [documents, setDocuments] = useState([]);
  const [categories, setCategories] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [department, setDepartment] = useState('');
  const [sort, setSort] = useState('published-desc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState('list');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    Promise.all([documentsApi.listDocumentCategories(), documentsApi.listDepartments()])
      .then(([categoryRows, departmentRows]) => {
        setCategories(Array.isArray(categoryRows) ? categoryRows : []);
        setDepartments(Array.isArray(departmentRows) ? departmentRows : []);
      })
      .catch(() => {});
  }, []);

  // A short debounce on the free-text search only — category/department
  // are discrete picks that should refetch immediately, a keystroke
  // shouldn't fire a request per character.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(
      () => {
        documentsApi
          .listInstitutionalDocuments({
            categoryId: category || undefined,
            departmentId: department || undefined,
            search: query || undefined,
          })
          .then((rows) => {
            if (!cancelled) setDocuments(Array.isArray(rows) ? rows : []);
          })
          .catch(() => {
            if (!cancelled) toast('Could not load institutional documents.');
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      query ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [category, department, query]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const departmentById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);

  const rows = useMemo(() => {
    const mapped = documents.map((d) => documentToRow(d, categoryById, departmentById));
    const by = {
      'published-desc': (a, b) => b.publishedAt - a.publishedAt,
      'published-asc': (a, b) => a.publishedAt - b.publishedAt,
      'name-asc': (a, b) => a.name.localeCompare(b.name),
      'name-desc': (a, b) => b.name.localeCompare(a.name),
      'size-desc': (a, b) => (b.size ?? 0) - (a.size ?? 0),
    }[sort];
    return [...mapped].sort(by);
  }, [documents, categoryById, departmentById, sort]);

  const activeFilters = (category ? 1 : 0) + (department ? 1 : 0);

  return (
    // `pt-[12px]`, tighter than the shared pane: Documents has a tab row of its
    // own directly above, and the pane's usual top padding on top of the tab
    // row's own bottom edge was a band of empty white with nothing in it.
    <div className={cn(PANE, 'pt-[12px]')}>
      <IconToolbar
        resultCount={loading ? 'Loading…' : `${rows.length} document${rows.length === 1 ? '' : 's'}`}
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
          onClear={() => {
            setCategory('');
            setDepartment('');
          }}
        >
          <div className="grid gap-[12px]">
            <FilterSelect
              label="Category"
              value={category}
              onChange={setCategory}
              options={[
                { value: '', label: 'All categories' },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <FilterSelect
              label="Department"
              value={department}
              onChange={setDepartment}
              options={[
                { value: '', label: 'All departments' },
                ...departments.map((d) => ({ value: d.id, label: d.name })),
              ]}
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
            <span>Department</span>
            <span>Status</span>
            <span className="text-right">Size</span>
          </div>
          {rows.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setPreview(d)}
              className={cn(
                GRID,
                'w-full px-[14px] py-[9px] border-b border-line-lighter text-left bg-transparent border-x-0 border-t-0 cursor-pointer hover:bg-tint2 transition-colors duration-150',
              )}
            >
              <span className="flex items-center gap-[9px] min-w-0">
                <DocumentIcon node={{ ...d, kind: 'file' }} />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-[500] text-ink truncate" title={d.name}>
                    {d.name}
                  </span>
                  <span className="block text-[11px] text-ink-faint tabular-nums">{formatDateDMY(d.publishedAt)}</span>
                </span>
              </span>
              <span className="text-[12px] text-ink-muted truncate">{d.category}</span>
              <span className="text-[12px] text-ink-muted truncate">{d.department}</span>
              <span className="text-[12px] text-ink-muted truncate">{d.status}</span>
              <span className="text-[12px] text-ink-faint tabular-nums text-right">{formatSize(d.size)}</span>
            </button>
          ))}
          {!loading && rows.length === 0 && (
            <TableEmptyState
              title="No results found"
              hint="Clear a filter or change the search term to see documents."
            />
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
                <span className="block text-[12.5px] font-[500] text-ink line-clamp-2" title={d.name}>
                  {d.name}
                </span>
                <span className="block text-[11px] text-ink-faint">{d.category}</span>
                <span className="block text-[11px] text-ink-faint tabular-nums">
                  {formatDateDMY(d.publishedAt)} · {formatSize(d.size)}
                </span>
              </button>
            ))}
          </div>
          {!loading && rows.length === 0 && (
            <TableEmptyState
              title="No results found"
              hint="Clear a filter or change the search term to see documents."
            />
          )}
        </div>
      )}

      <DocumentPreviewDrawer open={!!preview} doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
