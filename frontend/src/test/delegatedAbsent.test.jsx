import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  PROVISIONING,
  PROVISIONING_WITHOUT_LEVEL_2,
  PROVISIONING_WITH_VACANT_LEVEL_2,
  level2InTimetableChain,
  level2Scope,
} from '../lib/provisioning';
import {
  canDelegatedReview,
  delegatedBlockReason,
  delegatedEnterable,
  delegatedNavItems,
  delegatedRegistered,
  delegatedScope,
} from '../lib/delegatedScope';
import { level2Seat } from '../lib/seatState';
import {
  chainProgress,
  endorsedStateFor,
  endorsementChain,
  endorsementChainLabel,
  canFinalApprove,
} from '../lib/endorsementChain';
import { LEVEL_2, PRINCIPAL_L1 } from '../lib/roles';
import { renderApp as renderAppShared } from './renderApp';

/**
 * Three states, kept structurally apart: **absent**, **configured but vacant**,
 * and **configured and held**.
 *
 * Collapsing any two of them is the defect these assertions exist to prevent. An
 * institution with no delegated seat must have no delegated anything — and, most
 * of all, a `/delegated` URL there must not quietly become somebody else's
 * workspace. An institution whose delegated seat is merely empty is not that
 * institution: its chain still runs through the seat, and a revision routed
 * there keeps waiting rather than skipping to the institution head.
 */

const ABSENT = PROVISIONING_WITHOUT_LEVEL_2;
const VACANT = PROVISIONING_WITH_VACANT_LEVEL_2;

function renderApp(route = '/', options) {
  return renderAppShared(route, options);
}

describe('L2 absent — the structure collapses entirely', () => {
  it('has no delegated scope, seat, registration or entry', () => {
    expect(level2Scope(ABSENT)).toBeNull();
    expect(level2Seat(ABSENT)).toBeNull();
    expect(delegatedScope(ABSENT)).toBeNull();
    expect(delegatedRegistered(ABSENT)).toBe(false);
    expect(delegatedEnterable(ABSENT)).toBe(false);
  });

  it('has no delegated navigation at all', () => {
    expect(delegatedNavItems(delegatedScope(ABSENT))).toEqual([]);
  });

  it('collapses the timetable chain to two steps', () => {
    expect(level2InTimetableChain(ABSENT)).toBe(false);
    expect(endorsementChain(ABSENT).map((s) => s.key)).toEqual(['hod_l3', 'principal_l1']);
    expect(endorsementChainLabel(ABSENT)).toBe('Department Head endorsement → Director final approval');
  });

  it('routes an endorsement straight to final approval, never through a seat that is not there', () => {
    const state = endorsedStateFor(ABSENT);
    expect(state).toBe('endorsed_pending_l1');
    expect(canFinalApprove(state)).toBe(true);
  });

  it('never leaves an endorsement waiting on a nonexistent decision', () => {
    const steps = chainProgress('endorsed_pending_l1', ABSENT);
    expect(steps.map((s) => s.title)).not.toContain(expect.stringContaining('Delegated'));
    expect(steps[steps.length - 1].state).toBe('current');
  });

  it('can decide nothing through the delegated path', () => {
    expect(canDelegatedReview('endorsed_pending_l2', delegatedScope(ABSENT))).toBe(false);
    expect(delegatedBlockReason('endorsed_pending_l2', delegatedScope(ABSENT))).toMatch(/no delegated position/i);
  });
});

describe('L2 absent — a delegated deep link never becomes Staff', () => {
  /*
   * The live fixture *has* a delegated seat, so the absent institution's route
   * table cannot be rendered here. What the interface can be held to is the
   * rule underneath: the delegated path resolves to a delegated answer, and the
   * personal Staff workspace is never what a `/delegated` URL produces. The
   * registration predicate above is what decides which of the two answers it
   * gets, and it is asserted directly.
   */
  it('renders a delegated answer for a delegated URL, not Staff home', async () => {
    renderApp('/delegated');

    // The Staff view is active by default and holds no delegated seat, so this
    // deep link must be answered rather than silently absorbed.
    expect(await screen.findByText(/delegated workspace/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Good (morning|afternoon|evening)/i })).toBeNull();
  });

  it('keeps the Staff menu out of the answer', async () => {
    renderApp('/delegated');
    await screen.findByText(/delegated workspace/i);

    const nav = screen.getByRole('navigation', { name: /navigation/i });
    expect(within(nav).queryByRole('link', { name: /Delegated Overview/i })).toBeNull();
  });

  it('offers no delegated entry in the switcher for an institution without the seat', () => {
    // The filter the switcher applies, asserted against the absent fixture
    // directly — the switcher itself can only render the live one.
    expect(delegatedEnterable(ABSENT)).toBe(false);
  });
});

describe('L2 configured but vacant', () => {
  it('keeps the structure and the chain, and loses only the occupant', () => {
    const scope = delegatedScope(VACANT);
    expect(scope).not.toBeNull();
    expect(scope.occupied).toBe(false);
    expect(scope.seat.state).toBe('vacant');
    expect(scope.seat.holderName).toBeNull();
    expect(scope.inTimetableChain).toBe(true);
    expect(endorsementChain(VACANT).map((s) => s.key)).toEqual(['hod_l3', LEVEL_2, PRINCIPAL_L1]);
  });

  it('registers the workspace but admits nobody into it', () => {
    expect(delegatedRegistered(VACANT)).toBe(true);
    expect(delegatedEnterable(VACANT)).toBe(false);
  });

  it('keeps a routed revision waiting on the empty seat rather than skipping ahead', () => {
    expect(endorsedStateFor(VACANT)).toBe('endorsed_pending_l2');
    expect(canFinalApprove(endorsedStateFor(VACANT))).toBe(false);
    expect(
      canDelegatedReview('endorsed_pending_l2', delegatedScope(VACANT), {
        departmentId: 'dept-ece',
      }),
    ).toBe(false);
    expect(delegatedBlockReason('endorsed_pending_l2', delegatedScope(VACANT), { departmentId: 'dept-ece' })).toMatch(
      /vacant/i,
    );
  });
});

describe('L2 configured and held — the live fixture', () => {
  it('is the third state, and none of the other two', () => {
    expect(delegatedRegistered(PROVISIONING)).toBe(true);
    expect(delegatedEnterable(PROVISIONING)).toBe(true);
    expect(delegatedScope(PROVISIONING).seat.state).toBe('active');
  });

  it('offers a delegated switcher entry only in this state', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: /open profile/i }));
    const group = await screen.findByRole('radiogroup', { name: /workspace view/i });
    expect(within(group).getByRole('radio', { name: /Dean — Academic Affairs/i })).toBeTruthy();
  });
});
