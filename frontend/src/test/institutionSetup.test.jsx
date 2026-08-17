import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { WorkspaceProvider } from '../store/WorkspaceProvider';
import { ComposerProvider } from '../store/ComposerProvider';
import { InstitutionSetupPanel } from '../components/InstitutionSetupPanel';
import {
  INSTITUTION_SETUP,
  INSTITUTION_SETUP_SNAPSHOT,
  SETUP_ROW_ORDER,
  SETUP_SNAPSHOTS,
  deriveInstitutionSetup,
} from '../lib/institutionSetupData';
import { NOT_SUBMITTED_CLASS_IDS, PENDING_CLASS_IDS } from '../lib/timetableState';
import { tutorCoverage } from '../lib/seatState';
import { DEPARTMENTS, INST_CLASSES, INSTITUTION, hodOf } from '../lib/institutionData';

const derive = (key) => deriveInstitutionSetup(SETUP_SNAPSHOTS[key]);

function renderPanel(setup = INSTITUTION_SETUP) {
  return render(
    <MemoryRouter>
      <InstitutionSetupPanel setup={setup} />
    </MemoryRouter>
  );
}

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

describe('Institution setup — row sequence', () => {
  it('keeps the operational order rather than sorting by severity', () => {
    expect(INSTITUTION_SETUP.rows.map((r) => r.id)).toEqual(SETUP_ROW_ORDER);
    // The order is the information: each line has to be true before the next
    // can become true, so every state renders the same sequence.
    Object.keys(SETUP_SNAPSHOTS).forEach((key) => {
      expect(derive(key).rows.map((r) => r.id)).toEqual(SETUP_ROW_ORDER);
    });
  });

  it('renders the rows in that order on the panel itself', () => {
    renderPanel();
    const labels = [
      'Departments',
      'Department heads',
      'Academic Year',
      'Promotion review',
      'Class Tutor coverage',
      'Timetable readiness',
      'Attendance readiness',
    ].map((label) => screen.getByText(label));

    expect(screen.getAllByRole('listitem')).toHaveLength(labels.length);
    labels.slice(1).forEach((node, i) => {
      const follows = labels[i].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(Boolean(follows)).toBe(true);
    });
  });
});

describe('Institution setup — derived counts', () => {
  it('reads department and HOD coverage off the institution fixtures', () => {
    const { counts } = INSTITUTION_SETUP;
    expect(counts.departmentCount).toBe(DEPARTMENTS.length);
    expect(counts.withHod).toBe(DEPARTMENTS.filter((d) => hodOf(d.id)).length);
    // Vacant and invited are different states and are counted separately: an
    // outstanding invitation is not a vacancy, and it is not coverage either.
    expect(counts.vacancies).toBe(DEPARTMENTS.length - counts.withHod - counts.invited);
    expect(counts.vacancies).toBe(1);
    expect(counts.invited).toBe(1);
  });

  it('counts every class in the institution, not a hard-coded total', () => {
    expect(INSTITUTION_SETUP.counts.classCount).toBe(INST_CLASSES.length);
  });

  it('derives timetable and tutor counts from their own fixtures', () => {
    const { counts } = INSTITUTION_SETUP;
    expect(counts.notSubmitted).toBe(NOT_SUBMITTED_CLASS_IDS.length);
    expect(counts.approved).toBe(INST_CLASSES.length - NOT_SUBMITTED_CLASS_IDS.length);
    // Timetable-ready and attendance-settled are different counts: a class with
    // a revision in review keeps the grid it is running, but its timetable is
    // not settled and attendance is not available against it.
    expect(counts.settled).toBe(counts.approved - PENDING_CLASS_IDS.length);

    /*
     * Tutor coverage is read from the canonical seat records — there is no
     * second list of untutored classes any more, which is the whole point: the
     * institution panel and the department screen can no longer disagree about
     * whether a class has a tutor.
     */
    const coverage = tutorCoverage();
    expect(counts.tutored).toBe(coverage.active);
    expect(counts.untutored).toBe(coverage.vacant + coverage.invited);
  });

  it('states the active academic year the institution actually records', () => {
    expect(screenlessValue('academic_year')).toContain(INSTITUTION.academicYear);
  });
});

