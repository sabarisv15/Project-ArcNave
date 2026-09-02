import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ENDORSEMENT_STATES,
  canEndorse,
  chainProgress,
  endorsedStateFor,
  endorsementChain,
  endorsementChainLabel,
  endorsementStateOf,
  nextSeatFor,
} from '../lib/endorsementChain';
import { PROVISIONING, PROVISIONING_WITHOUT_LEVEL_2 } from '../lib/provisioning';
import { LIVE_VERSION_ID, TIMETABLE_VERSIONS, findConflicts } from '../lib/departmentTimetableData';
import { DEPT_FACULTY } from '../lib/departmentData';
import { FACULTY_LOAD } from '../lib/departmentSignals';
import { FACULTY_LIFECYCLE_STATES, LIFECYCLE_KEYS, isAssignable, reassignmentPreflight } from '../lib/facultyLifecycle';
import { CLASS_TUTOR_SEATS } from '../lib/seatState';
import { renderApp as renderAppShared } from './renderApp';

/**
 * What a Head of Department may say about a timetable, and about its own
 * faculty.
 *
 * The endorsement half exists because of one word. "Approved" belongs to the
 * final approver, and this seat is not it — an endorsed revision is on its way
 * somewhere, and the interface has to be able to say where without knowing
 * whether the institution provisioned a delegated seat in between.
 */

function renderApp(route = '/department/timetable', options) {
  return renderAppShared(route, options);
}

async function useHodView(user) {
  await user.click(await screen.findByRole('button', { name: /open profile/i }));
  const group = await screen.findByRole('radiogroup', { name: /workspace view/i });
  await user.click(within(group).getByRole('radio', { name: /head of department/i }));
  await user.click(screen.getByRole('button', { name: /close profile/i }));
}

const stateOf = (v) => endorsementStateOf(v, { liveVersionId: LIVE_VERSION_ID });

describe('The approval chain is configuration', () => {
  it('routes through the delegated seat when the institution provisioned one', () => {
    const chain = endorsementChain(PROVISIONING);
    expect(chain).toHaveLength(3);
    expect(endorsementChainLabel(PROVISIONING)).toBe(
      'Head of Department endorsement → Dean — Academic Affairs review → Principal final approval',
    );
    expect(endorsedStateFor(PROVISIONING)).toBe('endorsed_pending_l2');
    expect(nextSeatFor('endorsed_pending_l2', PROVISIONING)).toBe('Dean — Academic Affairs review');
  });

  it('routes straight to the institution head when it did not', () => {
    const chain = endorsementChain(PROVISIONING_WITHOUT_LEVEL_2);
    expect(chain).toHaveLength(2);
    // Configured titles, never an L-number and never a second product concept.
    expect(endorsementChainLabel(PROVISIONING_WITHOUT_LEVEL_2)).toBe(
      'Department Head endorsement → Director final approval',
    );
    expect(endorsedStateFor(PROVISIONING_WITHOUT_LEVEL_2)).toBe('endorsed_pending_l1');
    expect(nextSeatFor('endorsed_pending_l1', PROVISIONING_WITHOUT_LEVEL_2)).toBe('Director final approval');
    // The delegated step is absent, not hidden.
    expect(endorsementChainLabel(PROVISIONING_WITHOUT_LEVEL_2)).not.toMatch(/review/);
  });

  it('marks the seat a revision is waiting on, in either configuration', () => {
    const withL2 = chainProgress('ready_for_endorsement', PROVISIONING);
    expect(withL2.map((s) => s.state)).toEqual(['current', 'pending', 'pending']);

    const endorsedWithL2 = chainProgress('endorsed_pending_l2', PROVISIONING);
    expect(endorsedWithL2.map((s) => s.state)).toEqual(['done', 'current', 'pending']);

    const endorsedWithout = chainProgress('endorsed_pending_l1', PROVISIONING_WITHOUT_LEVEL_2);
    expect(endorsedWithout.map((s) => s.state)).toEqual(['done', 'current']);

    // Nobody is waiting on a locked timetable.
    expect(chainProgress('approved_locked', PROVISIONING).every((s) => s.state === 'done')).toBe(true);
    expect(nextSeatFor('approved_locked', PROVISIONING)).toBeNull();
  });
});

describe('Every timetable state the department can be in has a real version', () => {
  it('resolves each fixture to its own state', () => {
    const states = TIMETABLE_VERSIONS.map(stateOf);

    expect(states).toContain('approved_locked'); // the live grid
    expect(states).toContain('superseded'); // a previous approved one
    expect(states).toContain('ready_for_endorsement'); // waiting on this seat
    expect(states).toContain('conflict_identified'); // submitted, still clashing
    expect(states).toContain('not_submitted'); // finished and never sent
    expect(states).toContain('draft'); // still being written

    states.forEach((s) => expect(ENDORSEMENT_STATES[s]).toBeTruthy());
  });

  it('reads a conflicted revision off its own grid rather than a stored flag', () => {
    const conflicted = TIMETABLE_VERSIONS.find((v) => stateOf(v) === 'conflict_identified');
    expect(findConflicts(conflicted.cells).length).toBeGreaterThan(0);

    const ready = TIMETABLE_VERSIONS.find((v) => stateOf(v) === 'ready_for_endorsement');
    expect(findConflicts(ready.cells)).toHaveLength(0);
  });

  it('lets this seat endorse only a submitted, conflict-free revision', () => {
    expect(canEndorse('ready_for_endorsement')).toBe(true);
    // Sending a self-clashing grid onward makes it somebody else's problem
    // without making it any less wrong.
    expect(canEndorse('conflict_identified')).toBe(false);
    expect(canEndorse('not_submitted')).toBe(false);
    expect(canEndorse('draft')).toBe(false);
    expect(canEndorse('approved_locked')).toBe(false);
    expect(canEndorse('endorsed_pending_l2')).toBe(false);
  });

  it('never produces a final approval from an endorsement', () => {
    expect(endorsedStateFor(PROVISIONING)).not.toBe('approved_locked');
    expect(endorsedStateFor(PROVISIONING_WITHOUT_LEVEL_2)).not.toBe('approved_locked');
    // Only the live version is approved, and only because it is the live one.
    const approved = TIMETABLE_VERSIONS.filter((v) => stateOf(v) === 'approved_locked');
    expect(approved).toHaveLength(1);
    expect(approved[0].id).toBe(LIVE_VERSION_ID);
  });
});

