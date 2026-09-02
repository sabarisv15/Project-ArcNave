import { act, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AcademicTermProvider, useAcademicTerm } from '../store/AcademicTermProvider';
import { AcademicRosterProvider, useAcademicRoster } from '../store/AcademicRosterProvider';
import { InstitutionalLifecycleProvider, useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';
import { ACTIVE_CLASSES, BAND_SEMESTERS } from '../lib/academicCalendar';
import { CLASS_TUTOR_SEATS } from '../lib/seatState';
import { REVIEW_CANDIDATES } from '../lib/promotionData';
import { DEPARTMENT_ID } from '../lib/departmentData';
import { renderApp as renderAppShared } from './renderApp';

/*
 * The same provider order `App.jsx` mounts, and the order is the point: the
 * term is outermost so the roster resolves students into the current term's
 * classes and the lifecycle composes the current term's seats.
 */
const wrapper = ({ children }) => (
  <AcademicTermProvider>
    <AcademicRosterProvider>
      <InstitutionalLifecycleProvider>{children}</InstitutionalLifecycleProvider>
    </AcademicRosterProvider>
  </AcademicTermProvider>
);

function mount() {
  return renderHook(
    () => ({
      term: useAcademicTerm(),
      roster: useAcademicRoster(),
      life: useInstitutionalLifecycle(),
    }),
    { wrapper },
  );
}

describe('Commencing the next semester requires an explicit confirmation', () => {
  it('refuses, and changes nothing, without one', () => {
    const { result } = mount();
    const before = result.current.term.term;

    let outcome;
    act(() => {
      outcome = result.current.term.commenceNextSemester();
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('not_confirmed');
    expect(result.current.term.term).toBe(before);
    expect(result.current.term.generation).toBe(0);
    // Nothing downstream moved either.
    expect(result.current.term.activeClasses).toBe(ACTIVE_CLASSES);
    expect(result.current.life.seats).toBe(CLASS_TUTOR_SEATS);
  });

  it('reports its outcome synchronously rather than a render later', () => {
    const { result } = mount();

    let outcome;
    act(() => {
      outcome = result.current.term.commenceNextSemester({ confirmed: true });
    });

    // The returned value is the truth about what happened, not a stale echo —
    // this is the defect the ref-beside-state arrangement exists to prevent.
    expect(outcome.ok).toBe(true);
    expect(outcome.term.generation).toBe(1);
    expect(outcome.previous.state).toBe('completed');
  });
});

describe('A commencement flips the band and excludes semesters below 3', () => {
  it('makes the other band active and keeps every class at semester 3 or above', () => {
    const { result } = mount();
    const priorBand = result.current.term.term.band;

    act(() => {
      result.current.term.commenceNextSemester({ confirmed: true });
    });

    const { term } = result.current;
    expect(term.term.band).not.toBe(priorBand);
    expect(term.semesters).toBe(BAND_SEMESTERS[term.term.band]);
    expect(term.semesters.every((s) => s >= 3)).toBe(true);
    term.activeClasses.forEach((c) => expect(c.semester).toBeGreaterThanOrEqual(3));
    // Stated as a label too, because a screen renders the words rather than the
    // array: no "Semester 1", "Semester 2" or "Year 1" can appear.
    expect(term.bandLabel).not.toMatch(/\b1\b|\b2\b/);
  });
});

describe('A commencement resets L4 seats through the canonical seat overlay', () => {
  it('derives one seat per new active class, none of them held', () => {
    const { result } = mount();

    act(() => {
      result.current.term.commenceNextSemester({ confirmed: true });
    });

    const { seats } = result.current.life;
    const classes = result.current.term.activeClasses;

    expect(seats).not.toBe(CLASS_TUTOR_SEATS);
    expect(seats).toHaveLength(classes.length);
    expect(new Set(seats.map((s) => s.classId))).toEqual(new Set(classes.map((c) => c.id)));
    expect(seats.every((s) => s.state !== 'active')).toBe(true);

    const coverage = result.current.life.coverage();
    expect(coverage.active).toBe(0);
    expect(coverage.total).toBe(classes.length);
    expect(coverage.invited).toBeGreaterThan(0);
  });

  it('does not carry a seat assignment from the closed term into the new one', () => {
    const { result } = mount();

    // Fill a seat in the closing term, the ordinary way a head of department
    // would, then close the term.
    const target = result.current.life.seatsOfDepartment(DEPARTMENT_ID).find((s) => s.state !== 'active');

    act(() => {
      result.current.life.assignTutor(target.classId, 'fac-05', {
        scopeDepartmentId: DEPARTMENT_ID,
      });
    });
    expect(result.current.life.seatOf(target.classId).state).toBe('active');

    act(() => {
      result.current.term.commenceNextSemester({ confirmed: true });
    });

    // The seat belonged to a class that has closed; it is not carried, and the
    // class it belonged to is not in the new term at all.
    expect(result.current.life.seatOf(target.classId)).toBeNull();
    expect(result.current.life.seats.every((s) => s.holderId === null)).toBe(true);
  });
});

describe('Prior-term records stay readable and read-only', () => {
  it('keeps the closed term as completed history rather than discarding it', () => {
    const { result } = mount();
    const closing = result.current.term.term;

    act(() => {
      result.current.term.commenceNextSemester({ confirmed: true });
    });

    const [previous] = result.current.term.priorTerms;
    expect(previous.id).toBe(closing.id);
    expect(previous.yearLabel).toBe(closing.yearLabel);
    expect(previous.band).toBe(closing.band);
    expect(previous.state).toBe('completed');
  });

  it('leaves the previous term’s students resolvable and unchanged', () => {
    const { result } = mount();
    const closingClass = ACTIVE_CLASSES[0];
    const before = result.current.roster.studentsOfClass(closingClass.id);
    expect(before.length).toBeGreaterThan(0);

    act(() => {
      result.current.term.commenceNextSemester({ confirmed: true });
    });

    // Still the same records, by identity — a closed term's roster is history,
    // not something the transition rewrote or dropped.
    const after = result.current.roster.studentsOfClass(closingClass.id);
    expect(after).toEqual(before);
    expect(after[0]).toBe(before[0]);
  });
});

describe('Promotion stays explicit head-of-department work after a commencement', () => {
  it('creates a queue and records no outcome in it', () => {
    const { result } = mount();

    act(() => {
      result.current.term.commenceNextSemester({ confirmed: true });
    });

    const { life, term } = result.current;
    expect(term.promotionRequired).toBe(true);
    expect(life.reviewQueue.length).toBeGreaterThan(0);
    expect(life.reviewQueue).not.toBe(REVIEW_CANDIDATES);
    // Not one decision has been taken by the transition itself.
    expect(Object.keys(life.reviews)).toHaveLength(0);
    life.reviewQueue.forEach((c) => expect(life.isReviewed(c.id)).toBe(false));
  });

  it('still requires a confirmed outcome, one student at a time, in the new term', () => {
    const { result } = mount();

    act(() => {
      result.current.term.commenceNextSemester({ confirmed: true });
    });

    const candidate = result.current.life.reviewQueue.find((c) => c.departmentId === DEPARTMENT_ID);
    expect(candidate).toBeTruthy();

    const preview = result.current.life.previewOutcome(candidate, 'promote');
    expect(preview.ok).toBe(true);
    // A preview places nobody.
    expect(result.current.life.isReviewed(candidate.id)).toBe(false);

    let outcome;
    act(() => {
      outcome = result.current.life.confirmOutcome(candidate, {
        outcome: 'promote',
        scopeDepartmentId: DEPARTMENT_ID,
      });
    });

    expect(outcome.ok).toBe(true);
    // The student keeps the identity they already had, across the transition.
    expect(outcome.review.placedStudentId).toBe(candidate.id);
    expect(result.current.roster.studentById(candidate.id)?.origin).toBe('promoted');
  });

  it('drops decisions taken in the closed term rather than carrying them forward', () => {
    const { result } = mount();
    const candidate = REVIEW_CANDIDATES.find((c) => c.departmentId === DEPARTMENT_ID);

    act(() => {
      result.current.life.confirmOutcome(candidate, {
        outcome: 'detain',
        scopeDepartmentId: DEPARTMENT_ID,
      });
    });
    expect(result.current.life.isReviewed(candidate.id)).toBe(true);

    act(() => {
      result.current.term.commenceNextSemester({ confirmed: true });
    });

    // A decision is a fact about the term it was taken in. The new term's queue
    // is a different cohort and starts undecided.
    expect(Object.keys(result.current.life.reviews)).toHaveLength(0);
  });
});

describe('Attendance is locked after a commencement, by derivation', () => {
  it('locks every class because no timetable has been submitted yet', () => {
    const { result } = mount();
    // It is genuinely live for some classes beforehand, so this is not vacuous.
    expect(result.current.term.attendanceLiveTotal).toBeGreaterThan(0);

    act(() => {
      result.current.term.commenceNextSemester({ confirmed: true });
    });

    const { term } = result.current;
    expect(term.attendanceLiveTotal).toBe(0);
    term.activeClasses.forEach((c) => {
      expect(term.timetableStateOf(c.id)).toBe('not_submitted');
      expect(term.attendanceLiveFor(c.id)).toBe(false);
      // The reason names the condition, not a seat — nobody switched it off.
      expect(term.attendanceLockReason(c.id)).toMatch(/submitted and approved/i);
    });
  });
});

describe('The scope line states the term the screen is showing', () => {
  it('tracks the live term rather than the label the fixtures loaded with', async () => {
    const user = userEvent.setup();
    renderAppShared('/curriculum');

    await user.click(await screen.findByRole('button', { name: /open profile/i }));
    const group = await screen.findByRole('radiogroup', { name: /workspace view/i });
    await user.click(within(group).getByRole('radio', { name: /principal/i }));
    await user.click(screen.getByRole('button', { name: /close profile/i }));

    const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    await user.click(within(nav).getByRole('link', { name: /^academic year$/i }));

    expect(await screen.findByText(/AY 2026–27/)).toBeInTheDocument();
    expect(screen.getAllByText(/Even semester · 4 · 6 · 8/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /commence next semester/i }));
    await user.click(await screen.findByRole('button', { name: /^commence semester$/i }));

    /*
     * The defect this pins was found by looking at the rendered page rather than
     * by the build: the scope line read the fixture's own year and band, so
     * after a commencement it stated the closed term directly above a page
     * describing the new one.
     */
    expect(await screen.findByText(/AY 2027–28/)).toBeInTheDocument();
    expect(screen.getAllByText(/Odd semester · 3 · 5 · 7/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/AY 2026–27/)).not.toBeInTheDocument();
  });
});

describe('The roster resolves the current term’s classes', () => {
  it('accepts a placement into a class the new term is actually running', () => {
    const { result } = mount();

    act(() => {
      result.current.term.commenceNextSemester({ confirmed: true });
    });

    const newClass = result.current.term.activeClasses[0];
    const fill = result.current.roster.classFill(newClass.id);

    // A class of the new band resolves — before the term layer existed this
    // returned a capacity of zero and refused every placement as unknown.
    expect(fill.capacity).toBe(newClass.capacity);
    expect(fill.headroom).toBeGreaterThan(0);
  });

  it('refuses a class from the term that has closed', () => {
    const { result } = mount();
    const closingClass = ACTIVE_CLASSES[0];

    act(() => {
      result.current.term.commenceNextSemester({ confirmed: true });
    });

    const outcome = result.current.roster.admitStudent(closingClass.id, {
      name: 'Test Student',
      reg: 'REG-TERM-CLOSED-01',
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('unknown_class');
  });
});
