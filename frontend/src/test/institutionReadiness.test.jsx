import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { WorkspaceProvider } from '../store/WorkspaceProvider';
import { ComposerProvider } from '../store/ComposerProvider';
import {
  capacityReading,
  coverageReading,
  deriveInstitutionReadiness,
  promotionReading,
  timetableReading,
  attendanceReading,
  yearReading,
} from '../lib/institutionReadiness';
import { INSTITUTION, DEPARTMENTS, departmentLabel } from '../lib/institutionData';
import { PROVISIONING, PROVISIONING_WITHOUT_LEVEL_2, level2Scope } from '../lib/provisioning';
import { level2Seat } from '../lib/seatState';
import { BASELINE_TERM } from '../lib/academicTerm';
import { ACTIVE_CLASSES } from '../lib/academicCalendar';
import { studentsOfClass } from '../lib/rosterData';
import { timetableStateOfClass, attendanceLiveFor } from '../lib/timetableState';
import { tutorCoverage, hodCoverage } from '../lib/seatState';
import { seatTitle } from '../lib/seatTitles';
import { PRINCIPAL_L1 } from '../lib/roles';
import { REVIEW_CANDIDATES } from '../lib/promotionData';
import { DEPARTMENT_ID } from '../lib/departmentData';

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

async function useView(user, name) {
  await user.click(screen.getByRole('button', { name: /open profile/i }));
  const group = await screen.findByRole('radiogroup', { name: /workspace view/i });
  await user.click(within(group).getByRole('radio', { name }));
  await user.click(screen.getByRole('button', { name: /close profile/i }));
}

async function navigateVia(user, name) {
  const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
  await user.click(within(nav).getByRole('link', { name }));
}

const readiness = deriveInstitutionReadiness({
  institution: INSTITUTION,
  provisioning: PROVISIONING,
  term: BASELINE_TERM,
  classes: ACTIVE_CLASSES,
  departments: DEPARTMENTS,
  enrolledOf: (id) => studentsOfClass(id).length,
  tutorCoverage: tutorCoverage(),
  hodCoverage: hodCoverage(),
  promotionProgress: [
    { departmentId: DEPARTMENT_ID, total: REVIEW_CANDIDATES.length, reviewed: 0, pending: REVIEW_CANDIDATES.length, byOutcome: {} },
  ],
  departmentName: departmentLabel,
  timetableStateOf: timetableStateOfClass,
  attendanceLiveFor: (id) => attendanceLiveFor(id),
});

describe('Every institution figure derives from a canonical layer', () => {
  it('counts departments and classes off the provisioning and the band', () => {
    expect(readiness.scale.departmentCount).toBe(DEPARTMENTS.length);
    expect(readiness.scale.classCount).toBe(ACTIVE_CLASSES.length);
  });

  it('measures enrolment against the running classes’ capacity, not approved intake', () => {
    const capacity = ACTIVE_CLASSES.reduce((sum, c) => sum + c.capacity, 0);
    const enrolled = ACTIVE_CLASSES.reduce((sum, c) => sum + studentsOfClass(c.id).length, 0);
    const intake = DEPARTMENTS.reduce((sum, d) => sum + d.intake, 0);

    expect(readiness.capacity.capacity).toBe(capacity);
    expect(readiness.capacity.enrolled).toBe(enrolled);
    // The two are genuinely different numbers, so this is not vacuous: intake is
    // an annual admission figure, capacity is the seats the running classes have.
    expect(capacity).not.toBe(intake);
    expect(readiness.capacity.headroom).toBe(capacity - enrolled);
  });

  it('reads both seat coverages off the seat records, with invitations separate', () => {
    expect(readiness.seats.hod).toEqual(coverageReading(hodCoverage()));
    expect(readiness.seats.tutor).toEqual(coverageReading(tutorCoverage()));
    // An invitation is never folded into the active figure.
    const { active, invited, vacant, total } = readiness.seats.tutor;
    expect(active + invited + vacant).toBe(total);
    expect(readiness.seats.tutor.complete).toBe(active === total);
  });

  it('keeps timetable coverage and attendance as two different readings', () => {
    const timetable = timetableReading(ACTIVE_CLASSES, timetableStateOfClass);
    const attendance = attendanceReading(ACTIVE_CLASSES, (id) => attendanceLiveFor(id));

    expect(readiness.timetable).toEqual(timetable);
    expect(readiness.attendance).toEqual(attendance);
    // A class with a revision in review is covered but not settled — the
    // distinction attendance depends on.
    expect(timetable.covered).toBe(timetable.approved + timetable.pending);
    expect(timetable.pending).toBeGreaterThan(0);
    expect(attendance.live).toBe(timetable.settled);
  });

  it('states an academic year with no term as an absence rather than a state', () => {
    const none = yearReading(null);
    expect(none.isNone).toBe(true);
    expect(none.active).toBe(false);
    expect(none.band).toBe('—');
    expect(none.label).toBe('—');
  });

  it('renders the configured seat title rather than an L-number', () => {
    expect(readiness.identity.seatTitle).toBe(seatTitle(PRINCIPAL_L1));
    expect(readiness.identity.institutionName).toBe(INSTITUTION.name);
    const other = deriveInstitutionReadiness({
      ...{
        institution: INSTITUTION,
        term: BASELINE_TERM,
        classes: [],
        departments: [],
        enrolledOf: () => 0,
        tutorCoverage: { total: 0, active: 0, invited: 0, vacant: 0 },
        hodCoverage: { total: 0, active: 0, invited: 0, vacant: 0 },
        promotionProgress: [],
        departmentName: () => '',
        timetableStateOf: () => 'not_submitted',
        attendanceLiveFor: () => false,
      },
      provisioning: PROVISIONING_WITHOUT_LEVEL_2,
    });
    expect(other.identity.seatTitle).toBe('Director');
  });

  it('aggregates promotion progress without carrying a single student', () => {
    const progress = promotionReading(
      [
        { departmentId: 'a', total: 4, reviewed: 1, pending: 3 },
        { departmentId: 'b', total: 6, reviewed: 6, pending: 0 },
      ],
      () => 'Department'
    );
    expect(progress.total).toBe(10);
    expect(progress.reviewed).toBe(7);
    expect(progress.pending).toBe(3);
    expect(progress.byDepartment[1].percent).toBe(100);
    // Counts only — no student, no outcome, nothing decidable.
    progress.byDepartment.forEach((d) => {
      expect(d).not.toHaveProperty('students');
      expect(d).not.toHaveProperty('outcome');
    });
  });

  it('reports zero utilisation rather than dividing by nothing', () => {
    expect(capacityReading([], () => 0).utilisation).toBe(0);
    expect(attendanceReading([], () => true).percent).toBe(0);
  });
});

