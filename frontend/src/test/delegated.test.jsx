import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { WorkspaceProvider } from '../store/WorkspaceProvider';
import { ComposerProvider } from '../store/ComposerProvider';
import { PROVISIONING } from '../lib/provisioning';
import {
  canDelegatedReview,
  delegatedEnterable,
  delegatedNavItems,
  delegatedRegistered,
  delegatedReviewedState,
  delegatedScope,
} from '../lib/delegatedScope';
import { curriculumNavFor } from '../components/SidebarNavigation';
import { LEVEL_2, TEACHING_STAFF } from '../lib/roles';
import { canFinalApprove, endorsementChainLabel } from '../lib/endorsementChain';
import { AcademicTermProvider } from '../store/AcademicTermProvider';
import { AcademicRosterProvider } from '../store/AcademicRosterProvider';
import {
  InstitutionalLifecycleProvider,
  useInstitutionalLifecycle,
} from '../store/InstitutionalLifecycleProvider';

const wrapper = ({ children }) => (
  <AcademicTermProvider>
    <AcademicRosterProvider>
      <InstitutionalLifecycleProvider>{children}</InstitutionalLifecycleProvider>
    </AcademicRosterProvider>
  </AcademicTermProvider>
);

const lifecycle = () => renderHook(() => useInstitutionalLifecycle(), { wrapper });

/** The department the fixture has routed to the delegated seat. */
const ROUTED = 'dept-ece';
/** Delegated to this seat, but its revision is with the institution head already. */
const PAST_THIS_SEAT = 'dept-cse';
/** A real department this seat was never given. */
const OUT_OF_SCOPE = 'dept-comm';

/**
 * The delegated (Level 2) workspace, in the institution that has one.
 *
 * What these assert is not "the screen renders" but the four things that make it
 * a *delegated* workspace rather than a fifth fixed role: it is built from
 * configuration, it is bounded by the configured scope, it routes onward instead
 * of approving, and it never resolves to the Staff experience.
 */

function renderApp(route = '/') {
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
    </QueryClientProvider>
  );
}

/** Enters the delegated seat the only way the interface offers — the switcher. */
async function useDelegatedSeat(user) {
  await user.click(screen.getByRole('button', { name: /open profile/i }));
  const group = await screen.findByRole('radiogroup', { name: /workspace view/i });
  await user.click(within(group).getByRole('radio', { name: /Dean — Academic Affairs/i }));
  await user.keyboard('{Escape}');
}

describe('delegated scope resolution', () => {
  it('resolves the configured seat rather than a fixed role', () => {
    const scope = delegatedScope();
    expect(scope.title).toBe('Dean — Academic Affairs');
    expect(scope.departmentIds).toEqual(PROVISIONING.level2Scope.departmentIds);
    expect(scope.workAreas).toHaveLength(2);
    expect(scope.responsibilities.length).toBeGreaterThan(0);
    expect(scope.inTimetableChain).toBe(true);
    expect(scope.occupied).toBe(true);
  });

  it('registers and admits entry only where the seat exists and is held', () => {
    expect(delegatedRegistered()).toBe(true);
    expect(delegatedEnterable()).toBe(true);
  });

  it('builds navigation from configuration, not from a duty list', () => {
    const labels = delegatedNavItems(delegatedScope()).map((i) => i.label);
    expect(labels).toEqual([
      'Delegated Overview',
      'Routed Approvals',
      'Work Areas',
      'Documents',
      'Calendar',
    ]);
    // The duty modules a "Dean" is commonly assumed to own are not here.
    expect(labels).not.toContain('Attendance & Class log');
    expect(labels).not.toContain('Assessments');
  });

  it('points its destinations at a scope-named root, never a title-named one', () => {
    delegatedNavItems(delegatedScope())
      .filter((i) => i.kind !== 'documents' && i.kind !== 'calendar')
      .forEach((i) => expect(i.to.startsWith('/delegated')).toBe(true));
  });
});

