import { act, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  AcademicTermProvider,
  AcademicRosterProvider,
  useAcademicRoster,
  InstitutionalLifecycleProvider,
  useInstitutionalLifecycle,
} from '@/features/institution';
import {
  PRIOR_CLASSES,
  PROMOTION_OUTCOMES,
  REVIEW_CANDIDATES,
  candidatesOfPriorClass,
  defaultTargetClassId,
  targetSectionsFor,
} from '../lib/promotionData';
import { ACTIVE_CLASS_BY_ID, BAND_SEMESTERS } from '../lib/academicCalendar';
import { DEPARTMENT_ID } from '../lib/departmentData';
import { renderApp as renderAppShared } from './renderApp';

/**
 * The semester transition, from the seat that decides it.
 *
 * Two things are being pinned here and they are different. The first is that a
 * placement is only ever the result of somebody confirming one — no cohort moves
 * because a page was opened. The second is that a student who *is* placed is the
 * same student: same id, same record, carried across a semester boundary rather
 * than recreated on the other side of it. Everything L4 does with a promoted
 * student depends on the second being true.
 */

function renderApp(route = '/department/promotions', options) {
  return renderAppShared(route, options);
}

async function useHodView(user) {
  await user.click(await screen.findByRole('button', { name: /open profile/i }));
  const group = await screen.findByRole('radiogroup', { name: /workspace view/i });
  await user.click(within(group).getByRole('radio', { name: /head of department/i }));
  await user.click(screen.getByRole('button', { name: /close profile/i }));
}

/*
 * The same provider order `App.jsx` mounts. At generation 0 the term resolves
 * the baseline classes, seats and review queue by identity, so every assertion
 * below is asserting exactly what it asserted before this layer existed.
 */
const wrapper = ({ children }) => (
  <AcademicTermProvider>
    <AcademicRosterProvider>
      <InstitutionalLifecycleProvider>{children}</InstitutionalLifecycleProvider>
    </AcademicRosterProvider>
  </AcademicTermProvider>
);

/** Both layers from one mount, because a promotion crosses them. */
function lifecycle() {
  return renderHook(() => ({ life: useInstitutionalLifecycle(), roster: useAcademicRoster() }), { wrapper });
}

describe('The review cohort is a post-commencement state, not a term rollover', () => {
  it('reviews prior-band classes into the running band, and never a first year', () => {
    expect(PRIOR_CLASSES.length).toBeGreaterThan(0);

    PRIOR_CLASSES.forEach((c) => {
      // Semesters 1 and 2 are outside ArcNave entirely; the prior band is 3/5/7.
      expect(c.semester).toBeGreaterThanOrEqual(3);
      expect(BAND_SEMESTERS.odd.concat(BAND_SEMESTERS.even)).toContain(c.semester);
      // Every cohort has somewhere to go, and it is a class that is running.
      expect(ACTIVE_CLASS_BY_ID[c.targetClassId]).toBeTruthy();
      expect(ACTIVE_CLASS_BY_ID[c.targetClassId].semester).toBe(c.semester + 1);
    });
  });

  it('scopes the whole queue to the reviewing department', () => {
    expect(REVIEW_CANDIDATES.length).toBeGreaterThan(0);
    REVIEW_CANDIDATES.forEach((c) => expect(c.departmentId).toBe(DEPARTMENT_ID));
  });
});

