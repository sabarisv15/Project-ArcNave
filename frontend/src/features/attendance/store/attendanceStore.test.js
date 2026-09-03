import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useAttendanceStore } from './attendanceStore';
import { ATTENDANCE_PERIODS, INITIAL_SESSIONS, canLockClassLog } from '../lib/attendanceData';

// Toasts are a side effect of these actions, not their subject. Stubbed so
// the tests assert state transitions rather than notification text.
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

// P3 5.9 — direct tests for the Zustand store that replaced
// AttendanceProvider. These exist because the migration rewrote roughly
// fifteen actions by hand, and until now attendance had no test of its own
// at all: it was only ever exercised indirectly, through whole-app renders.
// A store is plain state and functions, so it can be tested without React,
// which is itself part of the argument for moving state out of context.
//
// Co-located with the feature rather than parked in src/test/, so the code
// and the proof it works move together — the point of grouping by feature.

const store = () => useAttendanceStore.getState();

// A period that starts life as an editable draft, so lock/submit have
// somewhere real to run.
const draftPeriodId = Object.keys(INITIAL_SESSIONS).find((id) => INITIAL_SESSIONS[id].attendanceStatus === 'draft');

describe('attendance store — baseline', () => {
  beforeEach(() => store().reset());

  it('starts from the fixture sessions', () => {
    expect(Object.keys(store().sessions).length).toBe(Object.keys(INITIAL_SESSIONS).length);
  });

  it('seeds acknowledgements only for periods the fixtures mark as acknowledged', () => {
    const expected = ATTENDANCE_PERIODS.filter((p) => p.substituteAcknowledged).map((p) => p.id);
    expect(Object.keys(store().acknowledged).sort()).toEqual([...expected].sort());
  });

  it('reset restores a clean slate after mutation', () => {
    // This is the behaviour AttendanceProvider got for free by unmounting
    // with its route subtree. A module-level store has to do it explicitly,
    // and if it ever stops doing it, a second visit to the section would
    // inherit the first visit's edits.
    store().requestLateSubmission(draftPeriodId);
    expect(store().sessions[draftPeriodId].lateSubmissionRequested).toBe(true);

    store().reset();
    expect(store().sessions[draftPeriodId].lateSubmissionRequested).toBeFalsy();
  });

  it('reset rebuilds requests rather than resharing the previous array', () => {
    const before = store().requests;
    store().reset();
    expect(store().requests).not.toBe(before);
  });
});

describe('attendance store — the record lifecycle', () => {
  beforeEach(() => store().reset());

  it('saveDraft records present/absent as Sets and stamps lastSavedAt', () => {
    store().saveDraft(draftPeriodId, { presentIds: ['s1', 's2'], absentIds: ['s3'] });
    const session = store().sessions[draftPeriodId];

    expect(session.presentIds).toBeInstanceOf(Set);
    expect(session.presentIds.has('s2')).toBe(true);
    expect(session.absentIds.has('s3')).toBe(true);
    expect(session.lastSavedAt).toBeInstanceOf(Date);
  });

  it('refuses to lock without a topic taught, but leaves the record otherwise untouched', () => {
    store().updateClassLog(draftPeriodId, { topicTaught: '   ' });
    expect(canLockClassLog(store().sessions[draftPeriodId].classLog)).toBe(false);

    store().lockAttendance(draftPeriodId);
    expect(store().sessions[draftPeriodId].attendanceStatus).not.toBe('locked');
  });

  it('locks once a topic has been taught', () => {
    store().updateClassLog(draftPeriodId, { topicTaught: 'Binary search trees' });
    store().lockAttendance(draftPeriodId);

    const session = store().sessions[draftPeriodId];
    expect(session.attendanceStatus).toBe('locked');
    expect(session.lockedBy).toBe('You');
    expect(session.lockedAt).toBeInstanceOf(Date);
  });

  it('updateClassLog never changes the attendance status — the log is editable after lock', () => {
    store().updateClassLog(draftPeriodId, { topicTaught: 'Graphs' });
    store().lockAttendance(draftPeriodId);
    store().updateClassLog(draftPeriodId, { notes: 'Covered traversal only' });

    const session = store().sessions[draftPeriodId];
    expect(session.attendanceStatus).toBe('locked');
    expect(session.classLog.notes).toBe('Covered traversal only');
    expect(session.classLogSavedAt).toBeInstanceOf(Date);
  });

  it('submitting marks the record as counting toward the percentage', () => {
    store().submitAttendance(draftPeriodId);
    const session = store().sessions[draftPeriodId];
    expect(session.attendanceStatus).toBe('submitted');
    expect(session.includedInPercentage).toBe(true);
  });

  it('will not raise a second correction request while one is still pending', () => {
    store().requestCorrection(draftPeriodId, { reason: 'Wrong student', items: [] });
    const first = store().sessions[draftPeriodId].correction;
    expect(first.status).toBe('pending');

    store().requestCorrection(draftPeriodId, { reason: 'Another', items: [] });
    expect(store().sessions[draftPeriodId].correction).toBe(first);
  });
});