/** The value sentence of one row, without rendering. */
function screenlessValue(id, setup = INSTITUTION_SETUP) {
  return setup.rows.find((r) => r.id === id).value;
}

function rowState(id, setup = INSTITUTION_SETUP) {
  return setup.rows.find((r) => r.id === id).state;
}

describe('Institution setup — status calculation', () => {
  it('reports the live institution as needing attention, naming what is missing', () => {
    expect(INSTITUTION_SETUP.status).toBe('needs_attention');
    renderPanel();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    // Specific, not a generic alert: the vacancy and the untimetabled classes
    // are both stated on their own rows.
    const { withHod, departmentCount } = INSTITUTION_SETUP.counts;
    expect(
      screen.getByText(new RegExp(`${withHod} of ${departmentCount} departments have an active head`))
    ).toBeInTheDocument();
    expect(screen.getByText('1 vacancy')).toBeInTheDocument();
    expect(screen.getByText('4 not submitted')).toBeInTheDocument();
  });

  it('reports setup in progress when what remains is work already in motion', () => {
    const setup = derive('in_progress');
    expect(setup.status).toBe('in_progress');
    expect(setup.counts.notSubmitted).toBe(0);
    expect(setup.counts.vacancies).toBe(0);
    expect(rowState('hods', setup).label).toBe('Invite pending');
  });

  it('reports ready for operations only when every foundation is in place', () => {
    const setup = derive('ready');
    expect(setup.status).toBe('ready');
    expect(setup.counts.untutored).toBe(0);
    expect(setup.counts.notSubmitted).toBe(0);
    expect(setup.counts.attendanceLive).toBe(setup.counts.classCount);
    expect(rowState('timetable', setup).label).toBe('Ready');
    expect(rowState('class_tutors', setup).label).toBe('Covered');
  });

  it('distinguishes a missing academic year from a missing department', () => {
    const setup = derive('no_academic_year');
    expect(setup.status).toBe('no_academic_year');
    // Governance is intact — this is not a department problem, and the panel
    // must not send the seat looking for one.
    expect(setup.counts.departmentCount).toBe(DEPARTMENTS.length);
    expect(setup.counts.vacancies).toBe(0);
    expect(rowState('departments', setup).kind).toBe('complete');
    expect(rowState('academic_year', setup).label).toBe('Not active');

    renderPanel(setup);
    expect(screen.getByText('No active academic year')).toBeInTheDocument();
  });
});

describe('Institution setup — a vacancy never retracts an operational record', () => {
  it('leaves a headless department’s approved timetable live', () => {
    const headless = INSTITUTION_SETUP_SNAPSHOT.departments.find((d) => d.hod !== 'active');
    expect(headless).toBeDefined();

    const classes = INSTITUTION_SETUP_SNAPSHOT.classes.filter((c) => c.departmentId === headless.id);
    const live = classes.filter((c) => c.timetable !== 'not_submitted');
    // Its head has gone; its timetable has not. Most of its classes are still
    // running against an approved grid.
    expect(live.length).toBeGreaterThan(0);
    expect(live.length).toBe(classes.length - 1);
  });

  it('does not change timetable or attendance readiness when a head is added', () => {
    const withHeads = {
      ...INSTITUTION_SETUP_SNAPSHOT,
      departments: INSTITUTION_SETUP_SNAPSHOT.departments.map((d) => ({ ...d, hod: 'active' })),
    };
    const before = INSTITUTION_SETUP.counts;
    const after = deriveInstitutionSetup(withHeads).counts;
    expect(after.approved).toBe(before.approved);
    expect(after.notSubmitted).toBe(before.notSubmitted);
    expect(after.attendanceLive).toBe(before.attendanceLive);
  });
});

