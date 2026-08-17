import { describe, expect, it } from 'vitest';
import {
  BASELINE_TERM,
  COMMENCEMENT_CONSEQUENCES,
  classIndexOfTerm,
  classesOfTerm,
  closedTerm,
  isBaselineTerm,
  nextTermAfter,
  priorClassesOfTerm,
  reviewQueueOfTerm,
  seatsOfTerm,
  semestersOfTerm,
  timetableStatesOfTerm,
} from '../lib/academicTerm';
import { ACTIVE_CLASSES, ACTIVE_CLASS_BY_ID, BAND_SEMESTERS } from '../lib/academicCalendar';
import { CLASS_TUTOR_SEATS } from '../lib/seatState';
import { BASELINE_TIMETABLE_STATES } from '../lib/timetableState';
import { PRIOR_CLASSES, REVIEW_CANDIDATES } from '../lib/promotionData';
import { PROVISIONED_DEPARTMENTS } from '../lib/provisioning';

/**
 * The pure term layer.
 *
 * Two things are being proved here and they pull in opposite directions: that
 * the baseline term is *the fixture itself*, and that a commenced term is
 * genuinely different. Identity is asserted with `toBe` rather than `toEqual`
 * throughout the first half — an equal copy would still be a second source of
 * truth, which is the defect this whole arrangement exists to avoid.
 */

describe('Generation 0 is the fixture, by identity', () => {
  it('resolves the baseline classes, seats, timetables and queue as the same objects', () => {
    expect(isBaselineTerm(BASELINE_TERM)).toBe(true);
    expect(classesOfTerm(BASELINE_TERM)).toBe(ACTIVE_CLASSES);
    expect(classIndexOfTerm(BASELINE_TERM)).toBe(ACTIVE_CLASS_BY_ID);
    expect(seatsOfTerm(BASELINE_TERM)).toBe(CLASS_TUTOR_SEATS);
    expect(timetableStatesOfTerm(BASELINE_TERM)).toBe(BASELINE_TIMETABLE_STATES);
    expect(reviewQueueOfTerm(BASELINE_TERM)).toBe(REVIEW_CANDIDATES);
    expect(priorClassesOfTerm(BASELINE_TERM)).toBe(PRIOR_CLASSES);
  });

  it('reads its band and label off the academic year rather than restating them', () => {
    expect(semestersOfTerm(BASELINE_TERM)).toBe(BAND_SEMESTERS[BASELINE_TERM.band]);
  });
});

describe('A commencement flips the band and nothing below semester 3 exists', () => {
  it('alternates odd and even, and rolls the year over only out of an even term', () => {
    const even = { ...BASELINE_TERM, band: 'even', yearLabel: '2026–27' };
    const afterEven = nextTermAfter(even);
    expect(afterEven.band).toBe('odd');
    // An odd band opens a year, so leaving an even term is a new academic year.
    expect(afterEven.yearLabel).toBe('2027–28');

    const afterOdd = nextTermAfter(afterEven);
    expect(afterOdd.band).toBe('even');
    // The even band closes the year the odd band opened — same label.
    expect(afterOdd.yearLabel).toBe('2027–28');
  });

  it('never produces a semester below 3, however many times it is run', () => {
    let term = BASELINE_TERM;
    for (let i = 0; i < 6; i++) {
      term = nextTermAfter(term);
      expect(semestersOfTerm(term).every((s) => s >= 3)).toBe(true);
      classesOfTerm(term).forEach((c) => {
        expect(c.semester).toBeGreaterThanOrEqual(3);
        expect(c.year).toBeGreaterThanOrEqual(2);
      });
    }
  });

  it('derives the new term’s classes from the provisioning, not from a list', () => {
    const next = nextTermAfter(BASELINE_TERM);
    const classes = classesOfTerm(next);

    expect(classes).not.toBe(ACTIVE_CLASSES);
    expect(classes.length).toBeGreaterThan(0);
    // Every class belongs to a provisioned department and a section that
    // department actually runs — nothing is invented by the transition.
    classes.forEach((c) => {
      const dept = PROVISIONED_DEPARTMENTS.find((d) => d.id === c.departmentId);
      expect(dept).toBeTruthy();
      expect(dept.sections.some((s) => s.section === c.section)).toBe(true);
      expect(c.semester).toBeLessThanOrEqual(dept.durationYears * 2);
    });
  });

  it('advances the generation and closes the term it replaced', () => {
    const next = nextTermAfter(BASELINE_TERM);
    expect(next.generation).toBe(1);
    expect(next.state).toBe('active');
    expect(isBaselineTerm(next)).toBe(false);
    expect(closedTerm(BASELINE_TERM).state).toBe('completed');
  });
});