describe('Promotion requires an explicit confirmation', () => {
  it('places nobody until an outcome is confirmed', () => {
    const { result } = lifecycle();
    const candidate = REVIEW_CANDIDATES[0];
    const target = defaultTargetClassId(candidate);
    const before = result.current.roster.studentsOfClass(target).length;

    // Previewing is not deciding: it reports what *would* happen.
    const preview = result.current.life.previewOutcome(candidate, 'promote');
    expect(preview.ok).toBe(true);

    expect(result.current.roster.studentsOfClass(target)).toHaveLength(before);
    expect(result.current.life.isReviewed(candidate.id)).toBe(false);
    expect(result.current.life.reviewProgress(DEPARTMENT_ID).reviewed).toBe(0);
  });

  it('refuses to decide the same student twice', () => {
    const { result } = lifecycle();
    const candidate = REVIEW_CANDIDATES[0];

    act(() => {
      result.current.life.confirmOutcome(candidate, { outcome: 'promote' });
    });

    let second;
    act(() => {
      second = result.current.life.confirmOutcome(candidate, { outcome: 'detain' });
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('already_reviewed');
    expect(result.current.life.reviewOf(candidate.id).outcome).toBe('promote');
  });

  it('refuses a student outside the reviewing department', () => {
    const { result } = lifecycle();
    let outcome;
    act(() => {
      outcome = result.current.life.confirmOutcome(REVIEW_CANDIDATES[0], {
        outcome: 'promote',
        scopeDepartmentId: 'dept-mech',
      });
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('out_of_scope');
  });
});

describe('A confirmed promotion places the same student', () => {
  it('creates a next-semester placement carrying the original id', () => {
    const { result } = lifecycle();
    const candidate = REVIEW_CANDIDATES[0];
    const target = defaultTargetClassId(candidate);

    act(() => {
      result.current.life.confirmOutcome(candidate, { outcome: 'promote' });
    });

    const placed = result.current.roster.studentsOfClass(target).find((s) => s.id === candidate.id);
    expect(placed).toBeTruthy();
    // The identity a semester transition must not change.
    expect(placed.id).toBe(candidate.id);
    expect(placed.reg).toBe(candidate.reg);
    expect(placed.name).toBe(candidate.name);
    expect(placed.classId).toBe(target);
    // And the field L4 branches on, so no onboarding action is ever offered.
    expect(placed.origin).toBe('promoted');
  });

  it('resolves the promoted student through the institution-wide selectors too', () => {
    const { result } = lifecycle();
    const candidate = REVIEW_CANDIDATES[0];

    act(() => {
      result.current.life.confirmOutcome(candidate, { outcome: 'promote' });
    });

    expect(result.current.roster.studentById(candidate.id)?.id).toBe(candidate.id);
    expect(result.current.roster.studentsOfDepartment(DEPARTMENT_ID).some((s) => s.id === candidate.id)).toBe(true);
    expect(result.current.roster.allStudents.filter((s) => s.id === candidate.id)).toHaveLength(1);
  });

  it('carries academic standing across and starts attendance from nothing', () => {
    const { result } = lifecycle();
    const candidate = REVIEW_CANDIDATES.find((c) => c.backlogCount > 0) ?? REVIEW_CANDIDATES[0];

    act(() => {
      result.current.life.confirmOutcome(candidate, { outcome: 'promote' });
    });

    const placed = result.current.roster.studentById(candidate.id);
    expect(placed.cgpa).toBe(candidate.cgpa);
    expect(placed.backlogCount).toBe(candidate.backlogCount);
    // The semester attendance was measured over has ended.
    expect(placed.attendance).toBe(0);
  });
});

describe('The four outcomes are four different results', () => {
  it('places on Promote and Section change, and places nobody on Detain or Transfer', () => {
    const cohort = candidatesOfPriorClass(PRIOR_CLASSES[0].id);
    const { result } = lifecycle();

    const sameSection = PRIOR_CLASSES[0].targetClassId;
    const other = targetSectionsFor(cohort[0]).find((t) => t.classId !== sameSection);
    expect(other).toBeTruthy();

    act(() => {
      result.current.life.confirmOutcome(cohort[0], { outcome: 'promote' });
      result.current.life.confirmOutcome(cohort[1], { outcome: 'section_change', section: other.section });
      result.current.life.confirmOutcome(cohort[2], { outcome: 'detain' });
      result.current.life.confirmOutcome(cohort[3], { outcome: 'transfer', note: 'Moving to another college' });
    });

    const promoted = result.current.life.reviewOf(cohort[0].id);
    const moved = result.current.life.reviewOf(cohort[1].id);
    const detained = result.current.life.reviewOf(cohort[2].id);
    const transferred = result.current.life.reviewOf(cohort[3].id);

    expect(promoted.targetClassId).toBe(sameSection);
    expect(promoted.sectionChanged).toBe(false);

    // A section change is a placement *and* a recorded movement between two
    // named sections — the prior one is kept, not overwritten.
    expect(moved.targetClassId).toBe(other.classId);
    expect(moved.sectionChanged).toBe(true);
    expect(moved.fromSection).toBe(cohort[1].section);
    expect(moved.toSection).toBe(other.section);
    expect(moved.toSection).not.toBe(moved.fromSection);

    expect(detained.targetClassId).toBeNull();
    expect(detained.placedStudentId).toBeNull();
    expect(transferred.targetClassId).toBeNull();
    expect(transferred.placedStudentId).toBeNull();
    expect(transferred.note).toBe('Moving to another college');

    // Two placements exist, and they are the two that create one.
    expect(result.current.roster.studentById(cohort[0].id)?.classId).toBe(sameSection);
    expect(result.current.roster.studentById(cohort[1].id)?.classId).toBe(other.classId);
    expect(result.current.roster.studentById(cohort[2].id)).toBeNull();
    expect(result.current.roster.studentById(cohort[3].id)).toBeNull();

    const progress = result.current.life.reviewProgress(DEPARTMENT_ID);
    expect(progress.reviewed).toBe(4);
    expect(progress.byOutcome).toMatchObject({
      promote: 1,
      section_change: 1,
      detain: 1,
      transfer: 1,
    });
  });

  it('keeps a promoted student out of any onboarding path', () => {
    const { result } = lifecycle();
    const candidate = REVIEW_CANDIDATES[0];

    act(() => {
      result.current.life.confirmOutcome(candidate, { outcome: 'promote' });
    });

    const placed = result.current.roster.studentById(candidate.id);
    expect(placed.origin).toBe('promoted');
    // `documentsPending` is the only follow-up a placement can carry, and a
    // promotion does not create one: they were already enrolled here.
    expect(placed.documentsPending).toBe(false);
  });
});

describe('Capacity is validated before a placement is confirmed', () => {
  it('refuses a section change once the target section is full', () => {
    const { result } = lifecycle();
    const cohortA = candidatesOfPriorClass('dept-cse-s3a');
    const cohortB = candidatesOfPriorClass('dept-cse-s3b');
    const targetSection = 'B';
    const targetClassId = 'dept-cse-s4b';

    const headroom = result.current.roster.classFill(targetClassId).headroom;
    expect(headroom).toBeGreaterThan(0);
    expect(cohortA.length + cohortB.length).toBeGreaterThan(headroom);

    /*
     * Fill section B to its provisioned capacity from both sides — section
     * changes out of A, and ordinary promotions out of B — then try one more.
     * The point is that capacity is a property of the *section*, not of the
     * outcome that puts somebody in it.
     */
    act(() => {
      cohortA.slice(0, headroom - 1).forEach((c) => {
        result.current.life.confirmOutcome(c, { outcome: 'section_change', section: targetSection });
      });
      result.current.life.confirmOutcome(cohortB[0], { outcome: 'promote' });
    });

    expect(result.current.roster.classFill(targetClassId).headroom).toBe(0);

    const overflow = cohortA[headroom - 1];
    expect(result.current.life.previewOutcome(overflow, 'section_change', targetSection)).toMatchObject({
      ok: false,
      reason: 'at_capacity',
    });

    let refused;
    act(() => {
      refused = result.current.life.confirmOutcome(overflow, {
        outcome: 'section_change',
        section: targetSection,
      });
    });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('at_capacity');
    expect(result.current.life.isReviewed(overflow.id)).toBe(false);
  });

  it('refuses a section that this department is not running', () => {
    const { result } = lifecycle();
    let refused;
    act(() => {
      refused = result.current.life.confirmOutcome(REVIEW_CANDIDATES[0], {
        outcome: 'section_change',
        section: 'Z',
      });
    });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('no_target');
  });
});

describe('Department → Promotions', () => {
  it('says it is a review, and never that a semester can be commenced here', async () => {
    const user = userEvent.setup();
    renderApp();
    await useHodView(user);

    expect(await screen.findByRole('heading', { name: 'Promotions' })).toBeInTheDocument();
    expect(
      screen.getAllByText(/Semester transition review · placements are applied after confirmation/i).length,
    ).toBeGreaterThan(0);

    // Nothing on this screen opens, closes or advances a term.
    expect(screen.queryByRole('button', { name: /commence/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/commence next semester/i)).not.toBeInTheDocument();
  });

  it('opens every student awaiting a decision, and none already decided', async () => {
    const user = userEvent.setup();
    renderApp();
    await useHodView(user);

    expect(await screen.findByText(`${REVIEW_CANDIDATES.length} students`)).toBeInTheDocument();
    expect(screen.getAllByText('Awaiting review')).toHaveLength(REVIEW_CANDIDATES.length);
    expect(screen.getByText(`0 of ${REVIEW_CANDIDATES.length} decided`)).toBeInTheDocument();
  });

  it('offers the four outcomes and states the placement before confirming', async () => {
    const user = userEvent.setup();
    renderApp();
    await useHodView(user);

    const rows = await screen.findAllByRole('button', { name: /— review placement$/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog', { name: /./ });
    const group = within(drawer).getByRole('radiogroup', { name: /promotion outcome/i });
    Object.values(PROMOTION_OUTCOMES).forEach((o) => {
      expect(within(group).getByRole('radio', { name: new RegExp(o.label, 'i') })).toBeInTheDocument();
    });

    expect(within(drawer).getByText('Resulting placement')).toBeInTheDocument();
    // The previous semester is present and stated as closed.
    expect(within(drawer).getByText(/read-only/i)).toBeInTheDocument();
    expect(within(drawer).getByText(/Nothing is applied until you confirm/i)).toBeInTheDocument();
  });

  it('records the outcome only after the confirm control is used', async () => {
    const user = userEvent.setup();
    renderApp();
    await useHodView(user);

    const rows = await screen.findAllByRole('button', { name: /— review placement$/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog', { name: /./ });
    await user.click(within(drawer).getByRole('radio', { name: /^Detain/i }));

    // Selecting an outcome has decided nothing.
    expect(screen.getByText(`0 of ${REVIEW_CANDIDATES.length} decided`)).toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: /^Confirm detain$/i }));

    expect(await screen.findByText(`1 of ${REVIEW_CANDIDATES.length} decided`)).toBeInTheDocument();
    expect(screen.getAllByText('Detained').length).toBeGreaterThan(0);
  });
});
