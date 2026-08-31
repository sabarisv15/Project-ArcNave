import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ATTENDANCE_PERIODS,
  INITIAL_SESSIONS,
  PERIOD_BY_ID,
  getRecordPhase,
  canLockClassLog,
} from '../lib/attendanceData';
import { INCOMING_REQUESTS, ME, MY_REQUESTS, isStaffSelectable } from '../lib/substituteData';
import { ACTIVE_VERSION_ID } from '../lib/timetableData';

const AttendanceContext = createContext(null);

const TICK_MS = 30000;

/**
 * Shared attendance state for the queue, history, and the focused Mark
 * Attendance route — a ticking clock (so the Locked → submission-window →
 * expired transitions move live without a page reload) plus the mutable
 * session/correction/acknowledgment state, scoped to the
 * `/curriculum/attendance/*` route tree.
 *
 * Draft edits autosave quietly (no toast per toggle — only a quiet inline
 * "Saved" indicator); Lock, Submit, and correction requests are the only
 * actions that raise a toast, matching the "calm, non-disruptive feedback"
 * rule.
 */
export function AttendanceProvider({ children }) {
  const [now, setNow] = useState(() => new Date());
  const [sessions, setSessions] = useState(INITIAL_SESSIONS);
  // { [periodId]: { acknowledgedAt, acknowledgedBy } } — an audit trail, not a bare boolean, per the mandatory-acknowledgment rule.
  const [acknowledged, setAcknowledged] = useState(() =>
    Object.fromEntries(
      ATTENDANCE_PERIODS.filter((p) => p.substituteAcknowledged).map((p) => [
        p.id,
        { acknowledgedAt: p.startTime, acknowledgedBy: 'You' },
      ]),
    ),
  );
  const [requests, setRequests] = useState(() => {
    const seedAck = (r) =>
      r.direction === 'incoming' && r.status === 'accepted' && r.periodId
        ? {
            ...r,
            acknowledgedAt: ATTENDANCE_PERIODS.find((p) => p.id === r.periodId)?.substituteAcknowledged
              ? new Date()
              : null,
          }
        : { ...r, acknowledgedAt: null };
    return [...INCOMING_REQUESTS, ...MY_REQUESTS].map(seedAck);
  });

  /**
   * The timetable version both the Timetable grid and the Workload view read.
   * Holding it here (not per-route) is what guarantees the grid and the derived
   * workload can never be showing different versions at the same time. It
   * follows the active version whenever a newly approved one takes over,
   * unless the staff member has deliberately selected an older one to view.
   */
  const [timetableVersionId, setTimetableVersionId] = useState(ACTIVE_VERSION_ID);
  useEffect(() => {
    setTimetableVersionId(ACTIVE_VERSION_ID);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const phaseFor = useCallback(
    (periodId) => {
      const period = PERIOD_BY_ID[periodId];
      const session = sessions[periodId];
      if (!period || !session) return null;
      return getRecordPhase(period, session, now);
    },
    [sessions, now],
  );

  /** Quiet autosave — no toast, just a fresh `lastSavedAt` for the inline "Saved" indicator. Class log fields save in the same record. */
  const saveDraft = useCallback((periodId, { presentIds, absentIds, classLog }) => {
    setSessions((prev) => ({
      ...prev,
      [periodId]: {
        ...prev[periodId],
        presentIds: new Set(presentIds),
        absentIds: new Set(absentIds),
        classLog: classLog ? { ...prev[periodId].classLog, ...classLog } : prev[periodId].classLog,
        lastSavedAt: new Date(),
      },
    }));
  }, []);

  /**
   * Class log topic/notes are editable independently of the attendance
   * record's own lifecycle — before Lock (via `saveDraft`) and, just as
   * importantly, after Locked/Submitted too. This never reopens, unlocks,
   * or recalculates attendance; it only ever touches `session.classLog`.
   * Quiet autosave — no toast, just a fresh `classLogSavedAt` for the
   * inline "Saved" indicator.
   */
  const updateClassLog = useCallback((periodId, patch) => {
    setSessions((prev) => ({
      ...prev,
      [periodId]: {
        ...prev[periodId],
        classLog: { ...prev[periodId].classLog, ...patch },
        classLogSavedAt: new Date(),
      },
    }));
  }, []);

  /** Locking is refused without a topic taught — the same rule the UI checks before ever opening the confirm dialog. */
  const lockAttendance = useCallback((periodId) => {
    setSessions((prev) => {
      if (!canLockClassLog(prev[periodId].classLog)) return prev;
      return {
        ...prev,
        [periodId]: { ...prev[periodId], attendanceStatus: 'locked', lockedAt: new Date(), lockedBy: 'You' },
      };
    });
    toast('Attendance and class log locked');
  }, []);

  const submitAttendance = useCallback((periodId) => {
    setSessions((prev) => ({
      ...prev,
      [periodId]: {
        ...prev[periodId],
        attendanceStatus: 'submitted',
        submittedAt: new Date(),
        submittedBy: 'You',
        includedInPercentage: true,
      },
    }));
    toast('Attendance submitted');
  }, []);

  const requestLateSubmission = useCallback((periodId) => {
    setSessions((prev) => ({
      ...prev,
      [periodId]: { ...prev[periodId], lateSubmissionRequested: true, lateSubmissionRequestedAt: new Date() },
    }));
    toast('Late submission requested');
  }, []);

  const requestCorrection = useCallback((periodId, { reason, items }) => {
    setSessions((prev) => {
      const existing = prev[periodId];
      if (existing.correction && existing.correction.status === 'pending') return prev;
      const correction = {
        id: `corr-${periodId}-${Date.now()}`,
        status: 'pending',
        reason,
        items,
        requestedAt: new Date(),
        resolvedAt: null,
        resolutionNote: null,
      };
      return { ...prev, [periodId]: { ...existing, correction } };
    });
    toast('Correction request sent');
  }, []);

  const acknowledgeDuty = useCallback((periodId) => {
    setAcknowledged((prev) => ({ ...prev, [periodId]: { acknowledgedAt: new Date(), acknowledgedBy: 'You' } }));
    toast('Substitute duty acknowledged');
  }, []);

  // ---- Substitute requests -------------------------------------------------

  const patchRequest = useCallback((id, patch) => {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  /**
   * Accepting an incoming request assigns the duty — but it deliberately does
   * *not* acknowledge it. Acknowledgement is a separate, explicit act, and it
   * is what actually unlocks Mark attendance.
   */
  const acceptRequest = useCallback(
    (id) => {
      patchRequest(id, { status: 'accepted', resolvedAt: new Date(), acknowledgedAt: null });
      toast('Substitute duty accepted');
    },
    [patchRequest],
  );

  const declineRequest = useCallback(
    (id) => {
      patchRequest(id, { status: 'declined', resolvedAt: new Date() });
      toast('Substitute request declined');
    },
    [patchRequest],
  );

  const cancelRequest = useCallback(
    (id) => {
      patchRequest(id, { status: 'cancelled', resolvedAt: new Date() });
      toast('Substitute request cancelled');
    },
    [patchRequest],
  );

  /**
   * One acknowledgement record, two surfaces: the request row here and the
   * period's marking permission in Today's schedule. They can never disagree
   * because acknowledging the request writes both.
   */
  const acknowledgeRequest = useCallback((id) => {
    const at = new Date();
    setRequests((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (r.periodId)
          setAcknowledged((ack) => ({ ...ack, [r.periodId]: { acknowledgedAt: at, acknowledgedBy: 'You' } }));
        return { ...r, acknowledgedAt: at };
      }),
    );
    toast('Substitute duty acknowledged');
  }, []);

  /**
   * Raising a request. Availability/conflict is re-checked here, not just in
   * the form, so a stale UI state (or a direct call) can't create a request
   * against a staff member who isn't genuinely eligible.
   */
  const createSubstituteRequest = useCallback((draft) => {
    const periodNumbers = draft.slots.map((s) => s.period);
    if (draft.recipientMode === 'specific') {
      if (!draft.toStaffId || !isStaffSelectable(draft.dateKey, periodNumbers, draft.toStaffId)) {
        toast.error('That staff member is not available for these periods');
        return false;
      }
    } else if (!draft.recipientCount) {
      toast.error('No eligible staff are free for these periods');
      return false;
    }
    if (draft.slots.length === 0) {
      toast.error('Select at least one period to request cover for');
      return false;
    }

    setRequests((prev) => [
      {
        id: `req-out-${Date.now()}`,
        direction: 'outgoing',
        fromStaff: ME.name,
        fromStaffId: ME.id,
        recipientMode: draft.recipientMode,
        toStaffId: draft.recipientMode === 'specific' ? draft.toStaffId : null,
        recipientCount: draft.recipientMode === 'specific' ? 1 : draft.recipientCount,
        dateKey: draft.dateKey,
        scope: draft.scope,
        slots: draft.slots,
        reason: draft.reason || '',
        status: 'pending',
        createdAt: new Date(),
        resolvedAt: null,
        acceptedBy: null,
        periodId: null,
        acknowledgedAt: null,
      },
      ...prev,
    ]);
    toast('Substitute request sent');
    return true;
  }, []);

  const value = useMemo(
    () => ({
      now,
      sessions,
      phaseFor,
      saveDraft,
      lockAttendance,
      submitAttendance,
      requestLateSubmission,
      requestCorrection,
      updateClassLog,
      acknowledged,
      acknowledgeDuty,
      requests,
      acceptRequest,
      declineRequest,
      cancelRequest,
      acknowledgeRequest,
      createSubstituteRequest,
      timetableVersionId,
      setTimetableVersionId,
    }),
    [
      now,
      sessions,
      phaseFor,
      saveDraft,
      lockAttendance,
      submitAttendance,
      requestLateSubmission,
      requestCorrection,
      updateClassLog,
      acknowledged,
      acknowledgeDuty,
      requests,
      acceptRequest,
      declineRequest,
      cancelRequest,
      acknowledgeRequest,
      createSubstituteRequest,
      timetableVersionId,
    ],
  );

  return <AttendanceContext.Provider value={value}>{children}</AttendanceContext.Provider>;
}

export function useAttendanceStore() {
  const ctx = useContext(AttendanceContext);
  if (!ctx) throw new Error('useAttendanceStore must be used inside AttendanceProvider');
  return ctx;
}