describe('Institution setup — a pending revision does not un-approve the live grid', () => {
  it('counts a class with a revision in review as timetable-approved', () => {
    const pendingClasses = INSTITUTION_SETUP_SNAPSHOT.classes.filter((c) => c.timetable === 'pending');
    expect(pendingClasses.length).toBeGreaterThan(0);
    // They are inside the approved figure, not deducted from it.
    expect(INSTITUTION_SETUP.counts.approved).toBeGreaterThanOrEqual(pendingClasses.length);
    /*
     * …but attendance is not live for them. Readiness and attendance are
     * separate consequences of the same field: the class keeps running the grid
     * it already had, and no register opens against a timetable that is
     * mid-decision.
     */
    expect(INSTITUTION_SETUP.counts.attendanceLive).toBe(
      INSTITUTION_SETUP.counts.approved - pendingClasses.length
    );
  });

  it('describes a pending revision as review, never as a failure', () => {
    const onlyPending = {
      ...INSTITUTION_SETUP_SNAPSHOT,
      departments: INSTITUTION_SETUP_SNAPSHOT.departments.map((d) => ({ ...d, hod: 'active' })),
      classes: INSTITUTION_SETUP_SNAPSHOT.classes.map((c) => ({
        ...c,
        timetable: c.timetable === 'not_submitted' ? 'approved' : c.timetable,
      })),
    };
    const setup = deriveInstitutionSetup(onlyPending);
    expect(setup.counts.approved).toBe(setup.counts.classCount);
    expect(rowState('timetable', setup).label).toBe('Pending revision');

    renderPanel(setup);
    expect(screen.getByText(/revision in review — the approved timetable stays live/i)).toBeInTheDocument();
  });
});

describe('Institution setup — attendance is derived, never switched on', () => {
  it('matches the approved timetable count while an academic year is active', () => {
    const { counts } = INSTITUTION_SETUP;
    expect(counts.yearActive).toBe(true);
    // The strictly-approved count, not the timetable-ready one.
    expect(counts.attendanceLive).toBe(counts.settled);
    expect(counts.settled).toBeLessThan(counts.approved);

    renderPanel();
    expect(screen.getByText(`Attendance is live for ${counts.settled} classes`)).toBeInTheDocument();
  });

  it('is zero without an active academic year, however many grids are approved', () => {
    const setup = derive('no_academic_year');
    expect(setup.counts.approved).toBe(setup.counts.classCount);
    expect(setup.counts.approved).toBeGreaterThan(0);
    expect(setup.counts.attendanceLive).toBe(0);

    renderPanel(setup);
    expect(
      screen.getByText(/attendance is not available without an active academic year/i)
    ).toBeInTheDocument();
  });

  it('explains both conditions and offers no enable control', () => {
    renderPanel();
    const row = screen.getByText('Attendance readiness').closest('li');
    expect(
      within(row).getByText(
        /attendance becomes available after a class timetable is approved and an academic year is active/i
      )
    ).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
    expect(within(row).queryByRole('switch')).not.toBeInTheDocument();
  });
});

