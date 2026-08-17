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
  ATTENDANCE_THRESHOLD,
  DEPARTMENTS,
  DEPT_ATTENTION_THRESHOLD,
  INST_ATTENDANCE,
  INST_CLASSES,
  INST_CLASS_TOTAL,
  INST_FACULTY,
  INST_FACULTY_TOTAL,
  INST_STUDENTS,
  INST_STUDENT_TOTAL,
  classesOfDepartment,
  facultyOfDepartment,
  hodOf,
  studentsOfClass,
  studentsOfDepartment,
} from '../lib/institutionData';
import {
  DEPARTMENT_HEALTH,
  DEPTS_NEEDING_ATTENTION,
  INSTITUTION_ATTENTION,
  workloadImbalance,
} from '../lib/institutionSignals';
import { INST_PENDING, INST_REQUESTS } from '../lib/institutionApprovalsData';
import { TIMETABLE_STATES, timetableStateOf } from '../lib/institutionTimetableData';
import {
  DEPARTMENT as CSE_DEPARTMENT,
  DEPT_ATTENDANCE,
  DEPT_CLASS_TOTAL,
  DEPT_FACULTY_TOTAL,
  DEPT_STUDENT_TOTAL,
} from '../lib/departmentData';
import { LIVE_VERSION, PENDING_REVISION } from '../lib/departmentTimetableData';

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

/** Switches the prototype into the Principal view through the profile drawer. */
async function usePrincipalView(user) {
  await user.click(screen.getByRole('button', { name: /open profile/i }));
  const group = await screen.findByRole('radiogroup', { name: /workspace view/i });
  await user.click(within(group).getByRole('radio', { name: /principal/i }));
  await user.click(screen.getByRole('button', { name: /close profile/i }));
}

/**
 * Navigates through the sidebar specifically.
 *
 * `/curriculum` renders its own section list built from the same menu, so a
 * bare `findByRole('link')` matches twice. Scoping to the sidebar is not a
 * workaround for that — it is the more honest assertion anyway, since what
 * these tests are checking is that the seat's *menu* reaches the destination.
 */
async function navigateVia(user, name) {
  const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
  await user.click(within(nav).getByRole('link', { name }));
}

describe('Principal view — navigation', () => {
  it('renders the institution menu only once the workspace view is switched', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');

    const before = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(within(before).queryByRole('link', { name: /^institution$/i })).not.toBeInTheDocument();

    await usePrincipalView(user);

    const after = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(within(after).getByRole('link', { name: /^institution$/i })).toBeInTheDocument();
    expect(within(after).getByRole('link', { name: /^departments$/i })).toBeInTheDocument();
    expect(within(after).getByRole('link', { name: /^approvals$/i })).toBeInTheDocument();
    // Neither lower seat's own destinations may leak into this menu.
    expect(within(after).queryByRole('link', { name: /my class/i })).not.toBeInTheDocument();
    expect(within(after).queryByRole('link', { name: /^classes$/i })).not.toBeInTheDocument();
  });

  it('points Documents and Calendar at the existing shared routes rather than new ones', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);

    const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(within(nav).getByRole('link', { name: /documents/i })).toHaveAttribute('href', '/curriculum/documents');
    expect(within(nav).getByRole('link', { name: /calendar/i })).toHaveAttribute('href', '/curriculum/calendar');
  });

  it('offers no destination that has not been built', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);

    const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    // Finance, Examinations, Reports, Alerts and Settings are planned but not
    // implemented for this seat — a menu entry for any would be a dead link.
    ['examinations', 'reports', 'alerts', 'finance', 'settings'].forEach((label) => {
      expect(within(nav).queryByRole('link', { name: new RegExp(label, 'i') })).not.toBeInTheDocument();
    });
  });

  it('does not render the institution workspace under another workspace view', async () => {
    renderApp('/institution');
    // Deep-linked while still in the Staff view: the page says so rather than
    // rendering an institution under a menu that has no institution in it.
    expect(await screen.findByText(/not part of the workspace view you are previewing/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Institution' })).not.toBeInTheDocument();
  });
});