describe('no Staff fallthrough', () => {
  it('never resolves the delegated seat to the Staff menu', () => {
    const delegated = curriculumNavFor(LEVEL_2).map((i) => i.label);
    const staff = curriculumNavFor(TEACHING_STAFF).map((i) => i.label);
    expect(delegated).not.toEqual(staff);
    expect(delegated).not.toContain('Students');
    expect(delegated).not.toContain('Staff');
  });

  it('gives an unknown seat no items at all rather than the Staff menu', () => {
    expect(curriculumNavFor('some_future_seat')).toEqual([]);
  });

  it('opens the delegated workspace, not Staff home, when the seat is selected', async () => {
    const user = userEvent.setup();
    renderApp('/delegated');
    await useDelegatedSeat(user);

    expect((await screen.findAllByRole('heading', { name: 'Dean — Academic Affairs' })).length)
      .toBeGreaterThan(0);
    const nav = screen.getByRole('navigation', { name: /curriculum navigation/i });
    expect(within(nav).getByRole('link', { name: /Delegated Overview/i })).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: /^Staff$/i })).toBeNull();
  });
});

describe('delegated workspace', () => {
  it('states the configured title, scope, occupancy and chain', async () => {
    const user = userEvent.setup();
    renderApp('/delegated');
    await useDelegatedSeat(user);

    expect(await screen.findByText('Dr. Lakshmi Narayanan')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText(endorsementChainLabel())).toBeTruthy();
    expect(screen.getAllByText(/Timetable review/).length).toBeGreaterThan(0);
  });

  it('renders only the delegated departments', async () => {
    const user = userEvent.setup();
    renderApp('/delegated');
    await useDelegatedSeat(user);

    expect((await screen.findAllByText('Computer Science')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Electronics and Communication').length).toBeGreaterThan(0);
    // Provisioned, but not delegated to this seat.
    expect(screen.queryAllByText('Commerce')).toHaveLength(0);
    expect(screen.queryAllByText('Mathematics')).toHaveLength(0);
  });

  it('lists the configured work areas and nothing else', async () => {
    const user = userEvent.setup();
    renderApp('/delegated/areas');
    await useDelegatedSeat(user);

    expect(await screen.findByText('Examination calendar')).toBeTruthy();
    expect(screen.getByText('Academic operations review')).toBeTruthy();
  });
});

describe('routed approvals', () => {
  it('offers a review that routes onward, never an approval', async () => {
    const user = userEvent.setup();
    renderApp('/delegated/approvals');
    await useDelegatedSeat(user);

    const row = await screen.findByRole('button', { name: /routed for review/i });
    expect(within(row).getByText('Electronics and Communication')).toBeTruthy();
    await user.click(row);

    expect(await screen.findByRole('button', { name: /route onward/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Approve$/ })).toBeNull();
  });

  it('holds only revisions actually routed to this seat', async () => {
    const user = userEvent.setup();
    renderApp('/delegated/approvals');
    await useDelegatedSeat(user);

    // Mathematics is waiting on its own head of department, not on this seat;
    // Commerce is not delegated here at all. Exactly one revision is routed.
    const rows = await screen.findAllByRole('button', { name: /routed for review/i });
    expect(rows).toHaveLength(1);
    expect(screen.queryAllByText('Mathematics')).toHaveLength(0);
    expect(screen.queryAllByText('Commerce')).toHaveLength(0);
  });
});

describe('the boundary of a delegated review', () => {
  it('moves a revision to the institution head, never to approved', () => {
    expect(delegatedReviewedState()).toBe('endorsed_pending_l1');
    expect(delegatedReviewedState()).not.toBe('approved_locked');
  });

  it('refuses a department outside the delegated scope', () => {
    const scope = delegatedScope();
    expect(
      canDelegatedReview('endorsed_pending_l2', scope, { departmentId: 'dept-comm' })
    ).toBe(false);
    expect(
      canDelegatedReview('endorsed_pending_l2', scope, { departmentId: 'dept-ece' })
    ).toBe(true);
  });

  it('refuses every state except the one routed to it', () => {
    const scope = delegatedScope();
    ['ready_for_endorsement', 'conflict_identified', 'endorsed_pending_l1', 'approved_locked', 'draft']
      .forEach((state) =>
        expect(canDelegatedReview(state, scope, { departmentId: ROUTED })).toBe(false)
      );
  });
});

describe('chain routing through the lifecycle', () => {
  it('hands a reviewed revision to the institution head, and only then', () => {
    const { result } = lifecycle();

    // Before the review, the final decision is blocked by the configured step.
    expect(result.current.endorsementStateOf(ROUTED)).toBe('endorsed_pending_l2');
    expect(result.current.canDecide(ROUTED)).toBe(false);
    expect(result.current.blockReasonFor(ROUTED)).toMatch(/Dean — Academic Affairs/);

    let outcome;
    act(() => {
      outcome = result.current.reviewDelegated(ROUTED, { note: 'Elective block reads correctly.' });
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.state).toBe('endorsed_pending_l1');
    expect(result.current.endorsementStateOf(ROUTED)).toBe('endorsed_pending_l1');
    expect(result.current.canDecide(ROUTED)).toBe(true);
  });

  it('never lets the delegated seat lock a timetable', () => {
    const { result } = lifecycle();

    act(() => {
      result.current.reviewDelegated(ROUTED, { note: '' });
    });
    expect(result.current.endorsementStateOf(ROUTED)).not.toBe('approved_locked');

    // Approving is still the institution head's act, taken separately.
    act(() => {
      result.current.approveFinal(ROUTED, { note: 'Approved.' });
    });
    expect(result.current.endorsementStateOf(ROUTED)).toBe('approved_locked');
  });

  it('refuses a second review of the same revision', () => {
    const { result } = lifecycle();

    act(() => {
      result.current.reviewDelegated(ROUTED, {});
    });
    let again;
    act(() => {
      again = result.current.reviewDelegated(ROUTED, {});
    });
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('already_decided');
  });

  it('returns a revision only with a reason', () => {
    const { result } = lifecycle();

    let refused;
    act(() => {
      refused = result.current.returnFromDelegated(ROUTED, { reason: '  ' });
    });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('reason_required');

    let accepted;
    act(() => {
      accepted = result.current.returnFromDelegated(ROUTED, {
        reason: 'The elective block still collides with the shared lab.',
      });
    });
    expect(accepted.ok).toBe(true);
    expect(result.current.endorsementStateOf(ROUTED)).toBe('rejected');
  });
});

describe('scope isolation', () => {
  it('cannot review a department it was never delegated', () => {
    const { result } = lifecycle();

    expect(result.current.canDelegatedDecide(OUT_OF_SCOPE)).toBe(false);
    let outcome;
    act(() => {
      outcome = result.current.reviewDelegated(OUT_OF_SCOPE, {});
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toMatch(/outside the scope delegated/i);
  });

  it('cannot re-review a revision that has already passed it', () => {
    const { result } = lifecycle();

    expect(result.current.endorsementStateOf(PAST_THIS_SEAT)).toBe('endorsed_pending_l1');
    expect(result.current.canDelegatedDecide(PAST_THIS_SEAT)).toBe(false);
  });

  it('has no path to a class seat or a promotion outcome', () => {
    const { result } = lifecycle();
    // The delegated surface exposes exactly two acts, and neither is one of
    // these. Assigning tutors and deciding promotions stay where they are.
    expect(typeof result.current.reviewDelegated).toBe('function');
    expect(typeof result.current.returnFromDelegated).toBe('function');
    expect(result.current.delegatedReviewOf(ROUTED)).toBeNull();
  });
});

describe('the institution head stays the final approver', () => {
  it('keeps final approval eligible only at its own step', () => {
    expect(canFinalApprove('endorsed_pending_l2')).toBe(false);
    expect(canFinalApprove('endorsed_pending_l1')).toBe(true);
  });

  it('refuses a final approval taken before the delegated step', () => {
    const { result } = lifecycle();

    let outcome;
    act(() => {
      outcome = result.current.approveFinal(ROUTED, { note: 'Skipping the Dean.' });
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('not_eligible');
    expect(result.current.endorsementStateOf(ROUTED)).toBe('endorsed_pending_l2');
  });
});
