import { act, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AcademicTermProvider, useAcademicTerm } from '../store/AcademicTermProvider';
import { AcademicRosterProvider } from '../store/AcademicRosterProvider';
import { InstitutionalLifecycleProvider, useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';
import { HOD_SEATS, SEAT_STATES, hodSeat } from '../lib/seatState';
import { DEPARTMENTS, facultyOfDepartment } from '../lib/institutionData';
import { seatTitle } from '../lib/seatTitles';
import { HOD_L3 } from '../lib/roles';
import { renderApp as renderAppShared } from './renderApp';

const wrapper = ({ children }) => (
  <AcademicTermProvider>
    <AcademicRosterProvider>
      <InstitutionalLifecycleProvider>{children}</InstitutionalLifecycleProvider>
    </AcademicRosterProvider>
  </AcademicTermProvider>
);

const lifecycle = () => renderHook(() => useInstitutionalLifecycle(), { wrapper });

function renderApp(route = '/curriculum', options) {
  return renderAppShared(route, options);
}

async function usePrincipalView(user) {
  await user.click(await screen.findByRole('button', { name: /open profile/i }));
  const group = await screen.findByRole('radiogroup', { name: /workspace view/i });
  await user.click(within(group).getByRole('radio', { name: /principal/i }));
  await user.click(screen.getByRole('button', { name: /close profile/i }));
}

async function navigateVia(user, name) {
  const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
  await user.click(within(nav).getByRole('link', { name }));
}

const vacant = HOD_SEATS.find((s) => s.state === 'vacant');
const invited = HOD_SEATS.find((s) => s.state === 'invite_pending');
const held = HOD_SEATS.find((s) => s.state === 'active');

describe('Department leadership seats are canonical records', () => {
  it('derives one seat per provisioned department, one for one', () => {
    expect(HOD_SEATS).toHaveLength(DEPARTMENTS.length);
    expect(new Set(HOD_SEATS.map((s) => s.departmentId))).toEqual(new Set(DEPARTMENTS.map((d) => d.id)));
  });

  it('gives every seat state a real member so none is an unreachable branch', () => {
    expect(vacant).toBeTruthy();
    expect(invited).toBeTruthy();
    expect(held).toBeTruthy();
    Object.keys(SEAT_STATES).forEach((state) => {
      expect(HOD_SEATS.some((s) => s.state === state)).toBe(true);
    });
  });

  it('treats an outstanding invitation as not held, and not coverage', () => {
    const { result } = lifecycle();
    const coverage = result.current.hodCoverage();

    expect(coverage.total).toBe(DEPARTMENTS.length);
    expect(coverage.active + coverage.invited + coverage.vacant).toBe(coverage.total);
    // An invitation is its own state — it is neither a vacancy nor coverage.
    expect(coverage.invited).toBeGreaterThan(0);
    expect(result.current.hodSeatOf(invited.departmentId).holderId).toBeNull();
  });
});

describe('The institution head manages the leadership seat, through shared state', () => {
  it('fills a vacancy and moves coverage with it', () => {
    const { result } = lifecycle();
    const before = result.current.hodCoverage();
    const candidate = facultyOfDepartment(vacant.departmentId)[0];

    let outcome;
    act(() => {
      outcome = result.current.assignHod(vacant.departmentId, candidate.id);
    });

    expect(outcome.ok).toBe(true);
    const seat = result.current.hodSeatOf(vacant.departmentId);
    expect(seat.state).toBe('active');
    expect(seat.holderId).toBe(candidate.id);

    const after = result.current.hodCoverage();
    expect(after.active).toBe(before.active + 1);
    expect(after.vacant).toBe(before.vacant - 1);
    // The total cannot move: an appointment does not create a department.
    expect(after.total).toBe(before.total);
  });

  it('records a handover only when somebody was actually in the seat', () => {
    const { result } = lifecycle();

    // Filling a vacancy is not a reassignment.
    act(() => {
      result.current.assignHod(vacant.departmentId, facultyOfDepartment(vacant.departmentId)[0].id);
    });
    expect(result.current.hodSeatOf(vacant.departmentId).history).toHaveLength(0);

    // Moving an occupied seat is.
    const successor = facultyOfDepartment(held.departmentId).find((f) => f.id !== held.holderId);
    act(() => {
      result.current.assignHod(held.departmentId, successor.id, { reason: 'Sabbatical cover' });
    });

    const seat = result.current.hodSeatOf(held.departmentId);
    expect(seat.holderId).toBe(successor.id);
    expect(seat.history).toHaveLength(1);
    expect(seat.history[0].holderId).toBe(held.holderId);
    expect(seat.history[0].reason).toBe('Sabbatical cover');
  });

  it('invites and vacates, and neither counts as leadership', () => {
    const { result } = lifecycle();

    act(() => {
      result.current.inviteHod(vacant.departmentId, 'new.head@arcnave.edu.in');
    });
    let seat = result.current.hodSeatOf(vacant.departmentId);
    expect(seat.state).toBe('invite_pending');
    expect(seat.invitedEmail).toBe('new.head@arcnave.edu.in');
    expect(seat.holderId).toBeNull();

    act(() => {
      result.current.vacateHod(held.departmentId);
    });
    seat = result.current.hodSeatOf(held.departmentId);
    expect(seat.state).toBe('vacant');
    expect(seat.holderId).toBeNull();
  });

  it('refuses an invitation with no address, and an unprovisioned department', () => {
    const { result } = lifecycle();

    let outcome;
    act(() => {
      outcome = result.current.inviteHod(vacant.departmentId, '   ');
    });
    expect(outcome.ok).toBe(false);

    act(() => {
      outcome = result.current.assignHod('dept-does-not-exist', 'fac-01');
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('unknown_department');
  });

  it('never mutates the immutable baseline', () => {
    const { result } = lifecycle();
    const baselineState = hodSeat(vacant.departmentId).state;

    act(() => {
      result.current.assignHod(vacant.departmentId, facultyOfDepartment(vacant.departmentId)[0].id);
    });

    expect(hodSeat(vacant.departmentId).state).toBe(baselineState);
    expect(hodSeat(vacant.departmentId).holderId).toBeNull();
  });

  it('survives a term transition — leadership is not a property of a semester', () => {
    const { result } = renderHook(() => ({ life: useInstitutionalLifecycle(), term: useAcademicTerm() }), { wrapper });

    const candidate = facultyOfDepartment(vacant.departmentId)[0];
    act(() => {
      result.current.life.assignHod(vacant.departmentId, candidate.id);
    });

    act(() => {
      result.current.term.commenceNextSemester({ confirmed: true });
    });

    // Class Tutor seats reset because their classes closed. A department head
    // does not vacate their post because the band flipped.
    expect(result.current.life.hodSeatOf(vacant.departmentId).state).toBe('active');
    expect(result.current.life.hodSeatOf(vacant.departmentId).holderId).toBe(candidate.id);
  });
});

describe('The leadership surface is its own, and is not class-tutor assignment', () => {
  it('opens a dedicated seat drawer from the Departments page', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);
    await navigateVia(user, /^departments$/i);

    await user.click(await screen.findByRole('tab', { name: /leadership seats/i }));

    const title = seatTitle(HOD_L3);
    const row = await screen.findByRole('button', {
      name: new RegExp(`civil engineering — manage ${title}`, 'i'),
    });
    await user.click(row);

    const dialog = await screen.findByRole('dialog');
    // The configured title, not an L-number, and named as the seat rather than
    // as an attribute of the department.
    expect(
      within(dialog).getByRole('heading', { name: new RegExp(`${title} — Civil Engineering`, 'i') }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^assign$/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^invite$/i })).toBeInTheDocument();
    // The one thing this seat may not do, stated on the surface where somebody
    // would most plausibly go looking for it.
    expect(
      within(dialog).getByText(/class tutor seats are assigned by this department's own head/i),
    ).toBeInTheDocument();
  });

  it('offers no class-tutor assignment anywhere in the institution workspace', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);

    for (const item of [/^institution$/i, /^departments$/i, /^academic year$/i]) {
      await navigateVia(user, item);
      expect(screen.queryByRole('button', { name: /assign (a )?class tutor/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reassign class tutor/i })).not.toBeInTheDocument();
    }
  });
});
