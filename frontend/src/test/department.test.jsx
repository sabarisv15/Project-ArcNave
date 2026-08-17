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
  DEPT_ATTENDANCE,
  DEPT_CLASSES,
  DEPT_FACULTY,
  DEPT_STUDENTS,
  studentsOfClass,
} from '../lib/departmentData';
import { CLASS_HEALTH, FACULTY_LOAD, NEEDS_ATTENTION } from '../lib/departmentSignals';
import { DEPT_PENDING, DEPT_REQUESTS, pendingCountOfClass } from '../lib/departmentApprovalsData';
import {
  CONFLICTS,
  LIVE_VERSION,
  LIVE_VERSION_ID,
  PENDING_REVISION,
  TIMETABLE_VERSIONS,
  findConflicts,
  periodsFor,
} from '../lib/departmentTimetableData';
import { CLASS_TOTAL as L4_CLASS_TOTAL, OWNED_CLASS as L4_OWNED_CLASS } from '../lib/classTutorData';

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

/** Switches the prototype into the Head of Department view through the profile drawer. */
async function useHodView(user) {
  await user.click(screen.getByRole('button', { name: /open profile/i }));
  const group = await screen.findByRole('radiogroup', { name: /workspace view/i });
  await user.click(within(group).getByRole('radio', { name: /head of department/i }));
  await user.click(screen.getByRole('button', { name: /close profile/i }));
}

describe('Head of Department view — navigation', () => {
  it('renders the department menu only once the workspace view is switched', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');

    const before = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(within(before).queryByRole('link', { name: /^department$/i })).not.toBeInTheDocument();

    await useHodView(user);

    const after = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(within(after).getByRole('link', { name: /^department$/i })).toBeInTheDocument();
    expect(within(after).getByRole('link', { name: /^classes$/i })).toBeInTheDocument();
    expect(within(after).getByRole('link', { name: /^faculty$/i })).toBeInTheDocument();
    // The tutor's own destinations must not leak into this menu.
    expect(within(after).queryByRole('link', { name: /my class/i })).not.toBeInTheDocument();
    expect(within(after).queryByRole('link', { name: /finance/i })).not.toBeInTheDocument();
  });

  it('points Documents and Calendar at the existing shared routes rather than new ones', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await useHodView(user);

    const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(within(nav).getByRole('link', { name: /documents/i })).toHaveAttribute('href', '/curriculum/documents');
    expect(within(nav).getByRole('link', { name: /calendar/i })).toHaveAttribute('href', '/curriculum/calendar');
  });

  it('offers no destination that has not been built', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum');
    await useHodView(user);

    const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    // Finance, Examinations, Reports and Alerts are planned but not implemented
    // for this seat — a menu entry for any of them would be a dead link.
    ['examinations', 'reports', 'alerts', 'finance'].forEach((label) => {
      expect(within(nav).queryByRole('link', { name: new RegExp(label, 'i') })).not.toBeInTheDocument();
    });
  });

  it('does not render the department workspace under another workspace view', async () => {
    renderApp('/department');
    // Deep-linked while still in the Staff view: the page says so rather than
    // rendering a department under a menu that has no department in it.
    expect(await screen.findByText(/not part of the workspace view you are previewing/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Department' })).not.toBeInTheDocument();
  });
});