describe('Institution mock data — internal consistency', () => {
  it('derives every class figure from the roster it belongs to', () => {
    INST_CLASSES.forEach((cls) => {
      const roster = studentsOfClass(cls.id);
      expect(cls.studentCount).toBe(roster.length);
      const mean = Math.round(roster.reduce((s, x) => s + x.attendance, 0) / roster.length);
      expect(cls.attendance).toBe(mean);
    });
  });

  it('derives every department figure from its own classes, faculty and students', () => {
    DEPARTMENTS.forEach((d) => {
      expect(d.classCount).toBe(classesOfDepartment(d.id).length);
      expect(d.facultyCount).toBe(facultyOfDepartment(d.id).length);

      const roster = studentsOfDepartment(d.id);
      expect(d.studentCount).toBe(roster.length);
      expect(d.attendance).toBe(Math.round(roster.reduce((s, x) => s + x.attendance, 0) / roster.length));
      expect(d.atRiskCount).toBe(roster.filter((s) => s.attendance < ATTENDANCE_THRESHOLD).length);
    });
  });

  it('totals the institution from the fixtures rather than asserting them', () => {
    expect(INST_CLASS_TOTAL).toBe(INST_CLASSES.length);
    expect(INST_FACULTY_TOTAL).toBe(INST_FACULTY.length);
    expect(INST_STUDENT_TOTAL).toBe(INST_STUDENTS.length);
    expect(INST_STUDENT_TOTAL).toBe(DEPARTMENTS.reduce((s, d) => s + d.studentCount, 0));
  });

  it('averages attendance over every student, not over department averages', () => {
    const overStudents = Math.round(
      INST_STUDENTS.reduce((s, x) => s + x.attendance, 0) / INST_STUDENTS.length
    );
    expect(INST_ATTENDANCE).toBe(overStudents);

    // The distinction is only meaningful if the two actually differ here — a
    // fixture set where every department were the same size would let this
    // rule pass while proving nothing.
    const sizes = new Set(DEPARTMENTS.map((d) => d.studentCount));
    expect(sizes.size).toBeGreaterThan(1);
  });
});

describe('Institution mock data — alignment with the department seat', () => {
  it('reports exactly the L3 figures for Computer Science', () => {
    const cse = DEPARTMENTS.find((d) => d.id === CSE_DEPARTMENT.id);
    expect(cse).toBeDefined();
    expect(cse.name).toBe(CSE_DEPARTMENT.name);
    expect(cse.short).toBe(CSE_DEPARTMENT.short);
    expect(cse.classCount).toBe(DEPT_CLASS_TOTAL);
    expect(cse.facultyCount).toBe(DEPT_FACULTY_TOTAL);
    expect(cse.studentCount).toBe(DEPT_STUDENT_TOTAL);
    // The figure this whole arrangement exists to protect.
    expect(cse.attendance).toBe(DEPT_ATTENDANCE);
  });

  it('names the same head of department the L3 workspace does', () => {
    expect(hodOf(CSE_DEPARTMENT.id)?.name).toBe(CSE_DEPARTMENT.hod.name);
  });

  it('reads the CSE timetable state from the department module rather than restating it', () => {
    const state = timetableStateOf(CSE_DEPARTMENT.id);
    expect(state.live.label).toBe(LIVE_VERSION.label);
    expect(state.live.effectiveFrom).toBe(LIVE_VERSION.effectiveFrom);
    expect(state.pending?.label).toBe(PENDING_REVISION.label);
  });
});

