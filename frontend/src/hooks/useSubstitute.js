import { useMemo, useState } from 'react';
import { useAttendanceStore } from '../store/AttendanceProvider';
import { PERIOD_BY_ID, SUBSTITUTE_DUTIES } from '../lib/attendanceData';
import {
  LOG_ATTENDANCE_LABELS,
  SUBSTITUTE_LOG_HISTORY,
  dateFromDayKey,
  logFilterOptions,
  slotTimeRange,
} from '../lib/substituteData';
import { istDayKey } from '../lib/ist';
import { inDateRange } from '../lib/dateFilters';

/** Record phase → the substitute log's own attendance-state vocabulary. */
const PHASE_TO_LOG_STATE = {
  not_approved: 'not_marked',
  upcoming: 'upcoming',
  open: 'open',
  marking_missed: 'window_closed',
  locked_before_window: 'locked',
  locked_ready: 'ready',
  submitted: 'submitted',
  submission_expired: 'window_closed',
};

export const LOG_SORTS = [
  { key: 'recent', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'subject', label: 'Subject A–Z' },
  { key: 'staff', label: 'Original staff A–Z' },
];

/**
 * Everything the Substitute tab reads.
 *
 * The log is the periods actually *covered*, not the requests that produced
 * them: today's live duties come from the operational attendance data (so
 * their attendance and acknowledgement state is the same record Today's
 * schedule shows), and older covers come from the historical log. A pending
 * request is deliberately absent from the log — it granted nothing.
 */
export function useSubstitute() {
  const { now, phaseFor, sessions, acknowledged, requests } = useAttendanceStore();

  const [section, setSection] = useState('log');

  // --- My substitute log ---
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('recent');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [datePreset, setDatePreset] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [filters, setFilters] = useState({ subject: '', classCode: '', originalStaff: '', ack: '', state: '' });

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const clearFilters = () => {
    setFilters({ subject: '', classCode: '', originalStaff: '', ack: '', state: '' });
    setDatePreset('all');
    setCustomFrom('');
    setCustomTo('');
  };

  /** Live duties + history, normalised into one row shape. */
  const allEntries = useMemo(() => {
    const live = SUBSTITUTE_DUTIES.map((period) => {
      const ack = acknowledged[period.id];
      return {
        id: `live-${period.id}`,
        periodId: period.id,
        date: period.date,
        dateKey: istDayKey(period.date),
        timeRange: null, // resolved from the period's real instants at render time
        period,
        slot: { subject: period.subject, code: period.code },
        subject: period.subject,
        classCode: period.code,
        originalStaff: period.substituteFor,
        attendanceState: PHASE_TO_LOG_STATE[phaseFor(period.id)] ?? 'not_marked',
        acknowledged: !!ack,
        acknowledgedAt: ack?.acknowledgedAt ?? null,
      };
    });

    const history = SUBSTITUTE_LOG_HISTORY.map((e) => ({
      id: e.id,
      periodId: e.periodId,
      date: dateFromDayKey(e.dateKey),
      dateKey: e.dateKey,
      timeRange: slotTimeRange(e.slot),
      period: e.periodId ? (PERIOD_BY_ID[e.periodId] ?? null) : null,
      slot: e.slot,
      subject: e.slot.subject,
      classCode: e.slot.code,
      originalStaff: e.originalStaff,
      attendanceState: e.attendanceState,
      acknowledged: e.acknowledged,
      acknowledgedAt: e.acknowledged ? dateFromDayKey(e.dateKey) : null,
    }));

    // A live duty always wins over a history row for the same period.
    const liveIds = new Set(live.map((e) => e.periodId));
    return [...live, ...history.filter((e) => !e.periodId || !liveIds.has(e.periodId))];
  }, [phaseFor, acknowledged, sessions]);

  const options = useMemo(() => logFilterOptions(allEntries), [allEntries]);

  const entries = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows = allEntries.filter((e) => {
      if (!inDateRange(e.date, now, datePreset, customFrom, customTo)) return false;
      if (filters.subject && e.subject !== filters.subject) return false;
      if (filters.classCode && e.classCode !== filters.classCode) return false;
      if (filters.originalStaff && e.originalStaff !== filters.originalStaff) return false;
      if (filters.ack && (filters.ack === 'yes') !== e.acknowledged) return false;
      if (filters.state && e.attendanceState !== filters.state) return false;
      if (!term) return true;
      return [e.subject, e.classCode, e.originalStaff, LOG_ATTENDANCE_LABELS[e.attendanceState]]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term);
    });

    const byRecency = (a, b) => b.date - a.date || (b.slot.period ?? 0) - (a.slot.period ?? 0);
    if (sortKey === 'oldest') return rows.sort((a, b) => -byRecency(a, b));
    if (sortKey === 'subject') return rows.sort((a, b) => a.subject.localeCompare(b.subject) || byRecency(a, b));
    if (sortKey === 'staff')
      return rows.sort((a, b) => a.originalStaff.localeCompare(b.originalStaff) || byRecency(a, b));
    return rows.sort(byRecency);
  }, [allEntries, query, sortKey, now, datePreset, customFrom, customTo, filters]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length + (datePreset !== 'all' ? 1 : 0);

  // --- Requests ---
  const incoming = useMemo(
    () => requests.filter((r) => r.direction === 'incoming').sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
    [requests],
  );
  const outgoing = useMemo(
    () => requests.filter((r) => r.direction === 'outgoing').sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
    [requests],
  );

  /** Only accepted-but-unacknowledged duties genuinely need the staff member's attention. */
  const pendingAckCount = incoming.filter((r) => r.status === 'accepted' && !r.acknowledgedAt).length;
  const pendingIncomingCount = incoming.filter((r) => r.status === 'pending').length;

  return {
    section,
    setSection,
    now,
    query,
    setQuery,
    sortKey,
    setSortKey,
    filtersOpen,
    setFiltersOpen,
    datePreset,
    setDatePreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    filters,
    setFilter,
    clearFilters,
    activeFilterCount,
    options,
    entries,
    totalEntries: allEntries.length,
    incoming,
    outgoing,
    pendingAckCount,
    pendingIncomingCount,
  };
}