describe('Department mock data — internal consistency', () => {
  it('derives every class figure from the roster it belongs to', () => {
    DEPT_CLASSES.forEach((cls) => {
      const roster = studentsOfClass(cls.id);
      expect(cls.studentCount).toBe(roster.length);
      const mean = Math.round(roster.reduce((sum, s) => sum + s.attendance, 0) / roster.length);
      expect(cls.attendance).toBe(mean);
    });
  });

  it('reports the department average over students, not over class averages', () => {
    // Classes here are close enough in size that both readings happen to round
    // to the same figure, so this pins the *derivation* rather than a gap
    // between the two: the mean is taken over every student, which stays
    // correct if class sizes later diverge.
    const perStudent = DEPT_STUDENTS.reduce((sum, s) => sum + s.attendance, 0) / DEPT_STUDENTS.length;
    const ofAverages = DEPT_CLASSES.reduce((sum, c) => sum + c.attendance, 0) / DEPT_CLASSES.length;
    expect(DEPT_ATTENDANCE).toBe(Math.round(perStudent));
    expect(perStudent).not.toBe(ofAverages);
  });

  it('every student belongs to exactly one class in the department', () => {
    const ids = new Set(DEPT_CLASSES.map((c) => c.id));
    DEPT_STUDENTS.forEach((s) => expect(ids.has(s.classId)).toBe(true));
    expect(DEPT_CLASSES.reduce((sum, c) => sum + c.studentCount, 0)).toBe(DEPT_STUDENTS.length);
  });

  it('counts teaching load from the live timetable rather than storing it', () => {
    FACULTY_LOAD.forEach((l) => {
      expect(l.periods).toBe(periodsFor(l.faculty.id).length);
      expect(l.classIds).toEqual([...new Set(periodsFor(l.faculty.id).map((c) => c.classId))]);
    });
  });

  it('keeps the class shared with the Class Tutor view identical in both', () => {
    const shared = DEPT_CLASSES.find((c) => c.id === L4_OWNED_CLASS.id);
    expect(shared).toBeTruthy();
    expect(shared.code).toBe(L4_OWNED_CLASS.code);
    expect(shared.studentCount).toBe(L4_CLASS_TOTAL);
  });

  it('matches the dashboard pending count to the queue and to each class', () => {
    expect(DEPT_PENDING.length).toBe(DEPT_REQUESTS.filter((r) => r.status === 'pending').length);
    CLASS_HEALTH.forEach((c) => expect(c.pendingCount).toBe(pendingCountOfClass(c.id)));
  });

  it('contains exactly one of each seeded timetable condition, and no accidental ones', () => {
    // A live, Principal-approved timetable riddled with accidental clashes is
    // not a believable artefact — and it would drown the three the Conflicts
    // tab exists to show.
    const byKind = (kind) => CONFLICTS.filter((c) => c.kind === kind);
    expect(byKind('faculty_overlap')).toHaveLength(1);
    expect(byKind('room_overlap')).toHaveLength(1);
    expect(byKind('unassigned_period')).toHaveLength(1);
    expect(CONFLICTS).toHaveLength(3);
  });

  it('seeds one class below the threshold, and both uncovered seat states', () => {
    expect(DEPT_CLASSES.filter((c) => c.attendance < ATTENDANCE_THRESHOLD)).toHaveLength(1);

    /*
     * Two classes have no tutor, and they have no tutor for *different reasons*
     * — one seat is vacant, the other is waiting on an invitation. Collapsing
     * them into a single `tutorId === null` count was what let the old fixture
     * report an outstanding invitation as coverage; both states now exist, and
     * neither counts as covered.
     */
    const uncovered = DEPT_CLASSES.filter((c) => c.tutorId === null);
    expect(uncovered).toHaveLength(2);
    expect(uncovered.map((c) => c.seatState).sort()).toEqual(['invite_pending', 'vacant']);
    expect(DEPT_CLASSES.filter((c) => c.seatState === 'active').every((c) => c.tutorId)).toBe(true);
  });

  it('seeds a high-load and an unassigned faculty member, so the imbalance is real', () => {
    expect(FACULTY_LOAD.filter((l) => l.state === 'high')).toHaveLength(1);
    expect(FACULTY_LOAD.filter((l) => l.state === 'unassigned')).toHaveLength(1);
    expect(FACULTY_LOAD.filter((l) => l.state === 'unavailable')).toHaveLength(1);
    expect(FACULTY_LOAD).toHaveLength(DEPT_FACULTY.length);
  });

  it('keeps a revision pending while the live version stays locked', () => {
    expect(PENDING_REVISION).toBeTruthy();
    expect(LIVE_VERSION.status).toBe('locked');
    expect(PENDING_REVISION.id).not.toBe(LIVE_VERSION_ID);
    // Every lifecycle state the Revisions tab claims to show has a version.
    const states = new Set(TIMETABLE_VERSIONS.map((v) => v.status));
    ['draft', 'pending', 'locked'].forEach((s) => expect(states.has(s)).toBe(true));
  });

  it('raises a workload signal only when both an overload and spare capacity exist', () => {
    const signal = NEEDS_ATTENTION.find((s) => s.id === 'workload');
    expect(signal).toBeTruthy();
    expect(FACULTY_LOAD.some((l) => l.state === 'high')).toBe(true);
    expect(FACULTY_LOAD.some((l) => l.state === 'unassigned')).toBe(true);
  });
});