describe('attendance store — substitute requests', () => {
  beforeEach(() => store().reset());

  const anyRequest = () => store().requests[0];

  it('accepting a duty does NOT acknowledge it — acknowledgement is a separate act', () => {
    const target = anyRequest();
    store().acceptRequest(target.id);

    const updated = store().requests.find((r) => r.id === target.id);
    expect(updated.status).toBe('accepted');
    expect(updated.acknowledgedAt).toBeNull();
  });

  it('acknowledging a request writes BOTH the request and the period permission', () => {
    // The one behaviour most at risk in this migration: the provider did
    // this with a setState nested inside another setState, which is now a
    // single atomic update. The two surfaces must never disagree.
    const withPeriod = store().requests.find((r) => r.periodId);
    expect(withPeriod).toBeTruthy();

    store().acknowledgeRequest(withPeriod.id);

    const updated = store().requests.find((r) => r.id === withPeriod.id);
    expect(updated.acknowledgedAt).toBeInstanceOf(Date);
    expect(store().acknowledged[withPeriod.periodId].acknowledgedAt).toEqual(updated.acknowledgedAt);
  });

  it('acknowledging a request with no period touches only the request', () => {
    const withoutPeriod = store().requests.find((r) => !r.periodId);
    const ackBefore = store().acknowledged;

    store().acknowledgeRequest(withoutPeriod.id);

    expect(store().requests.find((r) => r.id === withoutPeriod.id).acknowledgedAt).toBeInstanceOf(Date);
    expect(store().acknowledged).toEqual(ackBefore);
  });

  it('declining and cancelling resolve the request without acknowledging it', () => {
    const [a, b] = store().requests;
    store().declineRequest(a.id);
    store().cancelRequest(b.id);

    expect(store().requests.find((r) => r.id === a.id).status).toBe('declined');
    expect(store().requests.find((r) => r.id === b.id).status).toBe('cancelled');
  });

  it('refuses to create a request with no periods selected', () => {
    const before = store().requests.length;
    const ok = store().createSubstituteRequest({
      recipientMode: 'any',
      recipientCount: 3,
      slots: [],
      dateKey: '2026-09-02',
      scope: 'day',
    });

    expect(ok).toBe(false);
    expect(store().requests.length).toBe(before);
  });

  it('refuses an "any recipient" request when nobody is eligible', () => {
    const ok = store().createSubstituteRequest({
      recipientMode: 'any',
      recipientCount: 0,
      slots: [{ period: 1 }],
      dateKey: '2026-09-02',
      scope: 'day',
    });
    expect(ok).toBe(false);
  });

  it('refuses a specific request against a staff member who is not selectable', () => {
    const ok = store().createSubstituteRequest({
      recipientMode: 'specific',
      toStaffId: 'definitely-not-a-real-staff-id',
      slots: [{ period: 1 }],
      dateKey: '2026-09-02',
      scope: 'day',
    });
    expect(ok).toBe(false);
  });

  it('prepends an accepted request to the list when the draft is valid', () => {
    const before = store().requests.length;
    const ok = store().createSubstituteRequest({
      recipientMode: 'any',
      recipientCount: 2,
      slots: [{ period: 1 }],
      dateKey: '2026-09-02',
      scope: 'day',
      reason: 'Medical',
    });

    expect(ok).toBe(true);
    expect(store().requests.length).toBe(before + 1);
    expect(store().requests[0].direction).toBe('outgoing');
    expect(store().requests[0].reason).toBe('Medical');
  });
});

describe('attendance store — derived phase and the clock', () => {
  beforeEach(() => store().reset());

  it('returns null for a period that does not exist', () => {
    expect(store().phaseFor('no-such-period')).toBeNull();
  });

  it('derives a phase for a real period', () => {
    expect(store().phaseFor(draftPeriodId)).toBeTruthy();
  });

  it('tick advances the clock the phase calculation reads', () => {
    const before = store().now;
    store().tick();
    expect(store().now.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});
