import { describe, expect, it } from 'vitest';
import { ACTIVE_CLASSES } from '../lib/academicCalendar';
import {
  CLASS_TUTOR_SEATS,
  HOD_SEATS,
  SEAT_STATES,
  classTutorSeat,
  hasClassTutor,
  hodCoverage,
  tutorCoverage,
} from '../lib/seatState';
import {
  ATTENDANCE_LIVE_TOTAL,
  CLASS_TIMETABLE_STATES,
  NOT_SUBMITTED_CLASS_IDS,
  PENDING_CLASS_IDS,
  attendanceLiveFor,
  attendanceLockReason,
  isTimetableReady,
  timetableStateOfClass,
} from '../lib/timetableState';
import { DEPT_CLASSES } from '../lib/departmentData';
import { INSTITUTION_SETUP } from '../lib/institutionSetupData';
import { PROVISIONED_DEPARTMENTS } from '../lib/provisioning';

describe('Class Tutor seats — one per active semester-section class', () => {
  it('produces exactly one seat per active class, and no seat without one', () => {
    expect(CLASS_TUTOR_SEATS).toHaveLength(ACTIVE_CLASSES.length);

    const classIds = ACTIVE_CLASSES.map((c) => c.id).sort();
    const seatClassIds = CLASS_TUTOR_SEATS.map((s) => s.classId).sort();
    expect(seatClassIds).toEqual(classIds);
    expect(new Set(seatClassIds).size).toBe(seatClassIds.length);
  });

  it('derives the seat total from the provisioned structure, not a fixture', () => {
    const expected = PROVISIONED_DEPARTMENTS.reduce(
      (sum, d) => sum + CLASS_TUTOR_SEATS.filter((s) => s.departmentId === d.id).length,
      0
    );
    expect(CLASS_TUTOR_SEATS).toHaveLength(expected);
  });

  it('has a real member in every seat state, so none is an unreachable branch', () => {
    const states = new Set(CLASS_TUTOR_SEATS.map((s) => s.state));
    Object.keys(SEAT_STATES).forEach((state) => expect(states).toContain(state));
  });

  it('keeps reassignment history on the seat, with who held it and why', () => {
    const withHistory = CLASS_TUTOR_SEATS.filter((s) => s.history.length > 0);
    expect(withHistory.length).toBeGreaterThan(0);
    withHistory.forEach((s) => {
      s.history.forEach((h) => {
        expect(h.holderId).toBeTruthy();
        expect(h.from).toBeTruthy();
        expect(h.to).toBeTruthy();
        expect(h.reason).toBeTruthy();
      });
    });
  });

  it('treats an outstanding invitation as not held', () => {
    const invited = CLASS_TUTOR_SEATS.filter((s) => s.state === 'invite_pending');
    expect(invited.length).toBeGreaterThan(0);
    invited.forEach((s) => {
      expect(s.holderId).toBeNull();
      expect(s.invitedEmail).toBeTruthy();
      expect(hasClassTutor(s.classId)).toBe(false);
    });

    const coverage = tutorCoverage();
    expect(coverage.active + coverage.invited + coverage.vacant).toBe(coverage.total);
    expect(coverage.active).toBe(CLASS_TUTOR_SEATS.filter((s) => s.state === 'active').length);
  });
});

describe('Seat state is the only source of tutor coverage', () => {
  it('is what the department screen reads', () => {
    DEPT_CLASSES.forEach((c) => {
      const seat = classTutorSeat(c.id);
      expect(c.seatState).toBe(seat.state);
      expect(c.tutorId).toBe(seat.state === 'active' ? seat.holderId : null);
    });
  });

  it('is what the institution readiness panel reads — the same numbers, once', () => {
    const coverage = tutorCoverage();
    expect(INSTITUTION_SETUP.counts.tutored).toBe(coverage.active);
    expect(INSTITUTION_SETUP.counts.untutored).toBe(coverage.vacant + coverage.invited);
    expect(INSTITUTION_SETUP.counts.classCount).toBe(coverage.total);
  });

  it('counts head-of-department seats on the same rule', () => {
    const coverage = hodCoverage();
    expect(coverage.total).toBe(HOD_SEATS.length);
    expect(coverage.active + coverage.invited + coverage.vacant).toBe(coverage.total);
    expect(INSTITUTION_SETUP.counts.withHod).toBe(coverage.active);
    expect(INSTITUTION_SETUP.counts.invited).toBe(coverage.invited);
    expect(INSTITUTION_SETUP.counts.vacancies).toBe(coverage.vacant);
  });
});

describe('Attendance derives from the timetable, never from a seat', () => {
  it('is live only where the class timetable is approved', () => {
    CLASS_TIMETABLE_STATES.forEach((c) => {
      expect(c.attendanceLive).toBe(c.state === 'approved');
    });
    expect(ATTENDANCE_LIVE_TOTAL).toBe(
      CLASS_TIMETABLE_STATES.filter((c) => c.state === 'approved').length
    );
  });

  it('is unavailable without an active academic year, however many grids are approved', () => {
    CLASS_TIMETABLE_STATES.forEach((c) => {
      expect(attendanceLiveFor(c.classId, false)).toBe(false);
    });
  });

  /**
   * The rule this separation exists for. Holding a class's seat says nothing
   * about its timetable, and vice versa — so a tutored class with an
   * unapproved grid has no attendance, and an approved grid opens attendance
   * whether or not anybody holds the seat.
   */
  it('never unlocks attendance because a Class Tutor was assigned', () => {
    const tutoredButLocked = ACTIVE_CLASSES.filter(
      (c) => hasClassTutor(c.id) && !attendanceLiveFor(c.id)
    );
    expect(tutoredButLocked.length).toBeGreaterThan(0);

    const liveButUncovered = ACTIVE_CLASSES.filter(
      (c) => !hasClassTutor(c.id) && attendanceLiveFor(c.id)
    );
    expect(liveButUncovered.length).toBeGreaterThan(0);
  });

  it('says why it is locked rather than rendering an empty register', () => {
    NOT_SUBMITTED_CLASS_IDS.forEach((id) => {
      expect(timetableStateOfClass(id)).toBe('not_submitted');
      expect(attendanceLockReason(id)).toMatch(/submitted and approved/i);
    });
    PENDING_CLASS_IDS.forEach((id) => {
      expect(attendanceLockReason(id)).toMatch(/under review/i);
    });
    const approved = ACTIVE_CLASSES.find((c) => timetableStateOfClass(c.id) === 'approved');
    expect(attendanceLockReason(approved.id)).toBeNull();
  });

  it('keeps a class with a revision in review timetable-ready but not settled', () => {
    PENDING_CLASS_IDS.forEach((id) => {
      expect(isTimetableReady(id)).toBe(true);
      expect(attendanceLiveFor(id)).toBe(false);
    });
  });
});
