import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAssessmentsStore } from '../store/AssessmentsProvider';
import {
  ASSESSMENT_SORTS,
  ASSESSMENT_TYPES,
  TYPE_LABELS,
  eligibleScopes,
  marksProgress,
  scopeById,
  studentsForScope,
} from '../lib/assessmentsData';
import { formatDateDMY } from '@/lib/ist';
import { SearchPopoverField, SortIconPopover } from '@/components/ToolbarIcons';
import { FilterPopover, FilterSelect } from '@/components/FilterPopover';
import { TABLE_HEAD, TableEmptyState } from '@/components/WorkspaceLayout';
import { PRIMARY_BTN } from '@/components/ui/Drawer';
import { AssessmentCreateDrawer } from '../components/AssessmentCreateDrawer';
import { AssessmentDetailDrawer } from '../components/AssessmentDetailDrawer';

const GRID =
  'grid grid-cols-[minmax(0,1.5fr)_minmax(0,130px)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,104px)_minmax(0,124px)_minmax(0,96px)] gap-x-[12px] items-center px-[16px]';

/** Draft / Published — the two states, carried by the word, reinforced by a dot. */
function StatusText({ status }) {
  const published = status === 'published';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[6px] text-[12px] font-[500]',
        published ? 'text-success' : 'text-ink-muted',
      )}
    >
      <span
        className={cn('flex-none w-[6px] h-[6px] rounded-full', published ? 'bg-success' : 'bg-ink-disabled')}
        aria-hidden="true"
      />
      {published ? 'Published' : 'Draft'}
    </span>
  );
}

function useAssessmentList() {
  const { assessments } = useAssessmentsStore();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('recent');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ type: '', scopeId: '', status: '' });

  const setFilter = (k, v) => setFilters((prev) => ({ ...prev, [k]: v }));
  const clearFilters = () => setFilters({ type: '', scopeId: '', status: '' });

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = assessments.filter((a) => {
      if (filters.type && a.type !== filters.type) return false;
      if (filters.scopeId && a.scopeId !== filters.scopeId) return false;
      if (filters.status && a.status !== filters.status) return false;
      if (!term) return true;
      return [a.name, TYPE_LABELS[a.type], a.subject, a.code].join(' ').toLowerCase().includes(term);
    });

    const byDate = (x, y) => y.date - x.date;
    if (sortKey === 'oldest') return [...list].sort((x, y) => -byDate(x, y));
    if (sortKey === 'name') return [...list].sort((x, y) => x.name.localeCompare(y.name));
    if (sortKey === 'subject') return [...list].sort((x, y) => x.subject.localeCompare(y.subject) || byDate(x, y));
    return [...list].sort(byDate);
  }, [assessments, query, sortKey, filters]);

  return {
    rows,
    total: assessments.length,
    query,
    setQuery,
    sortKey,
    setSortKey,
    filtersOpen,
    setFiltersOpen,
    filters,
    setFilter,
    clearFilters,
    activeFilterCount: Object.values(filters).filter(Boolean).length,
  };
}

/**
 * Curriculum → Assessments. The staff member's own assessments, nothing else:
 * no other staff's work, no institution-wide exam administration, and no way
 * to reach a class they don't teach — every scope offered anywhere in this
 * module comes from their approved timetable allocation.
 */
