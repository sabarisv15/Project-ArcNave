import { create } from 'zustand';
import { toast } from 'sonner';
import {
  ATTENDANCE_PERIODS,
  INITIAL_SESSIONS,
  PERIOD_BY_ID,
  getRecordPhase,
  canLockClassLog,
} from '../lib/attendanceData';
import { INCOMING_REQUESTS, ME, MY_REQUESTS, isStaffSelectable } from '@/lib/substituteData';
import { ACTIVE_VERSION_ID } from '@/lib/timetableData';

// P3 5.9 — the first slice of "shared state kept in React context" ->
// "a proper small state library". This is the same attendance state
// AttendanceProvider held, moved to Zustand with its behaviour
// preserved rather than reinterpreted.
//
// Why Zustand here and not React Query: every value in this store comes
// from the lib/attendanceData fixtures and is mutated locally by the
// user (draft edits, lock, submit, substitute requests). There is no
// server round trip to cache, so this is client state, which is exactly
// the split 5.9 is meant to establish — React Query owns server state,
// Zustand owns client state. The genuinely server-backed lists
// (WorkspaceProvider's chats/projects/artifacts) are the React Query
// half and are not touched by this slice.
//
// The public hook keeps the name and the shape it already had. Zustand's
// hook signature accepts an optional selector, so every existing
// `const { sessions, saveDraft } = useAttendanceStore()` call site keeps
// working untouched, while new code can subscribe narrowly with
// `useAttendanceStore((s) => s.sessions)` and avoid re-rendering on
// unrelated changes. That is the actual performance win, available
// incrementally instead of via one risky rewrite of every consumer.

const TICK_MS = 30000;

function initialAcknowledged() {
  return Object.fromEntries(
    ATTENDANCE_PERIODS.filter((p) => p.substituteAcknowledged).map((p) => [
      p.id,
      { acknowledgedAt: p.startTime, acknowledgedBy: 'You' },
    ]),
  );
}

function initialRequests() {
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
}

// Rebuilt fresh on every reset, never shared by reference — the old
// provider got this for free by remounting, and a module-level store
// has to be explicit about it or two visits would share mutated state.
function initialState() {
  return {
    now: new Date(),
    sessions: INITIAL_SESSIONS,
    acknowledged: initialAcknowledged(),
    requests: initialRequests(),
    timetableVersionId: ACTIVE_VERSION_ID,
  };
}