describe('The institution head’s scope is institution-wide', () => {
  it('reads every department, where a head of department reads one', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await useView(user, /principal/i);
    await navigateVia(user, /^departments$/i);

    for (const d of DEPARTMENTS) {
      expect(await screen.findByText(d.name)).toBeInTheDocument();
    }

    // The same nav item in the head-of-department workspace is a department's
    // own classes — the scope is genuinely different, not a wider filter.
    await useView(user, /head of department/i);
    const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(within(nav).queryByRole('link', { name: /^departments$/i })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /^department$/i })).toBeInTheDocument();
  });
});

describe('Provisioning is not presented as this seat’s work', () => {
  it('reports departments as provisioned rather than as something to set up', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await useView(user, /principal/i);
    await navigateVia(user, /^institution$/i);

    const panel = await screen.findByRole('region', { name: /operational readiness/i });
    expect(within(panel).getByText(/departments provisioned/i)).toBeInTheDocument();
    expect(
      within(panel).getByText(/structure, intake and section capacities are provisioned/i)
    ).toBeInTheDocument();

    // The old first-login framing is gone.
    expect(within(panel).queryByText(/complete these foundations/i)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/institution setup/i)).not.toBeInTheDocument();
    expect(within(panel).queryByText(/setup in progress/i)).not.toBeInTheDocument();
  });

  it('offers no control that creates or edits provisioned structure', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await useView(user, /principal/i);

    for (const item of [/^institution$/i, /^departments$/i, /^academic year$/i]) {
      await navigateVia(user, item);
      [/add a department/i, /new department/i, /edit intake/i, /edit capacity/i, /add section/i].forEach(
        (name) => {
          expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
        }
      );
    }
  });
});

describe('Promotion outcomes are not this seat’s to choose', () => {
  it('shows progress per department and no outcome control anywhere', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await useView(user, /principal/i);
    await navigateVia(user, /^institution$/i);

    const block = (await screen.findByRole('heading', { name: /promotion review/i })).closest(
      'section'
    );
    expect(within(block).getByText(/confirmed by the department head/i)).toBeInTheDocument();

    [/^promote$/i, /^detain$/i, /^transfer$/i, /section change/i].forEach((name) => {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
      expect(screen.queryByRole('radio', { name })).not.toBeInTheDocument();
    });
  });
});

describe('The delegated seat is a summary on the institution screen', () => {
  it('states its title, occupancy, scope and chain placement when provisioned', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await useView(user, /principal/i);
    await navigateVia(user, /^institution$/i);

    const summary = await screen.findByRole('region', { name: /dean — academic affairs/i });
    expect(within(summary).getByText(/in the timetable approval chain/i)).toBeInTheDocument();
    expect(
      within(summary).getByText(new RegExp(level2Scope().areas[0], 'i'))
    ).toBeInTheDocument();
    /*
     * The seat has a workspace of its own now, and this panel still is not a
     * way into it: what an institution head needs here is configuration and
     * occupancy, not somebody else's screens.
     */
    expect(
      within(summary).getByText(/works in its own workspace/i)
    ).toBeInTheDocument();
    expect(within(summary).queryByRole('link')).not.toBeInTheDocument();
  });

  /*
   * The delegated workspace exists now, but it belongs to the delegated seat.
   * The institution head's own menu must not grow a way into it — a seat's
   * screens are entered by holding that seat, not by linking across from
   * another one.
   */
  it('adds no delegated destination to the institution menu', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await useView(user, /principal/i);

    const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(within(nav).queryByRole('link', { name: /dean/i })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /delegated/i })).not.toBeInTheDocument();
    nav.querySelectorAll('a').forEach((link) => {
      expect(link.getAttribute('href') ?? '').not.toMatch(/\/delegated/);
    });
  });

  it('answers a delegated deep link from another seat rather than absorbing it', async () => {
    renderApp('/delegated');
    /*
     * The Staff view is active by default and holds no delegated seat. The URL
     * gets the delegated gate's own explanation — not Home, and not a redirect
     * that would have silently produced the Staff workspace.
     */
    expect(
      await screen.findByText(/delegated workspace is not part of the workspace view/i)
    ).toBeInTheDocument();
  });

  it('renders nothing at all for an institution provisioned without one', () => {
    // The null is what makes "do not render an empty card" structural rather
    // than a rule every caller has to remember.
    expect(level2Seat(PROVISIONING_WITHOUT_LEVEL_2)).toBeNull();
    expect(level2Scope(PROVISIONING_WITHOUT_LEVEL_2)).toBeNull();
  });
});
