import { useCallback, useMemo, useState } from 'react';
import { SORTS, STAFF, STAFF_TOTAL } from '../lib/staffData';

const EMPTY_FILTERS = { department: '', designation: '', employmentType: '' };

/** All Staff directory state in one place: search / sort / filters / detail. */
export function useStaff() {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [panel, setPanel] = useState(null); // 'sort' | 'filters' | null
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [detailStaffId, setDetailStaffId] = useState(null);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const f = filters;
    const list = STAFF.filter((p) => {
      if (
        term &&
        !(
          p.name.toLowerCase().includes(term) ||
          p.employeeId.toLowerCase().includes(term) ||
          p.designation.toLowerCase().includes(term) ||
          p.department.toLowerCase().includes(term) ||
          p.phone.includes(term) ||
          p.email.toLowerCase().includes(term)
        )
      )
        return false;
      if (f.department && p.department !== f.department) return false;
      if (f.designation && p.designation !== f.designation) return false;
      if (f.employmentType && p.employmentType !== f.employmentType) return false;
      return true;
    });

    return list.slice().sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'department') return a.department.localeCompare(b.department);
      if (sortKey === 'designation') return a.designation.localeCompare(b.designation);
      if (sortKey === 'email') return a.email.localeCompare(b.email);
      return 0;
    });
  }, [query, filters, sortKey]);

  const setFilter = useCallback((key, value) => setFilters((f) => ({ ...f, [key]: value })), []);
  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const activeChips = useMemo(() => {
    const f = filters;
    const out = [];
    if (f.department) out.push({ label: `Dept: ${f.department}`, key: 'department' });
    if (f.designation) out.push({ label: f.designation, key: 'designation' });
    if (f.employmentType) out.push({ label: f.employmentType, key: 'employmentType' });
    return out;
  }, [filters]);

  const activeFilterCount = activeChips.length;
  const unfiltered = rows.length === STAFF_TOTAL && !query.trim();

  const resultCountLabel = unfiltered
    ? `${STAFF_TOTAL} staff`
    : query.trim() && rows.length === 0
      ? `No staff match '${query.trim()}'`
      : `Showing ${rows.length} of ${STAFF_TOTAL} staff`;

  const detailStaff = STAFF.find((p) => p.id === detailStaffId) ?? null;

  return {
    rows,
    resultCountLabel,
    query,
    setQuery,
    sortKey,
    setSortKey,
    sortLabel: SORTS.find((o) => o.key === sortKey).label,
    panel,
    setPanel,
    toggleSortMenu: () => setPanel((p) => (p === 'sort' ? null : 'sort')),
    toggleFilters: () => setPanel((p) => (p === 'filters' ? null : 'filters')),
    filtersOpen: panel === 'filters',
    sortMenuOpen: panel === 'sort',
    filters,
    setFilter,
    clearFilters,
    activeChips,
    activeFilterCount,
    detailStaff,
    openDetail: (id) => setDetailStaffId(id),
    closeDetail: () => setDetailStaffId(null),
    closeOverlays: () => setPanel(null),
    anyOverlayOpen: !!panel,
  };
}
