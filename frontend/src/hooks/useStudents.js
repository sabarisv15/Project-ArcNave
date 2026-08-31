import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CLASS_BY_ID,
  DEFAULT_EXPORT_COLUMNS,
  EXPORT_COLUMNS,
  SCOPE_TOTAL,
  SORTS,
  STAFF_CLASSES,
  STUDENTS,
  academicOptionLabel,
  attendanceRangeLabel,
  defaultScope,
  slug,
} from '../lib/studentsData';

const EMPTY_FILTERS = {
  dept: '',
  section: '',
  batch: '',
  gender: '',
  entry: '',
  accom: '',
  attendance: '',
  feedue: '',
  acad: '',
  cgpaMin: '',
  arrearsMin: '',
  arrearsMax: '',
  attMin: '',
  attMax: '',
};

/** Persisted so the selection hint is a first-visit-only onboarding cue. */
const HINT_KEY = 'arcnave.students.notifyHintSeen';

/**
 * All Students state in one place: class scope first, then search / sort / filters /
 * selection / export. Filters always refine the *selected class scope*; "All my
 * students" is the only view that spans the staff member's classes.
 */
export function useStudents() {
  const [scope, setScope] = useState(defaultScope);
  const [lastClassScope, setLastClassScope] = useState(defaultScope);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [panel, setPanel] = useState(null); // 'sort' | 'filters' | null
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportColumns, setExportColumns] = useState(DEFAULT_EXPORT_COLUMNS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selected, setSelected] = useState({});
  const [detailStudentId, setDetailStudentId] = useState(null);
  const [statusPopoverId, setStatusPopoverId] = useState(null);
  const [rowMenuId, setRowMenuId] = useState(null);
  const [settling, setSettling] = useState(true); // drives the row reveal
  const [scopeTick, setScopeTick] = useState(0);
  const [notifyHintOpen, setNotifyHintOpen] = useState(() => {
    try {
      return !localStorage.getItem(HINT_KEY);
    } catch {
      return false;
    }
  });
  const timer = useRef(null);
  const hintTimer = useRef(null);

  const dismissNotifyHint = useCallback(() => {
    setNotifyHintOpen(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* storage unavailable — the hint simply shows once per session */
    }
  }, []);

  // First visit only: one non-blocking callout that fades away on its own.
  useEffect(() => {
    if (!notifyHintOpen) return undefined;
    hintTimer.current = setTimeout(dismissNotifyHint, 6500);
    return () => clearTimeout(hintTimer.current);
  }, [notifyHintOpen, dismissNotifyHint]);

  useEffect(() => {
    const t = setTimeout(() => setSettling(false), 600);
    return () => {
      clearTimeout(t);
      clearTimeout(timer.current);
      clearTimeout(hintTimer.current);
    };
  }, []);

  const scopeIsAll = scope === 'all';
  const scopeClass = scopeIsAll ? null : CLASS_BY_ID[scope];

  /** Switching class re-scopes the table, clears selection and re-runs the settle. */
  const selectScope = useCallback(
    (id) => {
      if (scope === id) return;
      setScope(id);
      if (id !== 'all') setLastClassScope(id);
      setSelected({});
      setStatusPopoverId(null);
      setRowMenuId(null);
      setExportMenuOpen(false);
      setScopeTick((n) => n + 1);
      setSettling(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSettling(false), 420);
    },
    [scope],
  );

  const scopePool = useMemo(() => {
    if (scopeIsAll) return STUDENTS;
    const ids = new Set(CLASS_BY_ID[scope].studentIds);
    return STUDENTS.filter((s) => ids.has(s.id));
  }, [scope, scopeIsAll]);

  const scopeTotal = scopeIsAll ? SCOPE_TOTAL : scopePool.length;

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const f = filters;
    const list = scopePool.filter((s) => {
      if (
        term &&
        !(
          s.name.toLowerCase().includes(term) ||
          s.roll.toLowerCase().includes(term) ||
          s.rollNo.includes(term) ||
          s.phone.includes(term) ||
          s.guardianPhone.includes(term)
        )
      )
        return false;
      if (f.dept && s.dept !== f.dept) return false;
      if (f.section && s.section !== f.section) return false;
      if (f.batch && String(s.batch) !== f.batch) return false;
      if (f.gender && s.gender !== f.gender) return false;
      if (f.entry && s.entry !== f.entry) return false;
      if (f.accom && s.accom !== f.accom) return false;
      if (f.feedue && (f.feedue === 'yes' ? !s.feeDue : s.feeDue)) return false;
      if (f.attendance === 'below75' && !(s.attendance < 75)) return false;
      if (f.attendance === '75to85' && !(s.attendance >= 75 && s.attendance < 85)) return false;
      if (f.attendance === 'above85' && !(s.attendance >= 85)) return false;
      if (f.acad === 'clear' && !(s.backlogCount === 0 && !s.hasPending)) return false;
      if (f.acad === 'backlog' && !(s.backlogCount > 0)) return false;
      if (f.acad === 'pending' && !s.hasPending) return false;
      if (f.cgpaMin !== '' && !(parseFloat(s.cgpa) >= parseFloat(f.cgpaMin))) return false;
      if (f.arrearsMin !== '' && !(s.backlogCount >= parseInt(f.arrearsMin, 10))) return false;
      if (f.arrearsMax !== '' && !(s.backlogCount < parseInt(f.arrearsMax, 10))) return false;
      if (f.attMin !== '' && !(s.attendance >= parseFloat(f.attMin))) return false;
      if (f.attMax !== '' && !(s.attendance < parseFloat(f.attMax))) return false;
      return true;
    });

    return list.slice().sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'roll') return a.roll.localeCompare(b.roll);
      if (sortKey === 'attendance_asc') return a.attendance - b.attendance;
      if (sortKey === 'attendance_desc') return b.attendance - a.attendance;
      return 0;
    });
  }, [scopePool, query, filters, sortKey]);

  const setFilter = useCallback((key, value) => setFilters((f) => ({ ...f, [key]: value })), []);
  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setAdvancedOpen(false);
  }, []);

  const activeChips = useMemo(() => {
    const f = filters;
    const chip = (label, key) => ({ label, key });
    const out = [];
    if (f.dept) out.push(chip(`Dept: ${f.dept}`, 'dept'));
    if (f.section) out.push(chip(`Section ${f.section}`, 'section'));
    if (f.attendance) out.push(chip(`Attendance: ${attendanceRangeLabel(f.attendance)}`, 'attendance'));
    if (f.feedue) out.push(chip(`Fee: ${f.feedue === 'yes' ? 'Due' : 'No fee due'}`, 'feedue'));
    if (f.acad) out.push(chip(`Academic: ${academicOptionLabel(f.acad)}`, 'acad'));
    if (f.cgpaMin) out.push(chip(`CGPA ≥ ${f.cgpaMin}`, 'cgpaMin'));
    if (f.arrearsMin) out.push(chip(`Backlogs ≥ ${f.arrearsMin}`, 'arrearsMin'));
    if (f.arrearsMax) out.push(chip(`Backlogs < ${f.arrearsMax}`, 'arrearsMax'));
    if (f.attMin) out.push(chip(`Attendance ≥ ${f.attMin}%`, 'attMin'));
    if (f.attMax) out.push(chip(`Attendance < ${f.attMax}%`, 'attMax'));
    if (f.batch) out.push(chip(`Batch ${f.batch}`, 'batch'));
    if (f.entry) out.push(chip(f.entry, 'entry'));
    if (f.accom) out.push(chip(f.accom, 'accom'));
    if (f.gender) out.push(chip(f.gender, 'gender'));
    return out;
  }, [filters]);

  const activeFilterCount = activeChips.length;

  const selectedIds = useMemo(() => Object.keys(selected), [selected]);
  const selectedCount = selectedIds.length;
  const allSelected = rows.length > 0 && rows.every((r) => selected[r.id]);
  const someSelected = rows.some((r) => selected[r.id]);

  const toggleRow = useCallback((id) => {
    dismissNotifyHint();
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    dismissNotifyHint();
    if (allSelected) {
      setSelected({});
      return;
    }
    setSelected(Object.fromEntries(rows.map((r) => [r.id, true])));
  }, [allSelected, rows]);

  const clearSelection = useCallback(() => setSelected({}), []);

  const scopeLabel = scopeIsAll
    ? `All my students · ${STAFF_CLASSES.length} classes`
    : `${scopeClass.code} · ${scopeClass.subject}`;

  const exportFileName = (ext) =>
    `arcnave-students-${scopeIsAll ? 'all-my-classes' : `${slug(scopeClass.code)}-${slug(scopeClass.subject)}`}.${ext}`;

  const columnList =
    EXPORT_COLUMNS.filter(([key]) => exportColumns[key])
      .map(([, label]) => label)
      .join(', ') || 'none';

  const runExport = (ext) => {
    toast(`Exporting ${rows.length} student(s) from ${scopeLabel} → ${exportFileName(ext)} — columns: ${columnList}`);
    setExportMenuOpen(false);
  };

  const unfiltered = rows.length === scopeTotal;
  const resultCountLabel = scopeIsAll
    ? unfiltered
      ? `${scopeTotal} students across ${STAFF_CLASSES.length} assigned classes`
      : `Showing ${rows.length} of ${scopeTotal} students`
    : unfiltered
      ? `${scopeTotal} students in ${scopeClass.code}`
      : `Showing ${rows.length} of ${scopeTotal} students`;

  const detailStudent = STUDENTS.find((s) => s.id === detailStudentId) ?? null;

  return {
    // scope
    scope,
    scopeIsAll,
    scopeClass,
    scopeTotal,
    scopeLabel,
    lastClassScope,
    selectScope,
    scopeTick,
    classes: STAFF_CLASSES,
    scopeUniqueTotal: SCOPE_TOTAL,
    // list
    rows,
    resultCountLabel,
    settling,
    // search / sort
    query,
    setQuery,
    sortKey,
    setSortKey,
    sortLabel: SORTS.find((o) => o.key === sortKey).label,
    // panels
    panel,
    setPanel,
    toggleSortMenu: () => setPanel((p) => (p === 'sort' ? null : 'sort')),
    toggleFilters: () => setPanel((p) => (p === 'filters' ? null : 'filters')),
    filtersOpen: panel === 'filters',
    sortMenuOpen: panel === 'sort',
    // filters
    filters,
    setFilter,
    clearFilters,
    activeChips,
    activeFilterCount,
    advancedOpen,
    setAdvancedOpen,
    // selection
    selected,
    selectedIds,
    selectedCount,
    allSelected,
    someSelected,
    toggleRow,
    toggleSelectAll,
    clearSelection,
    notifyHintOpen: notifyHintOpen && selectedCount === 0,
    dismissNotifyHint,
    notifySelected: () => {
      if (!selectedCount) return;
      toast(`Notification queued for ${selectedCount} student(s) in ${scopeLabel}.`);
    },
    exportSelected: () =>
      toast(`Exporting ${selectedCount} selected student(s) from ${scopeLabel} — columns: ${columnList}`),
    // export menu
    exportMenuOpen,
    setExportMenuOpen,
    exportColumns,
    toggleExportColumn: (key) => setExportColumns((c) => ({ ...c, [key]: !c[key] })),
    exportAsCsv: () => runExport('csv'),
    exportAsExcel: () => runExport('xlsx'),
    exportSummary: `Export ${rows.length} student${rows.length === 1 ? '' : 's'} — ${
      scopeIsAll ? 'all my classes' : `${scopeClass.code} · ${scopeClass.subject}`
    }`,
    // overlays
    statusPopoverId,
    setStatusPopoverId,
    rowMenuId,
    setRowMenuId,
    detailStudent,
    openDetail: (id) => {
      setDetailStudentId(id);
      setStatusPopoverId(null);
      setRowMenuId(null);
    },
    closeDetail: () => setDetailStudentId(null),
    closeOverlays: () => {
      setStatusPopoverId(null);
      setRowMenuId(null);
      setExportMenuOpen(false);
      setPanel((p) => (p === 'sort' ? null : p));
    },
    anyOverlayOpen: !!(statusPopoverId || rowMenuId || exportMenuOpen || panel === 'sort'),
  };
}
