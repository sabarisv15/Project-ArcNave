import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { WorkspaceProvider } from '../store/WorkspaceProvider';
import { ComposerProvider } from '../store/ComposerProvider';
import { CLASS_ROSTER, CURRENT_HOUR, LOW_ATTENDANCE_WATCHLIST, TODAY_HOURS } from '../lib/classTutorData';
import { TIMETABLE_VERSIONS, CLASS_TIMETABLE } from '../lib/classTimetableData';

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
    </QueryClientProvider>,
  );
}

/**
 * Switches the prototype into the Class Tutor view through the profile drawer.
 *
 * Required before any class route, not merely convenient: `ClassGate` renders
 * the class workspace only in this seat's view. These tests used to deep-link
 * straight in, which worked only because L4 was the one seat without the guard
 * `/department` and `/institution` already had.
 */
async function useClassTutorSeat(user) {
  await user.click(screen.getByRole('button', { name: /open profile/i }));
  const group = await screen.findByRole('radiogroup', { name: /workspace view/i });
  await user.click(within(group).getByRole('radio', { name: /class tutor/i }));
  await user.click(screen.getByRole('button', { name: /close profile/i }));
}

describe('Class Tutor seat — navigation', () => {
  it('shows the staff menu until the seat is switched, then the tutor menu', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');

    const before = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(within(before).getByRole('link', { name: /attendance & class log/i })).toBeInTheDocument();
    expect(within(before).queryByRole('link', { name: /my class/i })).not.toBeInTheDocument();

    await useClassTutorSeat(user);

    const after = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(within(after).getByRole('link', { name: /my class/i })).toBeInTheDocument();
    expect(within(after).getByRole('link', { name: /approvals/i })).toBeInTheDocument();
    expect(within(after).queryByRole('link', { name: /assessments/i })).not.toBeInTheDocument();
  });

  it('offers no destination that has not been built', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await useClassTutorSeat(user);

    const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    // Examinations and Reports are planned but not implemented — a menu entry
    // for either would be a dead link, not a preview.
    expect(within(nav).queryByRole('link', { name: /examinations/i })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /^reports$/i })).not.toBeInTheDocument();
  });
});

describe('My Class dashboard', () => {
  it('never reports a figure for an hour nobody has marked', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class');
    await useClassTutorSeat(user);
    // Heading, not text: with the seat entered, "My Class" is also the sidebar
    // nav item for this destination.
    expect(await screen.findByRole('heading', { name: /^my class$/i })).toBeInTheDocument();

    // The fixture's current hour is deliberately unmarked, which is the case
    // that must never render as a count — least of all zero.
    expect(CURRENT_HOUR.marked).toBe(false);
    expect(screen.getByText('Not marked yet')).toBeInTheDocument();
  });

  it('says what period each figure covers', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class');
    await useClassTutorSeat(user);
    // An attendance percentage with no stated period is the misleading case.
    expect(await screen.findByText('Class average, whole term')).toBeInTheDocument();
    const marked = TODAY_HOURS.filter((h) => h.marked).length;
    expect(screen.getByText(`Present all ${marked} marked hours`)).toBeInTheDocument();
  });

  it('lists only students below the threshold on the watchlist', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class');
    await useClassTutorSeat(user);
    expect(await screen.findByText('Low-attendance watchlist')).toBeInTheDocument();
    expect(LOW_ATTENDANCE_WATCHLIST.every((s) => s.attendance < 75)).toBe(true);
    expect(LOW_ATTENDANCE_WATCHLIST.length).toBeLessThan(CLASS_ROSTER.length / 2);
  });
});

describe('My Class students', () => {
  it('is scoped to one class with no way to reach another', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class/students');
    await useClassTutorSeat(user);
    expect(await screen.findByRole('heading', { name: 'Students' })).toBeInTheDocument();
    // The staff roster's class switcher must not exist here: this seat has one
    // class, so "all my classes" is not a scope it can have.
    expect(screen.queryByRole('button', { name: /all assigned classes/i })).not.toBeInTheDocument();
    expect(screen.getByText(`${CLASS_ROSTER.length} students`)).toBeInTheDocument();
  });

  it('opens a student record with flags, finance and timeline', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class/students');
    await useClassTutorSeat(user);
    const rows = await screen.findAllByRole('button', { name: /open record/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('tab', { name: 'Flags' })).toBeInTheDocument();
    expect(within(drawer).getByRole('tab', { name: 'Finance' })).toBeInTheDocument();
    expect(within(drawer).getByRole('tab', { name: 'Timeline' })).toBeInTheDocument();
  });
});