export function AssessmentsView() {
  const l = useAssessmentList();
  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState(null);
  const scopes = eligibleScopes();

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-[28px] pt-[22px] pb-[20px] animate-viewIn">
      <div className="flex-none flex items-center gap-[10px] mb-[12px]">
        <h1 className="m-0 text-[18px] font-[600] tracking-[-.015em]">Assessments</h1>
        <span className="text-[11.5px] text-ink-faint">{l.total} total</span>
        <div className="flex-1" />
        <SearchPopoverField
          value={l.query}
          onChange={l.setQuery}
          placeholder="Search name, subject, class…"
          ariaLabel="Search assessments"
        />
        <SortIconPopover
          options={ASSESSMENT_SORTS}
          value={l.sortKey}
          onChange={l.setSortKey}
          label="Sort assessments"
        />
        <FilterPopover
          open={l.filtersOpen}
          onOpenChange={l.setFiltersOpen}
          activeCount={l.activeFilterCount}
          onClear={l.clearFilters}
          iconOnly
          align="end"
          width={280}
          label="Filter assessments"
        >
          <div className="grid grid-cols-1 gap-[14px]">
            <FilterSelect
              label="Type"
              value={l.filters.type}
              onChange={(v) => l.setFilter('type', v)}
              options={[{ value: '', label: 'All' }, ...ASSESSMENT_TYPES]}
            />
            <FilterSelect
              label="Subject / class"
              value={l.filters.scopeId}
              onChange={(v) => l.setFilter('scopeId', v)}
              options={[
                { value: '', label: 'All' },
                ...scopes.map((s) => ({ value: s.id, label: `${s.subject} · ${s.code}` })),
              ]}
            />
            <FilterSelect
              label="State"
              value={l.filters.status}
              onChange={(v) => l.setFilter('status', v)}
              options={[
                { value: '', label: 'All' },
                { value: 'draft', label: 'Draft' },
                { value: 'published', label: 'Published' },
              ]}
            />
          </div>
        </FilterPopover>
        <button type="button" className={PRIMARY_BTN} onClick={() => setCreateOpen(true)}>
          Create assessment
        </button>
      </div>

      <div className="flex-1 min-h-0 border border-line rounded-[16px] bg-paper overflow-hidden">
        <div className="h-full overflow-auto scroll-quiet">
          <div className="min-w-[980px]">
            <div
              className={cn(
                GRID,
                TABLE_HEAD,
                'sticky top-0 z-[46] h-[36px] bg-paper shadow-[inset_0_-1px_0_theme(colors.line.DEFAULT)]',
              )}
            >
              <span>Assessment</span>
              <span>Type</span>
              <span>Subject</span>
              <span>Class / section</span>
              <span>Date</span>
              <span>Marks</span>
              <span>State</span>
            </div>

            {l.rows.map((a) => {
              const students = studentsForScope(scopeById(a.scopeId));
              const { entered, total } = marksProgress(a, students);
              return (
                <div
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenId(a.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setOpenId(a.id);
                    }
                  }}
                  className={cn(
                    GRID,
                    'h-[46px] border-t border-line-light cursor-pointer transition-colors duration-200 hover:bg-tint2 outline-none focus-visible:bg-tint2',
                  )}
                >
                  <span className="min-w-0 text-[13px] font-[500] text-ink truncate" title={a.name}>
                    {a.name}
                  </span>
                  <span className="min-w-0 text-[12px] text-ink-muted truncate">{TYPE_LABELS[a.type]}</span>
                  <span className="min-w-0 text-[12.5px] text-ink truncate" title={a.subject}>
                    {a.subject}
                  </span>
                  <span className="min-w-0 text-[12.5px] text-ink-muted truncate" title={a.code}>
                    {a.code}
                  </span>
                  <span className="text-[12.5px] text-ink-muted tabular-nums whitespace-nowrap">
                    {formatDateDMY(a.date)}
                  </span>
                  <span className="text-[12px] tabular-nums whitespace-nowrap">
                    <span className={entered === total ? 'text-success font-[600]' : 'text-ink-muted'}>
                      {entered}/{total}
                    </span>
                    <span className="text-ink-faint"> entered</span>
                  </span>
                  <span>
                    <StatusText status={a.status} />
                  </span>
                </div>
              );
            })}

            {l.rows.length === 0 && (
              <TableEmptyState
                title={l.total ? 'No results found' : 'No assessments yet'}
                hint={
                  l.total
                    ? 'Try clearing a filter or search term.'
                    : 'Use Create assessment to add one for a class you teach.'
                }
              />
            )}
          </div>
        </div>
      </div>

      <AssessmentCreateDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(a) => setOpenId(a.id)}
      />
      <AssessmentDetailDrawer assessmentId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