describe('Department overview', () => {
  it('leads with pending decisions and names what each metric measures', async () => {
    const user = userEvent.setup();
    renderApp('/department');
    await useHodView(user);

    expect(await screen.findByRole('heading', { name: 'Department' })).toBeInTheDocument();
    expect(screen.getByText('Pending with you')).toBeInTheDocument();
    // An attendance percentage with no stated population or period is the
    // misleading case.
    expect(screen.getByText('Department average, whole term')).toBeInTheDocument();
    expect(screen.getByText('Enrolled across all classes')).toBeInTheDocument();
  });

  it('watches classes, faculty and the timetable — not individual students', async () => {
    const user = userEvent.setup();
    renderApp('/department');
    await useHodView(user);

    const attention = await screen.findByText('Needs attention');
    expect(attention).toBeInTheDocument();
    // Every signal names a class, a faculty member or a slot. None of them is a
    // student row: this is a department monitoring screen, not a wider version
    // of the tutor's student watchlist.
    const studentNames = new Set(DEPT_STUDENTS.map((s) => s.name));
    NEEDS_ATTENTION.forEach((s) => expect(studentNames.has(s.title)).toBe(false));
  });

  it('says a class has no tutor rather than leaving the cell blank', async () => {
    const user = userEvent.setup();
    renderApp('/department');
    await useHodView(user);

    expect(await screen.findByText('Class health')).toBeInTheDocument();
    const tutorless = CLASS_HEALTH.filter((c) => !c.tutor).length;
    expect(screen.getAllByText('Not recorded')).toHaveLength(tutorless);
  });
});

describe('Department classes', () => {
  it('spans the whole department with no single-class scope to fall back to', async () => {
    const user = userEvent.setup();
    renderApp('/department/classes');
    await useHodView(user);

    expect(await screen.findByRole('heading', { name: 'Classes' })).toBeInTheDocument();
    expect(screen.getByText(`${DEPT_CLASSES.length} classes`)).toBeInTheDocument();
    // The tutor seat's class switcher has no meaning here and must not exist.
    expect(screen.queryByRole('button', { name: /all assigned classes/i })).not.toBeInTheDocument();
  });

  it('opens a drill-through drawer that informs rather than marks attendance', async () => {
    const user = userEvent.setup();
    renderApp('/department/classes');
    await useHodView(user);

    const rows = await screen.findAllByRole('button', { name: /— open class$/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog', { name: /B\.Sc CS/i });
    ['Overview', 'Students', 'Attendance', 'Timetable', 'Timeline'].forEach((tab) => {
      expect(within(drawer).getByRole('tab', { name: tab })).toBeInTheDocument();
    });
    // An HOD does not mark a register, so no marking control may appear here.
    expect(within(drawer).queryByRole('button', { name: /mark attendance/i })).not.toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /present|absent/i })).not.toBeInTheDocument();
  });
});