describe('Institution signals', () => {
  it('flags the department below the attendance threshold, from its own students', () => {
    const low = DEPARTMENT_HEALTH.filter((d) => d.attendance < DEPT_ATTENTION_THRESHOLD);
    expect(low).toHaveLength(1);
    expect(low[0].short).toBe('MECH');

    // Derived, not asserted: the average has to fall out of the roster.
    const roster = studentsOfDepartment(low[0].id);
    expect(Math.round(roster.reduce((s, x) => s + x.attendance, 0) / roster.length)).toBe(low[0].attendance);
    expect(low[0].attention).toBe('low_attendance');
  });

  it('flags every department whose head seat is not actually held', () => {
    /*
     * Two departments, and deliberately not for the same reason: Civil's seat
     * is vacant, Mechanical's has an invitation outstanding. An invitation is
     * **not** coverage — the seat is not held until it is accepted — so both
     * reach this signal, and a readiness figure that counted the invited one as
     * led would be reporting leadership that does not exist yet.
     */
    const headless = DEPARTMENT_HEALTH.filter((d) => !d.hod);
    expect(headless.map((d) => d.short).sort()).toEqual(['CIVIL', 'MECH']);
    headless.forEach((d) => expect(d.attention).toBeTruthy());

    const civil = DEPARTMENTS.find((d) => d.short === 'CIVIL');
    const mech = DEPARTMENTS.find((d) => d.short === 'MECH');
    expect(civil.hodSeatState).toBe('vacant');
    expect(mech.hodSeatState).toBe('invite_pending');
  });

  it('reports a workload imbalance only where both ends of it exist', () => {
    const ece = DEPARTMENTS.find((d) => d.short === 'ECE');
    const imbalance = workloadImbalance(ece.id);
    expect(imbalance).not.toBeNull();
    expect(imbalance.overloaded.periods).toBeGreaterThan(18);
    expect(imbalance.spare.periods).toBe(0);

    // A department with nobody spare reports nothing, however loaded it is.
    const maths = DEPARTMENTS.find((d) => d.short === 'MATHS');
    expect(workloadImbalance(maths.id)).toBeNull();
  });

  it('keeps genuinely healthy departments free of attention states', () => {
    const onTrack = DEPARTMENT_HEALTH.filter((d) => d.attention === 'ok').map((d) => d.short);
    expect(onTrack).toEqual(expect.arrayContaining(['COM', 'MATHS']));
  });

  it('gives every signal a record and a destination', () => {
    expect(INSTITUTION_ATTENTION.length).toBeGreaterThan(0);
    INSTITUTION_ATTENTION.forEach((s) => {
      expect(s.title).toBeTruthy();
      expect(s.detail).toBeTruthy();
      expect(s.to).toMatch(/^\/institution/);
    });
  });

  it('does not put individual students on the institution watchlist', () => {
    // Student-level monitoring belongs to L4 and L3. At this altitude the unit
    // is a department, and there are far more at-risk students than signals.
    const atRisk = INST_STUDENTS.filter((s) => s.attendance < ATTENDANCE_THRESHOLD);
    expect(atRisk.length).toBeGreaterThan(INSTITUTION_ATTENTION.length);
    INSTITUTION_ATTENTION.forEach((s) => {
      expect(INST_STUDENTS.some((st) => st.name === s.title)).toBe(false);
    });
  });

  it('carries the cross-department exception and the calendar exception', () => {
    const kinds = INSTITUTION_ATTENTION.map((s) => s.kind);
    expect(kinds).toContain('Shared room exception');
    expect(kinds).toContain('Academic calendar exception');
  });

  it('surfaces departments needing attention alongside ones that do not', () => {
    expect(DEPTS_NEEDING_ATTENTION.length).toBeGreaterThan(0);
    expect(DEPTS_NEEDING_ATTENTION.length).toBeLessThan(DEPARTMENT_HEALTH.length);
  });
});