describe('Class approvals', () => {
  it('shows the original value beside the proposed one', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class/approvals');
    await useClassTutorSeat(user);
    const rows = await screen.findAllByRole('button', { name: /— open$/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog');
    // The whole point of an approval screen: you can see what changes.
    expect(within(drawer).getByText('On record')).toBeInTheDocument();
    expect(within(drawer).getByText('Proposed')).toBeInTheDocument();
    expect(within(drawer).getByText(/requested by/i)).toBeInTheDocument();
  });

  it('records the deciding position, not just the person', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class/approvals');
    await useClassTutorSeat(user);
    const rows = await screen.findAllByRole('button', { name: /— open$/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog');
    await user.click(within(drawer).getByRole('button', { name: 'Approve' }));

    // Moves out of Pending and into Decided, carrying who decided and as what.
    await user.click(screen.getByRole('tab', { name: /decided/i }));
    const decided = await screen.findAllByRole('button', { name: /— open$/i });
    await user.click(decided[0]);
    expect(await screen.findByText(/You · Class Tutor/)).toBeInTheDocument();
  });
});

describe('Scholarship decision', () => {
  it('requires a human decision and a reason before it can be recorded', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class/finance');
    await useClassTutorSeat(user);
    await user.click(await screen.findByRole('tab', { name: /scholarships/i }));
    const rows = await screen.findAllByRole('button', { name: /scholarship eligibility/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('button', { name: /record decision/i })).toBeDisabled();
    await user.click(within(drawer).getByRole('radio', { name: 'Eligible' }));
    // Still blocked: a decision without a reason is not auditable.
    expect(within(drawer).getByRole('button', { name: /record decision/i })).toBeDisabled();
  });

  it('stays usable when there is no AI advisory', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class/finance');
    await useClassTutorSeat(user);
    await user.click(await screen.findByRole('tab', { name: /scholarships/i }));
    const rows = await screen.findAllByRole('button', { name: /scholarship eligibility/i });
    // The fixture withholds an advisory for every fifth roll number.
    await user.click(rows[4]);

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/no ai advisory is available/i)).toBeInTheDocument();
    // The decision controls are present and unaffected.
    expect(within(drawer).getByRole('radio', { name: 'Eligible' })).toBeEnabled();
    expect(within(drawer).getByRole('radio', { name: 'Not eligible' })).toBeEnabled();
  });

  it('marks the AI output as advisory rather than a verdict', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class/finance');
    await useClassTutorSeat(user);
    await user.click(await screen.findByRole('tab', { name: /scholarships/i }));
    const rows = await screen.findAllByRole('button', { name: /scholarship eligibility/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('AI advisory')).toBeInTheDocument();
    expect(within(drawer).getByText(/the eligibility decision is yours/i)).toBeInTheDocument();
  });
});

describe('Class timetable', () => {
  it('keeps the live timetable visible while a revision is under review', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class/timetable');
    await useClassTutorSeat(user);
    const pending = TIMETABLE_VERSIONS.find((v) => v.status === 'pending');
    const live = TIMETABLE_VERSIONS.find((v) => v.id === CLASS_TIMETABLE.liveVersionId);

    expect(pending).toBeTruthy();
    expect(live.status).toBe('locked');
    // The class is still following the approved version; the pending one has
    // not replaced it.
    expect(await screen.findByText(new RegExp(`${pending.label} is with the HOD`))).toBeInTheDocument();
  });

  it('does not claim to know who is available to substitute', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class/timetable');
    await useClassTutorSeat(user);
    await user.click(await screen.findByRole('tab', { name: /substitutes/i }));
    expect(await screen.findByText(/substitute availability is decided by the hod/i)).toBeInTheDocument();
  });
});
