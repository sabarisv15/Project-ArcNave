import { useCallback, useMemo, useState } from 'react';
import { ATTENDANCE_THRESHOLD, LEDGER_SUBJECTS, buildSubjectLedger } from '../lib/attendanceLedger';
import { DATE_PRESETS } from '../lib/dateFilters';
import { useAttendanceStore } from '../store/AttendanceProvider';

const SORTS = [
  { key: 'risk', label: 'Lowest attendance first' },
  { key: 'name', label: 'Student name A–Z' },
  { key: 'roll', label: 'Roll number' },
  { key: 'absent', label: 'Most absent hours' },
];

const EMPTY_FILTERS = { ownership: '', threshold: '' };

/**
 * State for the Attendance history tab's subject ledger: which subject is in
 * scope, the student search/sort/filters, and which student's absence detail
 * is open. Defaults to the most recently taught subject and to an at-risk-first
 * sort, because "who is falling behind" is the question this view exists for.
 */
export function useAttendanceLedger() {
  const { now } = useAttendanceStore();
  const [subjectKey, setSubjectKey] = useState(() => LEDGER_SUBJECTS[0]?.key ?? null);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState(null); // 'filters' | null
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [datePreset, setDatePreset] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sortKey, setSortKey] = useState('risk');
  const [selectedStudentId, setSelectedStudentId] = useState(null);

  /** Ownership filters the *subject list*, not students — ownership is a property of the allocation. */
  const subjects = useMemo(
    () => LEDGER_SUBJECTS.filter((s) => !filters.ownership || s.ownership === filters.ownership),
    [filters.ownership]
  );

  // If the ownership filter hides the selected subject, fall back to the first visible one.
  const activeKey = subjects.some((s) => s.key === subjectKey) ? subjectKey : subjects[0]?.key ?? null;

  const ledger = useMemo(
    () => (activeKey ? buildSubjectLedger(activeKey, { now, datePreset, customFrom, customTo }) : null),
    [activeKey, now, datePreset, customFrom, customTo]
  );

  const students = useMemo(() => {
    if (!ledger) return [];
    const term = query.trim().toLowerCase();
    const filtered = ledger.students.filter((s) => {
      if (filters.threshold === 'below' && s.percentage >= ATTENDANCE_THRESHOLD) return false;
      if (filters.threshold === 'meets' && s.percentage < ATTENDANCE_THRESHOLD) return false;
      if (!term) return true;
      return [s.name, s.roll, s.registerNumber].filter(Boolean).join(' ').toLowerCase().includes(term);
    });

    const sorted = [...filtered];
    if (sortKey === 'risk') sorted.sort((a, b) => a.percentage - b.percentage || a.name.localeCompare(b.name));
    else if (sortKey === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortKey === 'roll') sorted.sort((a, b) => a.roll.localeCompare(b.roll, undefined, { numeric: true }));
    else if (sortKey === 'absent') sorted.sort((a, b) => b.absentHours - a.absentHours || a.name.localeCompare(b.name));
    return sorted;
  }, [ledger, query, filters.threshold, sortKey]);

  const setFilter = useCallback((key, value) => setFilters((f) => ({ ...f, [key]: value })), []);
  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setDatePreset('all');
    setCustomFrom('');
    setCustomTo('');
  }, []);

  const activeChips = useMemo(() => {
    const chips = [];
    if (filters.ownership) chips.push({ key: 'ownership', label: filters.ownership === 'own' ? 'My class' : 'Substitute duty' });
    if (filters.threshold) {
      chips.push({ key: 'threshold', label: filters.threshold === 'below' ? `Below ${ATTENDANCE_THRESHOLD}%` : `Meets ${ATTENDANCE_THRESHOLD}%` });
    }
    if (datePreset !== 'all') chips.push({ key: 'date', label: DATE_PRESETS.find((p) => p.key === datePreset)?.label });
    return chips;
  }, [filters, datePreset]);

  const removeChip = useCallback((key) => {
    if (key === 'date') { setDatePreset('all'); setCustomFrom(''); setCustomTo(''); return; }
    setFilter(key, '');
  }, [setFilter]);

  const selectedStudent = useMemo(
    () => (selectedStudentId ? ledger?.students.find((s) => s.id === selectedStudentId) ?? null : null),
    [ledger, selectedStudentId]
  );

  return {
    now, subjects, subjectKey: activeKey, setSubjectKey, ledger, students,
    query, setQuery,
    panel, setPanel,
    filtersOpen: panel === 'filters',
    filters, setFilter, clearFilters, activeChips, activeFilterCount: activeChips.length, removeChip,
    datePreset, setDatePreset, customFrom, setCustomFrom, customTo, setCustomTo,
    sortKey, setSortKey,
    selectedStudent,
    openStudent: setSelectedStudentId,
    closeStudent: () => setSelectedStudentId(null),
    resultCountLabel: ledger
      ? students.length === ledger.students.length
        ? `${students.length} students`
        : `${students.length} of ${ledger.students.length} students`
      : '',
  };
}

export { SORTS as LEDGER_SORTS };
