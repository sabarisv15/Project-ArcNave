import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { WorkspaceProvider } from '../store/WorkspaceProvider';
import { ComposerProvider } from '../store/ComposerProvider';
import { AcademicTermProvider } from '../store/AcademicTermProvider';
import { AcademicRosterProvider } from '../store/AcademicRosterProvider';
import { InstitutionalLifecycleProvider, useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';
import {
  CLASS_TUTOR_SEATS,
  applySeatChange,
  classTutorSeat,
  composeSeats,
  coverageOf,
  hasClassTutor,
  tutorCoverage,
} from '../lib/seatState';
import { ACTIVE_BAND, ACTIVE_CLASSES, BAND_SEMESTERS, activeClassesOfDepartment } from '../lib/academicCalendar';
import { DEPARTMENT_ID, DEPT_CLASSES } from '../lib/departmentData';

/**
 * The Class Tutor seat, from the seat that fills it.
 *
 * The rule underneath every assertion here is that a seat belongs to its class.
 * The list of seats *is* the list of active classes — one for one — and no local
 * change can add one, remove one, or leave a class with two. What a change can
 * do is move who holds it, and record that it moved.
 */

function renderApp(route = '/department/classes') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <Tooltip.Provider>
          <WorkspaceProvider>
            <ComposerProvider>
              <App />
            </ComposerProvider>
          </WorkspaceProvider>
        </Tooltip.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function useHodView(user) {
  await user.click(screen.getByRole('button', { name: /open profile/i }));
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

const lifecycle = () => renderHook(() => useInstitutionalLifecycle(), { wrapper });

describe('L3 scope — its own department, in the running band only', () => {
  it('shows every active class of the department and nothing outside it', () => {
    const expected = activeClassesOfDepartment(DEPARTMENT_ID);
    expect(DEPT_CLASSES).toHaveLength(expected.length);
    expect(DEPT_CLASSES.map((c) => c.id).sort()).toEqual(expected.map((c) => c.id).sort());
    DEPT_CLASSES.forEach((c) => expect(c.departmentId).toBe(DEPARTMENT_ID));

    // Not the institution's classes — the department's.
    expect(DEPT_CLASSES.length).toBeLessThan(ACTIVE_CLASSES.length);
  });

  it('contains no first-year class, semester or label anywhere in its scope', () => {
    DEPT_CLASSES.forEach((c) => {
      expect(BAND_SEMESTERS[ACTIVE_BAND]).toContain(c.semester);
      expect(c.semester).toBeGreaterThanOrEqual(3);
      expect(c.year).toBeGreaterThanOrEqual(2);
      expect(c.code).not.toMatch(/(^|[\s·—-])I\s+B\./);
      expect(c.code).not.toMatch(/Semester\s*[12](\b|$)/);
    });
  });
});

describe('Exactly one canonical seat per active class', () => {
  it('derives the seat list from the class list, one for one', () => {
    expect(CLASS_TUTOR_SEATS).toHaveLength(ACTIVE_CLASSES.length);
    const byClass = new Set(CLASS_TUTOR_SEATS.map((s) => s.classId));
    expect(byClass.size).toBe(ACTIVE_CLASSES.length);
    ACTIVE_CLASSES.forEach((c) => expect(classTutorSeat(c.id)).toBeTruthy());
  });

  it('keeps that true after a local change', () => {
    const { result } = lifecycle();
    const target = DEPT_CLASSES[0].id;

    act(() => {
      result.current.assignTutor(target, 'fac-05');
    });

    expect(result.current.seats).toHaveLength(ACTIVE_CLASSES.length);
    expect(result.current.seats.filter((s) => s.classId === target)).toHaveLength(1);
  });

  it('does not count an outstanding invitation as coverage', () => {
    const coverage = tutorCoverage(DEPARTMENT_ID);
    expect(coverage.total).toBe(DEPT_CLASSES.length);
    expect(coverage.active + coverage.invited + coverage.vacant).toBe(coverage.total);

    const invited = CLASS_TUTOR_SEATS.find((s) => s.state === 'invite_pending');
    expect(invited).toBeTruthy();
    expect(hasClassTutor(invited.classId)).toBe(false);
  });
});

describe('Seat transitions', () => {
  it('composes over the baseline without mutating it', () => {
    const baseline = classTutorSeat('dept-cse-s4b');
    expect(baseline.state).toBe('vacant');

    const next = applySeatChange(baseline, { kind: 'assign', holderId: 'fac-05', on: '18 Aug 2026' });
    const composed = composeSeats({ [next.classId]: next });

    expect(next.state).toBe('active');
    // The fixture is untouched — the overlay is a second reading of it.
    expect(classTutorSeat('dept-cse-s4b').state).toBe('vacant');
    expect(composed.find((s) => s.classId === 'dept-cse-s4b').state).toBe('active');
    expect(composed).toHaveLength(CLASS_TUTOR_SEATS.length);
  });

  it('records a handover on reassignment and none on filling a vacancy', () => {
    const vacant = classTutorSeat('dept-cse-s4b');
    const filled = applySeatChange(vacant, { kind: 'assign', holderId: 'fac-05', on: '18 Aug 2026' });
    // Nobody was in the seat, so nobody goes into its history.
    expect(filled.history).toHaveLength(0);

    const held = classTutorSeat('dept-cse-s6a');
    expect(held.state).toBe('active');
    const moved = applySeatChange(held, {
      kind: 'reassign',
      holderId: 'fac-05',
      reason: 'Sabbatical cover',
      on: '18 Aug 2026',
    });

    expect(moved.holderId).toBe('fac-05');
    expect(moved.history).toHaveLength(held.history.length + 1);
    // The record is which seat was held and when — kept on the seat.
    expect(moved.history.at(-1)).toMatchObject({
      holderId: held.holderId,
      to: '18 Aug 2026',
      reason: 'Sabbatical cover',
    });
  });

  it('drops the holder when a seat is invited or vacated', () => {
    const held = classTutorSeat('dept-cse-s6a');

    const invited = applySeatChange(held, { kind: 'invite', invitedEmail: 'x@arcnave.edu.in' });
    expect(invited.state).toBe('invite_pending');
    expect(invited.holderId).toBeNull();
    expect(coverageOf([invited]).active).toBe(0);

    const vacated = applySeatChange(held, { kind: 'vacate' });
    expect(vacated.state).toBe('vacant');
    expect(vacated.holderId).toBeNull();
  });

  it('refuses a seat outside the acting department', () => {
    const { result } = lifecycle();
    let refused;
    act(() => {
      refused = result.current.assignTutor('dept-mech-s4a', 'fac-05', { scopeDepartmentId: DEPARTMENT_ID });
    });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('out_of_scope');
  });

  it('moves coverage as seats change, for every selector that reads it', () => {
    const { result } = lifecycle();
    const before = result.current.coverage(DEPARTMENT_ID);
    const vacant = result.current.seatsOfDepartment(DEPARTMENT_ID).find((s) => s.state === 'vacant');
    expect(vacant).toBeTruthy();

    act(() => {
      result.current.assignTutor(vacant.classId, 'fac-05');
    });

    const after = result.current.coverage(DEPARTMENT_ID);
    expect(after.total).toBe(before.total);
    expect(after.active).toBe(before.active + 1);
    expect(after.vacant).toBe(before.vacant - 1);
    // And the same record resolves through the per-class selector L4 and L1 use.
    expect(result.current.seatOf(vacant.classId)).toMatchObject({ state: 'active', holderId: 'fac-05' });
  });
});

describe('Department → Classes as the seat surface', () => {
  it('renders every seat state the department is actually in', async () => {
    const user = userEvent.setup();
    renderApp();
    await useHodView(user);

    expect(await screen.findByRole('heading', { name: 'Classes' })).toBeInTheDocument();

    const coverage = tutorCoverage(DEPARTMENT_ID);
    expect(screen.getAllByText('Active')).toHaveLength(coverage.active);
    expect(screen.getAllByText('Invite pending')).toHaveLength(coverage.invited);
    expect(screen.getAllByText('Vacant')).toHaveLength(coverage.vacant);
  });

  it('changes a tutor only through the seat drawer, never through class details', async () => {
    const user = userEvent.setup();
    renderApp();
    await useHodView(user);

    // The class drawer is informational: no role editor, no tutor field.
    const classRows = await screen.findAllByRole('button', { name: /— open class$/i });
    await user.click(classRows[0]);
    const classDrawer = await screen.findByRole('dialog', { name: /B\.Sc CS/i });
    expect(within(classDrawer).queryByRole('combobox', { name: /class tutor/i })).not.toBeInTheDocument();
    expect(within(classDrawer).queryByRole('button', { name: /^Assign$/ })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    // The seat drawer is the one place it happens.
    const seatButtons = await screen.findAllByRole('button', { name: /— manage class tutor seat$/i });
    await user.click(seatButtons[0]);
    const seatDrawer = await screen.findByRole('dialog', { name: /Class Tutor —/i });
    expect(within(seatDrawer).getByText('Reassignment history')).toBeInTheDocument();
    expect(within(seatDrawer).getByRole('button', { name: /^Invite$/ })).toBeInTheDocument();
    expect(
      within(seatDrawer).getByText(/A class tutor is changed only here — never through class details/i),
    ).toBeInTheDocument();
  });

  it('assigns a vacant seat and reflects it back in the table', async () => {
    const user = userEvent.setup();
    renderApp();
    await useHodView(user);

    const before = tutorCoverage(DEPARTMENT_ID);
    const seatButtons = await screen.findAllByRole('button', { name: /— manage class tutor seat$/i });
    // The default sort puts uncovered seats first, so the first row is vacant.
    await user.click(seatButtons[0]);

    const seatDrawer = await screen.findByRole('dialog', { name: /Class Tutor —/i });
    expect(within(seatDrawer).getByText('Nobody')).toBeInTheDocument();

    await user.click(within(seatDrawer).getByRole('button', { name: /^Assign$/ }));
    await user.click(await within(seatDrawer).findByText('Ms. Priya Nair'));
    await user.click(within(seatDrawer).getByRole('button', { name: /^Assign$/ }));

    expect(
      await screen.findByText(`${before.active + 1} of ${before.total} class tutor seats held`, { exact: false }),
    ).toBeInTheDocument();
  });
});