export const useAttendanceStore = create((set, get) => ({
  ...initialState(),

  // AttendanceProvider was mounted only under the /curriculum/attendance
  // route tree, so leaving and returning discarded all of this. A module
  // -level store would silently start persisting it instead — a real
  // behaviour change, so it is restored explicitly by the layout rather
  // than quietly adopted. See useAttendanceLifecycle.
  reset: () => set(initialState()),
  tick: () => set({ now: new Date() }),

  phaseFor: (periodId) => {
    const { sessions, now } = get();
    const period = PERIOD_BY_ID[periodId];
    const session = sessions[periodId];
    if (!period || !session) return null;
    return getRecordPhase(period, session, now);
  },

  /** Quiet autosave — no toast, just a fresh `lastSavedAt` for the inline "Saved" indicator. Class log fields save in the same record. */
  saveDraft: (periodId, { presentIds, absentIds, classLog }) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [periodId]: {
          ...state.sessions[periodId],
          presentIds: new Set(presentIds),
          absentIds: new Set(absentIds),
          classLog: classLog
            ? { ...state.sessions[periodId].classLog, ...classLog }
            : state.sessions[periodId].classLog,
          lastSavedAt: new Date(),
        },
      },
    })),

  /**
   * Class log topic/notes are editable independently of the attendance
   * record's own lifecycle — before Lock (via `saveDraft`) and, just as
   * importantly, after Locked/Submitted too. This never reopens, unlocks,
   * or recalculates attendance; it only ever touches `session.classLog`.
   */
  updateClassLog: (periodId, patch) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [periodId]: {
          ...state.sessions[periodId],
          classLog: { ...state.sessions[periodId].classLog, ...patch },
          classLogSavedAt: new Date(),
        },
      },
    })),

  /** Locking is refused without a topic taught — the same rule the UI checks before ever opening the confirm dialog. */
  lockAttendance: (periodId) => {
    const state = get();
    if (canLockClassLog(state.sessions[periodId].classLog)) {
      set({
        sessions: {
          ...state.sessions,
          [periodId]: {
            ...state.sessions[periodId],
            attendanceStatus: 'locked',
            lockedAt: new Date(),
            lockedBy: 'You',
          },
        },
      });
    }
    // Toast fires either way, exactly as the provider version did — the
    // guard above only decides whether the state moves.
    toast('Attendance and class log locked');
  },

  submitAttendance: (periodId) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [periodId]: {
          ...state.sessions[periodId],
          attendanceStatus: 'submitted',
          submittedAt: new Date(),
          submittedBy: 'You',
          includedInPercentage: true,
        },
      },
    }));
    toast('Attendance submitted');
  },

  requestLateSubmission: (periodId) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [periodId]: {
          ...state.sessions[periodId],
          lateSubmissionRequested: true,
          lateSubmissionRequestedAt: new Date(),
        },
      },
    }));
    toast('Late submission requested');
  },

  requestCorrection: (periodId, { reason, items }) => {
    set((state) => {
      const existing = state.sessions[periodId];
      if (existing.correction && existing.correction.status === 'pending') return state;
      return {
        sessions: {
          ...state.sessions,
          [periodId]: {
            ...existing,
            correction: {
              id: `corr-${periodId}-${Date.now()}`,
              status: 'pending',
              reason,
              items,
              requestedAt: new Date(),
              resolvedAt: null,
              resolutionNote: null,
            },
          },
        },
      };
    });
    toast('Correction request sent');
  },

  acknowledgeDuty: (periodId) => {
    set((state) => ({
      acknowledged: { ...state.acknowledged, [periodId]: { acknowledgedAt: new Date(), acknowledgedBy: 'You' } },
    }));
    toast('Substitute duty acknowledged');
  },

  // ---- Substitute requests -------------------------------------------------

  patchRequest: (id, patch) =>
    set((state) => ({ requests: state.requests.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

  /**
   * Accepting an incoming request assigns the duty — but it deliberately does
   * *not* acknowledge it. Acknowledgement is a separate, explicit act, and it
   * is what actually unlocks Mark attendance.
   */
  acceptRequest: (id) => {
    get().patchRequest(id, { status: 'accepted', resolvedAt: new Date(), acknowledgedAt: null });
    toast('Substitute duty accepted');
  },

  declineRequest: (id) => {
    get().patchRequest(id, { status: 'declined', resolvedAt: new Date() });
    toast('Substitute request declined');
  },

  cancelRequest: (id) => {
    get().patchRequest(id, { status: 'cancelled', resolvedAt: new Date() });
    toast('Substitute request cancelled');
  },

  /**
   * One acknowledgement record, two surfaces: the request row here and the
   * period's marking permission in Today's schedule. They can never disagree
   * because acknowledging the request writes both — done here in a single
   * `set`, rather than the provider's nested setState-inside-setState, which
   * was doing the same thing the only way the context API allowed.
   */
  acknowledgeRequest: (id) => {
    const at = new Date();
    set((state) => {
      const target = state.requests.find((r) => r.id === id);
      const next = {
        requests: state.requests.map((r) => (r.id === id ? { ...r, acknowledgedAt: at } : r)),
      };
      if (target && target.periodId) {
        next.acknowledged = {
          ...state.acknowledged,
          [target.periodId]: { acknowledgedAt: at, acknowledgedBy: 'You' },
        };
      }
      return next;
    });
    toast('Substitute duty acknowledged');
  },

  /**
   * Raising a request. Availability/conflict is re-checked here, not just in
   * the form, so a stale UI state (or a direct call) can't create a request
   * against a staff member who isn't genuinely eligible.
   */
  createSubstituteRequest: (draft) => {
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

    set((state) => ({
      requests: [
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
        ...state.requests,
      ],
    }));
    toast('Substitute request sent');
    return true;
  },

  setTimetableVersionId: (id) => set({ timetableVersionId: id }),
}));

export { TICK_MS };