describe('Institution setup — Class Tutor coverage is read-only', () => {
  it('offers the Principal no assignment control', () => {
    renderPanel();
    const row = screen.getByText('Class Tutor coverage').closest('li');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
    expect(
      within(row).getByText(/class tutor assignment is managed by each department hod/i)
    ).toBeInTheDocument();
  });

  it('does not control timetable or attendance readiness', () => {
    const noTutors = {
      ...INSTITUTION_SETUP_SNAPSHOT,
      classes: INSTITUTION_SETUP_SNAPSHOT.classes.map((c) => ({ ...c, hasClassTutor: false })),
    };
    const setup = deriveInstitutionSetup(noTutors);
    expect(setup.counts.tutored).toBe(0);
    // Two separate signals: an unassigned tutor is not an unapproved timetable.
    expect(setup.counts.approved).toBe(INSTITUTION_SETUP.counts.approved);
    expect(setup.counts.attendanceLive).toBe(INSTITUTION_SETUP.counts.attendanceLive);
  });

  it('is not inferred from a head-of-department vacancy', () => {
    const headless = INSTITUTION_SETUP_SNAPSHOT.departments.find((d) => d.hod !== 'active');
    const classes = INSTITUTION_SETUP_SNAPSHOT.classes.filter((c) => c.departmentId === headless.id);
    // A department without a head still has tutored classes — the two facts are
    // recorded separately and are allowed to disagree.
    expect(classes.some((c) => c.hasClassTutor)).toBe(true);
    expect(classes.some((c) => !c.hasClassTutor)).toBe(true);
  });
});

describe('Institution setup — only built destinations are clickable', () => {
  it('links Departments, HOD accounts and Timetable at their real routes', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);
    await navigateVia(user, /^institution$/i);

    const panel = await screen.findByRole('region', { name: /operational readiness/i });
    await user.click(within(panel).getAllByRole('button', { name: /review departments/i })[0]);
    expect(await screen.findByRole('heading', { name: /^departments$/i })).toBeInTheDocument();
  });

  /*
   * The Academic Year row carried no control while no such screen existed, and
   * said so rather than rendering a dead link. That destination is now built, so
   * the row is a link — the rule was never "Academic Year has no control", it was
   * "no control points at a route that does not exist", and it still holds.
   */
  it('links Academic Year at its real route now that the destination exists', () => {
    renderPanel();
    const row = screen.getByText('Academic Year').closest('li');
    expect(within(row).getByRole('button', { name: /open academic year/i })).toBeInTheDocument();
    expect(within(row).getByText(/commencing the next semester is decided here/i)).toBeInTheDocument();
  });

  it('gives every action it does render a route that exists', () => {
    const built = [
      '/institution/departments',
      '/institution/timetable',
      '/institution/academic-year',
    ];
    INSTITUTION_SETUP.rows.forEach((row) => {
      if (!row.action) return;
      expect(built).toContain(row.action.to);
    });
    // Exactly the four that exist — no Class Tutor, promotion or attendance
    // destination has been invented, because none of those is this seat's
    // decision to make.
    expect(INSTITUTION_SETUP.rows.filter((r) => r.action).map((r) => r.id)).toEqual([
      'departments',
      'hods',
      'academic_year',
      'timetable',
    ]);
  });
});

describe('Institution setup — placement and non-regression', () => {
  it('sits below the metrics and above the governance blocks', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);
    await navigateVia(user, /^institution$/i);

    const panel = await screen.findByRole('region', { name: /operational readiness/i });
    const metric = screen.getByText('Overall attendance');
    const endorsement = screen.getByRole('heading', { name: /awaiting your endorsement/i });
    const health = screen.getByRole('heading', { name: /department health/i });

    const after = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(metric, panel)).toBe(true);
    expect(after(panel, endorsement)).toBe(true);
    expect(after(endorsement, health)).toBe(true);
  });

  it('does not reach the Staff, Class Tutor or Head of Department workspaces', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    // Staff is the default view, and nothing about this panel belongs to it.
    expect(screen.queryByRole('region', { name: /operational readiness/i })).not.toBeInTheDocument();

    await usePrincipalView(user);
    await navigateVia(user, /^institution$/i);
    expect(await screen.findByRole('region', { name: /operational readiness/i })).toBeInTheDocument();

    // The lower seats' own screens are unchanged: the panel is not on them.
    await navigateVia(user, /^departments$/i);
    expect(screen.queryByRole('region', { name: /operational readiness/i })).not.toBeInTheDocument();
  });
});