describe('A commenced term resets what the transition actually resets', () => {
  const next = nextTermAfter(BASELINE_TERM);

  it('derives exactly one seat per active class, and none of them held', () => {
    const classes = classesOfTerm(next);
    const seats = seatsOfTerm(next);

    // The rule stated both ways, so neither direction can drift.
    expect(seats).toHaveLength(classes.length);
    expect(new Set(seats.map((s) => s.classId))).toEqual(new Set(classes.map((c) => c.id)));
    expect(seats.every((s) => s.state !== 'active')).toBe(true);
    expect(seats.every((s) => s.holderId === null)).toBe(true);
  });

  it('keeps invite pending reachable, one per department, deterministically', () => {
    const seats = seatsOfTerm(next);
    const invited = seats.filter((s) => s.state === 'invite_pending');

    expect(invited.length).toBeGreaterThan(0);
    expect(new Set(invited.map((s) => s.departmentId)).size).toBe(invited.length);
    expect(invited.every((s) => Boolean(s.invitedEmail))).toBe(true);
    // Deterministic: the same commencement produces the same seats.
    expect(seatsOfTerm(nextTermAfter(BASELINE_TERM))).toEqual(seats);
  });

  it('starts every timetable at not submitted, which is what locks attendance', () => {
    const states = timetableStatesOfTerm(next);
    const classes = classesOfTerm(next);
    expect(Object.keys(states)).toHaveLength(classes.length);
    expect(Object.values(states).every((s) => s === 'not_submitted')).toBe(true);
  });

  it('produces a review queue for the band that just closed, and only that band', () => {
    const queue = reviewQueueOfTerm(next);
    const priorBandSemesters = BAND_SEMESTERS[BASELINE_TERM.band];

    expect(queue.length).toBeGreaterThan(0);
    expect(queue).not.toBe(REVIEW_CANDIDATES);
    queue.forEach((c) => {
      expect(priorBandSemesters).toContain(c.semester);
      expect(c.semester).toBeGreaterThanOrEqual(3);
    });
  });

  it('never mutates the baseline fixtures it derives from', () => {
    seatsOfTerm(next);
    classesOfTerm(next);
    reviewQueueOfTerm(next);

    expect(classesOfTerm(BASELINE_TERM)).toBe(ACTIVE_CLASSES);
    expect(seatsOfTerm(BASELINE_TERM)).toBe(CLASS_TUTOR_SEATS);
    expect(reviewQueueOfTerm(BASELINE_TERM)).toBe(REVIEW_CANDIDATES);
  });
});

describe('The commencement consequences are data', () => {
  it('states the eight facts the confirmation and the page both render', () => {
    expect(COMMENCEMENT_CONSEQUENCES).toHaveLength(8);
    COMMENCEMENT_CONSEQUENCES.forEach((c) => {
      expect(c.key).toBeTruthy();
      expect(c.title).toBeTruthy();
      expect(c.detail).toBeTruthy();
    });
    const keys = COMMENCEMENT_CONSEQUENCES.map((c) => c.key);
    expect(keys).toEqual([
      'band',
      'classes',
      'seats',
      'history',
      'review',
      'placement',
      'timetable',
      'attendance',
    ]);
  });

  it('says promotion is not automatic and attendance is not switched on', () => {
    const text = COMMENCEMENT_CONSEQUENCES.map((c) => `${c.title} ${c.detail}`).join(' ');
    expect(text).toMatch(/nothing is promoted automatically/i);
    expect(text).toMatch(/no seat switches it on/i);
    expect(text).toMatch(/head of department/i);
  });
});