describe('Department → Timetable', () => {
  it('offers endorsement and no final approval', async () => {
    const user = userEvent.setup();
    renderApp();
    await useHodView(user);

    await user.click(await screen.findByRole('tab', { name: /revisions/i }));
    const rows = await screen.findAllByRole('button', { name: /— open revision$/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog', { name: /revision/i });
    expect(within(drawer).getByRole('button', { name: 'Endorse' })).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /^Approve$/ })).not.toBeInTheDocument();
    expect(within(drawer).getByText(/Endorsement is not final approval/i)).toBeInTheDocument();
  });

  it('renders the configured chain, delegated step included', async () => {
    const user = userEvent.setup();
    renderApp();
    await useHodView(user);

    await user.click(await screen.findByRole('tab', { name: /revisions/i }));
    endorsementChain(PROVISIONING).forEach((step) => {
      expect(screen.getAllByText(step.title).length).toBeGreaterThan(0);
    });
  });

  it('will not endorse a revision that still carries a conflict', async () => {
    const user = userEvent.setup();
    renderApp();
    await useHodView(user);

    await user.click(await screen.findByRole('tab', { name: /revisions/i }));
    const conflicted = TIMETABLE_VERSIONS.find((v) => stateOf(v) === 'conflict_identified');
    await user.click(await screen.findByRole('button', { name: `${conflicted.label} — open revision` }));

    const drawer = await screen.findByRole('dialog', { name: /revision/i });
    expect(within(drawer).queryByRole('button', { name: 'Endorse' })).not.toBeInTheDocument();
    expect(within(drawer).getByText(/cannot be endorsed until its conflicts are resolved/i)).toBeInTheDocument();
  });
});

describe('Faculty lifecycle is department-scoped', () => {
  it('gives every lifecycle state a real member', () => {
    LIFECYCLE_KEYS.forEach((key) => {
      expect(DEPT_FACULTY.some((f) => f.lifecycle === key)).toBe(true);
    });
  });

  it('separates attachment from availability and from workload', () => {
    // Somebody who has not accepted an invitation is not spare capacity.
    const invited = DEPT_FACULTY.find((f) => f.lifecycle === 'invite_pending');
    expect(isAssignable(invited)).toBe(false);
    expect(FACULTY_LOAD.find((l) => l.faculty.id === invited.id).state).toBe('not_teaching');

    // Somebody on leave is attached, and still unavailable.
    const onLeave = DEPT_FACULTY.find((f) => f.availability === 'unavailable');
    expect(onLeave.lifecycle).toBe('active');
    expect(isAssignable(onLeave)).toBe(false);
    expect(FACULTY_LOAD.find((l) => l.faculty.id === onLeave.id).state).toBe('unavailable');

    // And the one genuinely free person is still the one signal reads.
    expect(FACULTY_LOAD.filter((l) => l.state === 'unassigned')).toHaveLength(1);
  });

  it('warns before an outgoing tutor leaves a class uncovered', () => {
    const held = CLASS_TUTOR_SEATS.find((s) => s.state === 'active');
    const preflight = reassignmentPreflight(held.holderId, CLASS_TUTOR_SEATS, {
      classLabel: () => 'III B.Sc CS — A',
    });

    expect(preflight.seats.length).toBeGreaterThan(0);
    expect(preflight.message).toMatch(/becomes vacant unless it is reassigned first/i);
    // A preflight, not a veto: an HOD may need to do it anyway.
    expect(preflight.blocking).toBe(false);

    const free = DEPT_FACULTY.find((f) => f.lifecycle === 'deactivated');
    expect(reassignmentPreflight(free.id, CLASS_TUTOR_SEATS).message).toBeNull();
  });

  it('shows attachment beside workload without becoming an HR screen', async () => {
    const user = userEvent.setup();
    renderApp('/department/faculty');
    await useHodView(user);

    expect(await screen.findByRole('heading', { name: 'Faculty' })).toBeInTheDocument();
    expect(screen.getAllByText(FACULTY_LIFECYCLE_STATES.invite_pending.label).length).toBeGreaterThan(0);
    expect(screen.getAllByText(FACULTY_LIFECYCLE_STATES.deactivated.label).length).toBeGreaterThan(0);
    expect(screen.getByText(/leave and payroll are not handled here/i)).toBeInTheDocument();
  });
});
