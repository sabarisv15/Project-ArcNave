import { act, renderHook, render, screen, within } from '@testing-library/react';
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
import {
  InstitutionalLifecycleProvider,
  useInstitutionalLifecycle,
} from '../store/InstitutionalLifecycleProvider';
import {
  ENDORSEMENT_STATES,
  canFinalApprove,
  chainProgress,
  endorsedStateFor,
  endorsementChain,
  finalApprovalBlockReason,
} from '../lib/endorsementChain';
import { PROVISIONING, PROVISIONING_WITHOUT_LEVEL_2 } from '../lib/provisioning';
import { TIMETABLE_STATES, awaitsFinalApproval } from '../lib/institutionTimetableData';
import { LEVEL_2, HOD_L3, PRINCIPAL_L1 } from '../lib/roles';
import { DEPARTMENT as CSE_DEPARTMENT } from '../lib/departmentData';

const wrapper = ({ children }) => (
  <AcademicTermProvider>
    <AcademicRosterProvider>
      <InstitutionalLifecycleProvider>{children}</InstitutionalLifecycleProvider>
    </AcademicRosterProvider>
  </AcademicTermProvider>
);

const lifecycle = () => renderHook(() => useInstitutionalLifecycle(), { wrapper });

function renderApp(route = '/curriculum') {
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

async function usePrincipalView(user) {
  await user.click(screen.getByRole('button', { name: /open profile/i }));
  const group = await screen.findByRole('radiogroup', { name: /workspace view/i });
  await user.click(within(group).getByRole('radio', { name: /principal/i }));
  await user.click(screen.getByRole('button', { name: /close profile/i }));
}

async function navigateVia(user, name) {
  const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
  await user.click(within(nav).getByRole('link', { name }));
}

/** The one department whose revision is genuinely waiting on this office. */
const awaiting = TIMETABLE_STATES.find(awaitsFinalApproval);

describe('The chain is configuration, and the institution head is last on it', () => {
  it('routes L3 → L2 → L1 when a delegated seat is provisioned', () => {
    const chain = endorsementChain(PROVISIONING);
    expect(chain.map((s) => s.key)).toEqual([HOD_L3, LEVEL_2, PRINCIPAL_L1]);
    expect(endorsedStateFor(PROVISIONING)).toBe('endorsed_pending_l2');
  });

  it('routes L3 → L1 directly when no delegated seat exists', () => {
    const chain = endorsementChain(PROVISIONING_WITHOUT_LEVEL_2);
    expect(chain.map((s) => s.key)).toEqual([HOD_L3, PRINCIPAL_L1]);
    expect(chain.some((s) => s.key === LEVEL_2)).toBe(false);
    // An endorsement goes straight to the final step, so the L2-absent chain
    // reaches the final decision in one move rather than being special-cased.
    expect(endorsedStateFor(PROVISIONING_WITHOUT_LEVEL_2)).toBe('endorsed_pending_l1');
    expect(canFinalApprove(endorsedStateFor(PROVISIONING_WITHOUT_LEVEL_2))).toBe(true);
  });

  it('renders the configured titles rather than an L-number', () => {
    const label = endorsementChain(PROVISIONING_WITHOUT_LEVEL_2)
      .map((s) => s.title)
      .join(' → ');
    expect(label).toMatch(/Department Head/);
    expect(label).toMatch(/Director/);
    expect(label).not.toMatch(/\bL[1-4]\b/);
  });

  it('places the final approval last on the chain in both configurations', () => {
    [PROVISIONING, PROVISIONING_WITHOUT_LEVEL_2].forEach((p) => {
      const chain = endorsementChain(p);
      expect(chain[chain.length - 1].key).toBe(PRINCIPAL_L1);
    });
  });
});

describe('The final decision is available at exactly one state', () => {
  it('permits only a revision that has cleared every step before it', () => {
    expect(canFinalApprove('endorsed_pending_l1')).toBe(true);

    // Everything else, and each for its own reason.
    ['not_submitted', 'draft', 'conflict_identified', 'ready_for_endorsement', 'endorsed_pending_l2', 'approved_locked', 'superseded', 'rejected'].forEach(
      (state) => {
        expect(canFinalApprove(state)).toBe(false);
        expect(finalApprovalBlockReason(state)).toBeTruthy();
      }
    );
  });

  it('refuses a conflicted revision, and says why rather than going quiet', () => {
    expect(finalApprovalBlockReason('conflict_identified')).toMatch(/clashes with itself/i);
  });

  it('refuses to skip a configured delegated seat', () => {
    const reason = finalApprovalBlockReason('endorsed_pending_l2', PROVISIONING);
    expect(reason).toMatch(/Dean — Academic Affairs/);
    expect(reason).toMatch(/approval chain/i);
  });

  it('refuses a revision the department has not endorsed', () => {
    expect(finalApprovalBlockReason('ready_for_endorsement')).toMatch(/Head of Department/);
  });
});

describe('Every required visual state has a real member', () => {
  it('covers the whole chain across the six departments’ revisions', () => {
    const states = new Set(TIMETABLE_STATES.map((s) => s.endorsementState));
    [
      'not_submitted',
      'draft',
      'conflict_identified',
      'ready_for_endorsement',
      'endorsed_pending_l2',
      'endorsed_pending_l1',
    ].forEach((state) => {
      expect(states.has(state)).toBe(true);
      expect(ENDORSEMENT_STATES[state]).toBeTruthy();
    });

    // The seventh state is the live grid, and every department has one.
    expect(TIMETABLE_STATES.every((s) => Boolean(s.live?.label))).toBe(true);
    // The eighth is a revision in flight over a live grid — both together.
    expect(TIMETABLE_STATES.some((s) => s.pending && s.live)).toBe(true);
  });

  it('only badges a revision as awaiting this office when it genuinely is', () => {
    TIMETABLE_STATES.forEach((s) => {
      expect(awaitsFinalApproval(s)).toBe(s.endorsementState === 'endorsed_pending_l1');
    });
  });

  it('shows the chain position for any state, ending after the final step', () => {
    const done = chainProgress('approved_locked', PROVISIONING);
    expect(done.every((s) => s.state === 'done')).toBe(true);

    const withL2 = chainProgress('endorsed_pending_l1', PROVISIONING);
    expect(withL2.find((s) => s.key === LEVEL_2).state).toBe('done');
    expect(withL2.find((s) => s.key === PRINCIPAL_L1).state).toBe('current');
  });
});

describe('Deciding a revision never disturbs the live timetable', () => {
  it('approves an eligible revision and leaves the live grid exactly as it was', () => {
    const { result } = lifecycle();
    const live = awaiting.live.label;

    let outcome;
    act(() => {
      outcome = result.current.approveFinal(awaiting.departmentId, { note: 'Cleared the lab clash.' });
    });

    expect(outcome.ok).toBe(true);
    expect(result.current.endorsementStateOf(awaiting.departmentId)).toBe('approved_locked');
    // The department's live grid is a separate field the decision does not touch.
    expect(awaiting.live.label).toBe(live);
    expect(
      TIMETABLE_STATES.find((s) => s.departmentId === awaiting.departmentId).live.label
    ).toBe(live);
    // And a revision is still not the same thing as the live version.
    expect(TIMETABLE_STATES.every((s) => s.live.label !== s.revision?.label)).toBe(true);
  });

  it('returns an eligible revision only with a reason', () => {
    const { result } = lifecycle();

    let refused;
    act(() => {
      refused = result.current.returnForRevision(awaiting.departmentId, { reason: '   ' });
    });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('reason_required');
    expect(result.current.endorsementStateOf(awaiting.departmentId)).toBe('endorsed_pending_l1');

    let accepted;
    act(() => {
      accepted = result.current.returnForRevision(awaiting.departmentId, {
        reason: 'The Friday lab block still collides with the shared CAD slot.',
      });
    });
    expect(accepted.ok).toBe(true);
    expect(result.current.endorsementStateOf(awaiting.departmentId)).toBe('rejected');
  });

  it('refuses every department the chain has not delivered to this office', () => {
    const { result } = lifecycle();

    TIMETABLE_STATES.filter((s) => !awaitsFinalApproval(s)).forEach((s) => {
      expect(result.current.canDecide(s.departmentId)).toBe(false);
      expect(result.current.blockReasonFor(s.departmentId)).toBeTruthy();

      let outcome;
      act(() => {
        outcome = result.current.approveFinal(s.departmentId, {});
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe('not_eligible');
      // Still exactly where it was.
      expect(result.current.endorsementStateOf(s.departmentId)).toBe(s.endorsementState);
    });
  });

  it('refuses to decide the same revision twice', () => {
    const { result } = lifecycle();

    act(() => {
      result.current.approveFinal(awaiting.departmentId, {});
    });

    let second;
    act(() => {
      second = result.current.approveFinal(awaiting.departmentId, {});
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('already_decided');
  });
});

describe('The timetable page shows both, and decides only what it may', () => {
  it('renders the live grid and the revision as separate readings', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);
    await navigateVia(user, /^timetable$/i);

    const row = await screen.findByRole('button', {
      name: new RegExp(`${CSE_DEPARTMENT.name} — open timetable decision`, 'i'),
    });
    expect(within(row).getByText(/live timetable unchanged/i)).toBeInTheDocument();
    expect(
      within(row).getByText(ENDORSEMENT_STATES.endorsed_pending_l1.label)
    ).toBeInTheDocument();
  });

  it('states why a revision cannot be decided instead of hiding the reason', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);
    await navigateVia(user, /^timetable$/i);

    const blocked = TIMETABLE_STATES.find((s) => s.endorsementState === 'endorsed_pending_l2');
    const dept = await screen.findByRole('button', {
      name: /electronics.*open timetable decision/i,
    });
    await user.click(dept);

    const dialog = await screen.findByRole('dialog');
    // Named twice on purpose — as the seat it is waiting on, and as the reason
    // there is nothing to decide here.
    expect(within(dialog).getAllByText(/Dean — Academic Affairs/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/waiting on .* review/i)).toBeInTheDocument();
    // No decision is offered for a revision this office may not decide.
    expect(within(dialog).queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    expect(blocked.endorsementState).toBe('endorsed_pending_l2');
  });
});