describe('Principal approvals', () => {
  it('holds only decisions that genuinely reach this seat', () => {
    const kinds = new Set(INST_REQUESTS.map((r) => r.kind));
    // Routine class and department work must never appear in this queue.
    ['attendance_correction', 'marks_correction', 'fee_status', 'substitute_request'].forEach((k) => {
      expect(kinds.has(k)).toBe(false);
    });
    expect(INST_PENDING.length).toBeGreaterThan(0);
  });

  it('states the original value beside the proposed one on every request', () => {
    INST_REQUESTS.forEach((r) => {
      expect(r.changes.length).toBeGreaterThan(0);
      r.changes.forEach((c) => {
        expect(c.label).toBeTruthy();
        expect(c.from).toBeTruthy();
        expect(c.to).toBeTruthy();
      });
    });
  });

  it('names who asked and in what institutional position', () => {
    INST_REQUESTS.forEach((r) => {
      expect(r.requester.name).toBeTruthy();
      expect(r.requester.position).toBeTruthy();
    });
  });

  it('continues the L3 timeline rather than starting a new one', () => {
    const endorsement = INST_REQUESTS.find((r) => r.kind === 'timetable_endorsement' && r.status === 'pending');
    const labels = endorsement.timeline.map((s) => s.label);
    expect(labels).toContain('Submitted for HOD review');
    expect(labels).toContain('Endorsed by Head of Department');
    expect(endorsement.timeline.find((s) => s.state === 'current').label).toMatch(/pending your approval/i);
    // The revision this seat is being asked about is the department's own.
    expect(endorsement.subject).toBe(PENDING_REVISION.label);
  });

  it('does not make an endorsed revision live — the locking step stays pending', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);
    await navigateVia(user, /^approvals$/i);

    await user.click(
      await screen.findByRole('button', { name: /timetable revision — hod endorsed from dr\. k\. anand/i })
    );

    const dialog = await screen.findByRole('dialog');
    // The diff says it outright before the decision is taken.
    expect(within(dialog).getByText(/unchanged until locked/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^approve$/i }));

    await user.click(await screen.findByRole('tab', { name: /decided/i }));
    await user.click(
      await screen.findByRole('button', { name: /timetable revision — hod endorsed from dr\. k\. anand/i })
    );

    const decided = await screen.findByRole('dialog');
    // The timeline step exactly — the diff also contains "Approved by Principal
    // — ready to lock", which is the proposed value, not the recorded outcome.
    expect(within(decided).getByText('Approved by Principal')).toBeInTheDocument();
    // Approval sends it to be locked; it does not replace the live grid.
    expect(within(decided).getByText('Locked')).toBeInTheDocument();
    expect(within(decided).queryByText(/applied to record/i)).not.toBeInTheDocument();
  });

  it('leaves the department timetable state untouched by a Principal decision', () => {
    // The live grid is the department's, and no institution screen mutates it.
    const state = timetableStateOf(CSE_DEPARTMENT.id);
    expect(state.live.label).toBe(LIVE_VERSION.label);
    expect(TIMETABLE_STATES.every((s) => s.live.label !== s.pending?.label)).toBe(true);
  });
});

describe('Principal screens', () => {
  it('opens on department health, not on a roster of every student', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);
    await navigateVia(user, /^students$/i);

    // The department-level view: one row per department, not 1,285 students.
    expect(await screen.findByText(new RegExp(`${INST_STUDENT_TOTAL} across`, 'i'))).toBeInTheDocument();
    DEPARTMENTS.forEach((d) => {
      expect(screen.getByRole('button', { name: new RegExp(`${d.name} — open student roster`, 'i') })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /open record/i })).not.toBeInTheDocument();
  });

  it('scopes to one department’s roster on request, and back again', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);
    await navigateVia(user, /^students$/i);
    await user.click(await screen.findByRole('button', { name: /computer science — open student roster/i }));

    // The scope is stated where it cannot be missed, not only in the crumb.
    expect(await screen.findByRole('heading', { name: /students · computer science/i })).toBeInTheDocument();
    expect(screen.getByText(`${DEPT_STUDENT_TOTAL} students`)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /open record/i }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /back to all departments/i }));
    expect(await screen.findByText(new RegExp(`${INST_STUDENT_TOTAL} across`, 'i'))).toBeInTheDocument();
  });

  it('states the head of department gap rather than leaving a blank cell', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);
    await navigateVia(user, /^departments$/i);

    const row = await screen.findByRole('button', { name: /civil engineering — open department/i });
    expect(within(row).getByText(/not recorded/i)).toBeInTheDocument();
  });

  it('shows a waiting revision separately from the live timetable', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await usePrincipalView(user);
    await navigateVia(user, /^timetable$/i);

    const row = await screen.findByRole('button', {
      name: /computer science — open timetable decision/i,
    });
    expect(within(row).getByText(LIVE_VERSION.label)).toBeInTheDocument();
    expect(within(row).getByText(/live timetable unchanged/i)).toBeInTheDocument();
    // Named as a revision, never as a version the department is following — the
    // two columns being separate is the whole point of the row.
    expect(within(row).getByText(PENDING_REVISION.label)).toBeInTheDocument();
  });
});