describe('Department faculty', () => {
  it('shows teaching load and a workload state for every faculty member', async () => {
    const user = userEvent.setup();
    renderApp('/department/faculty');
    await useHodView(user);

    expect(await screen.findByRole('heading', { name: 'Faculty' })).toBeInTheDocument();
    expect(screen.getByText(`${DEPT_FACULTY.length} faculty`)).toBeInTheDocument();
    expect(screen.getByText('High load')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('stays out of payroll, leave administration and HR', async () => {
    const user = userEvent.setup();
    renderApp('/department/faculty');
    await useHodView(user);

    const rows = await screen.findAllByRole('button', { name: /— open record$/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog', { name: /Reddy|Raghavan|Anand|Menon/i });
    ['Profile', 'Workload', 'Classes', 'Timeline'].forEach((tab) => {
      expect(within(drawer).getByRole('tab', { name: tab })).toBeInTheDocument();
    });
    expect(within(drawer).getByText(/payroll and employment records are not handled here/i)).toBeInTheDocument();
  });
});

describe('Department approvals', () => {
  it('carries only decisions that genuinely reach this seat', async () => {
    const user = userEvent.setup();
    renderApp('/department/approvals');
    await useHodView(user);

    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
    ['All', 'Attendance', 'Marks', 'Timetable', 'Faculty / allocation'].forEach((tab) => {
      expect(screen.getByRole('tab', { name: new RegExp(`^${tab.replace('/', '\\/')}`, 'i') })).toBeInTheDocument();
    });
    // Routine class-owned corrections stay with the class tutor.
    const kinds = new Set(DEPT_REQUESTS.map((r) => r.kind));
    expect(kinds.has('fee_correction')).toBe(false);
    expect(kinds.has('absence_flag')).toBe(false);
  });

  it('shows the original value beside the proposed one', async () => {
    const user = userEvent.setup();
    renderApp('/department/approvals');
    await useHodView(user);

    const rows = await screen.findAllByRole('button', { name: /— open$/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog', { name: /revision|request|publication|allocation|correction/i });
    expect(within(drawer).getByText('On record')).toBeInTheDocument();
    expect(within(drawer).getByText('Proposed')).toBeInTheDocument();
    expect(within(drawer).getByText(/requested by/i)).toBeInTheDocument();
  });

  it('records the deciding position, not just the person', async () => {
    const user = userEvent.setup();
    renderApp('/department/approvals');
    await useHodView(user);

    const rows = await screen.findAllByRole('button', { name: /— open$/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog', { name: /revision|request|publication|allocation|correction/i });
    await user.click(within(drawer).getByRole('button', { name: 'Approve' }));

    await user.click(screen.getByRole('tab', { name: /decided/i }));
    const decided = await screen.findAllByRole('button', { name: /— open$/i });
    await user.click(decided[0]);
    expect(await screen.findByText(/You · Head of Department/)).toBeInTheDocument();
  });
});

describe('Department timetable', () => {
  it('keeps the live timetable in force while a revision is under review', async () => {
    const user = userEvent.setup();
    renderApp('/department/timetable');
    await useHodView(user);

    expect(await screen.findByRole('heading', { name: 'Timetable' })).toBeInTheDocument();
    expect(
      await screen.findByText(new RegExp(`${PENDING_REVISION.label} is waiting on your endorsement`))
    ).toBeInTheDocument();
    expect(screen.getByText(/continues to follow the live timetable below/i)).toBeInTheDocument();
  });

  it('endorsing a revision does not silently swap the live timetable', async () => {
    const user = userEvent.setup();
    renderApp('/department/timetable');
    await useHodView(user);

    await user.click(await screen.findByRole('tab', { name: /revisions/i }));
    const rows = await screen.findAllByRole('button', { name: /— open revision$/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog', { name: /revision/i });
    // "Endorse", never "Approve" — the word this seat may not produce.
    await user.click(within(drawer).getByRole('button', { name: 'Endorse' }));

    // An HOD endorsement sends the revision onward; the department is still
    // following the locked version until the final approval lands.
    await user.click(screen.getByRole('tab', { name: /current timetable/i }));
    expect(await screen.findByText('Revision 2 — current')).toBeInTheDocument();
  });

  it('names the cause of every conflict rather than only counting them', async () => {
    const user = userEvent.setup();
    renderApp('/department/timetable');
    await useHodView(user);

    await user.click(await screen.findByRole('tab', { name: /conflicts/i }));
    expect(await screen.findByText('Faculty overlap')).toBeInTheDocument();
    expect(screen.getByText('Room overlap')).toBeInTheDocument();
    expect(screen.getByText('Unassigned period')).toBeInTheDocument();
    CONFLICTS.forEach((c) => expect(screen.getByText(c.detail)).toBeInTheDocument());
  });

  it('finds conflicts in a version rather than reading a stored count', () => {
    // The live grid's conflicts are the scan of its own cells, so the number on
    // screen cannot disagree with the grid beneath it.
    expect(findConflicts(LIVE_VERSION.cells)).toHaveLength(CONFLICTS.length);
    expect(findConflicts(PENDING_REVISION.cells)).toHaveLength(0);
  });
});

describe('Department students', () => {
  it('spans every class and shows which class a student belongs to', async () => {
    const user = userEvent.setup();
    renderApp('/department/students');
    await useHodView(user);

    expect(await screen.findByRole('heading', { name: 'Students' })).toBeInTheDocument();
    expect(screen.getByText(`${DEPT_STUDENTS.length} students`)).toBeInTheDocument();
    // Roll numbers repeat across the six classes, so a row without its class
    // does not identify a person.
    expect(screen.getAllByText(DEPT_CLASSES[0].code).length).toBeGreaterThan(0);
  });

  it('is monitoring only — no department-wide bulk action', async () => {
    const user = userEvent.setup();
    renderApp('/department/students');
    await useHodView(user);

    await screen.findByRole('heading', { name: 'Students' });
    expect(screen.queryByRole('button', { name: /select all/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText(/decided by each class tutor/i)).toBeInTheDocument();
  });

  it('states the class context inside the student drawer', async () => {
    const user = userEvent.setup();
    renderApp('/department/students');
    await useHodView(user);

    const rows = await screen.findAllByRole('button', { name: /— open record$/i });
    await user.click(rows[0]);

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Class')).toBeInTheDocument();
    expect(within(drawer).getByRole('tab', { name: 'Flags' })).toBeInTheDocument();
    expect(within(drawer).getByRole('tab', { name: 'Finance' })).toBeInTheDocument();
  });

  it('pre-selects the class a drill-through arrived from', async () => {
    const user = userEvent.setup();
    const first = DEPT_CLASSES[0];
    renderApp(`/department/students?class=${first.id}`);
    await useHodView(user);

    await screen.findByRole('heading', { name: 'Students' });
    expect(screen.getByText(`${first.studentCount} of ${DEPT_STUDENTS.length}`)).toBeInTheDocument();
  });
});
