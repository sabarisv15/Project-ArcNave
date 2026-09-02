import { useCallback, useMemo, useState } from 'react';
import { HISTORY_PERIODS, formatFullDate } from '@/features/attendance/lib/attendanceData';
import { DATE_PRESETS, inDateRange } from '../lib/dateFilters';
import { useAttendanceStore } from '@/features/attendance';

const EMPTY_FILTERS = { ownership: '', code: '', subject: '', year: '' };
const SORTS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'subject', label: 'Subject A–Z' },
  { key: 'class', label: 'Class A–Z' },
];

/** Search, filter, and sort state for the dedicated Class Logs view — a separate surface from Attendance history. */
export function useClassLogs() {
  const { now, sessions } = useAttendanceStore();
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [datePreset, setDatePreset] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sortKey, setSortKey] = useState('newest');
  const [detailPeriodId, setDetailPeriodId] = useState(null);

  const allRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return HISTORY_PERIODS.filter((period) => {
      const session = sessions[period.id];

      if (term) {
        const haystack = [
          session.classLog.topicTaught,
          session.classLog.notes,
          period.subject,
          period.code,
          period.programme,
          period.section,
          period.batch,
          formatFullDate(period.date),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (filters.ownership && period.ownership !== filters.ownership) return false;
      if (filters.code && period.code !== filters.code) return false;
      if (filters.subject && period.subject !== filters.subject) return false;
      if (filters.year && String(period.year) !== filters.year) return false;
      if (!inDateRange(period.date, now, datePreset, customFrom, customTo)) return false;
      return true;
    }).map((period) => ({ period, session: sessions[period.id] }));
  }, [query, filters, datePreset, customFrom, customTo, sessions, now]);

  const rows = useMemo(() => {
    const sorted = [...allRows];
    if (sortKey === 'newest') sorted.sort((a, b) => b.period.startTime - a.period.startTime);
    else if (sortKey === 'oldest') sorted.sort((a, b) => a.period.startTime - b.period.startTime);
    else if (sortKey === 'subject') sorted.sort((a, b) => a.period.subject.localeCompare(b.period.subject));
    else if (sortKey === 'class') sorted.sort((a, b) => a.period.code.localeCompare(b.period.code));
    return sorted;
  }, [allRows, sortKey]);

  const setFilter = useCallback((key, value) => setFilters((f) => ({ ...f, [key]: value })), []);
  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setDatePreset('all');
    setCustomFrom('');
    setCustomTo('');
  }, []);

  const activeChips = useMemo(() => {
    const chips = [];
    if (filters.ownership)
      chips.push({ key: 'ownership', label: filters.ownership === 'own' ? 'My class' : 'Substitute duty' });
    if (filters.code) chips.push({ key: 'code', label: filters.code });
    if (filters.subject) chips.push({ key: 'subject', label: filters.subject });
    if (filters.year) chips.push({ key: 'year', label: `Year ${filters.year}` });
    if (datePreset !== 'all') chips.push({ key: 'date', label: DATE_PRESETS.find((p) => p.key === datePreset)?.label });
    return chips;
  }, [filters, datePreset]);

  const removeChip = useCallback(
    (key) => {
      if (key === 'date') {
        setDatePreset('all');
        setCustomFrom('');
        setCustomTo('');
        return;
      }
      setFilter(key, '');
    },
    [setFilter],
  );

  const activeFilterCount = activeChips.length;
  const total = HISTORY_PERIODS.length;

  const resultCountLabel =
    activeFilterCount === 0 && !query.trim()
      ? `${total} class logs`
      : rows.length === 0
        ? 'No results found'
        : `Showing ${rows.length} of ${total} class logs`;

  const sortLabel = SORTS.find((s) => s.key === sortKey)?.label ?? 'Newest first';

  return {
    rows,
    resultCountLabel,
    total,
    now,
    query,
    setQuery,
    panel,
    setPanel,
    filtersOpen: panel === 'filters',
    toggleFilters: () => setPanel((p) => (p === 'filters' ? null : 'filters')),
    sortMenuOpen: panel === 'sort',
    toggleSortMenu: () => setPanel((p) => (p === 'sort' ? null : 'sort')),
    sortKey,
    setSortKey,
    sortLabel,
    filters,
    setFilter,
    clearFilters,
    activeChips,
    activeFilterCount,
    removeChip,
    datePreset,
    setDatePreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    detailPeriodId,
    openDetail: setDetailPeriodId,
    closeDetail: () => setDetailPeriodId(null),
  };
}

export { SORTS as CLASS_LOG_SORTS };
