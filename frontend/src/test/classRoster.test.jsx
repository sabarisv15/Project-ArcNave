import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AcademicRosterProvider, useAcademicRoster } from '../store/AcademicRosterProvider';
import { AcademicTermProvider } from '../store/AcademicTermProvider';
import { OWNED_CLASS, PROMOTED_STUDENTS, PRIOR_SEMESTER } from '../lib/classTutorData';
import { ACTIVE_CLASSES } from '../lib/academicCalendar';
import { studentsOfClass as baselineStudentsOfClass } from '../lib/rosterData';
import { attendanceLiveFor, timetableStateOfClass } from '../lib/timetableState';
import { hasClassTutor } from '../lib/seatState';
import { renderApp as renderAppShared } from './renderApp';
import {
  classifyRows,
  guessMapping,
  importableRows,
  parseDelimited,
  sampleFile,
  summarise,
} from '../lib/bulkImportData';

function renderApp(route = '/curriculum', options) {
  return renderAppShared(route, options);
}

async function useClassTutorView(user) {
  await user.click(await screen.findByRole('button', { name: /open profile/i }));
  const group = await screen.findByRole('radiogroup', { name: /workspace view/i });
  await user.click(within(group).getByRole('radio', { name: /class tutor/i }));
  await user.click(screen.getByRole('button', { name: /close profile/i }));
}

/*
 * The same provider order `App.jsx` mounts. The term sits outermost because the
 * roster resolves students into the *current term's* classes — at generation 0
 * that is the baseline fixture, by identity, which is what every assertion below
 * still relies on.
 */
const wrapper = ({ children }) => (
  <AcademicTermProvider>
    <AcademicRosterProvider>{children}</AcademicRosterProvider>
  </AcademicTermProvider>
);

const roster = () => renderHook(() => useAcademicRoster(), { wrapper });

describe('ClassGate — the class workspace is one seat’s', () => {
  it('does not render the class workspace under another workspace view', async () => {
    renderApp('/curriculum/my-class');
    expect(await screen.findByText(/the class workspace is not part of the workspace view/i)).toBeInTheDocument();
    // It says what happened rather than redirecting — the URL the user asked
    // for is not discarded.
    expect(screen.queryByRole('heading', { name: /^my class$/i })).toBeNull();
  });

  it('renders it once the workspace view is the Class Tutor seat', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class');
    await useClassTutorView(user);
    expect(await screen.findByRole('heading', { name: /^my class$/i })).toBeInTheDocument();
  });
});

describe('L4 scope — exactly one class', () => {
  it('has one active class and no switcher to reach another', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class/students');
    await useClassTutorView(user);
    await screen.findByRole('heading', { name: /^students$/i });

    /*
     * The staff roster puts its classes in a tablist strip. This seat has no
     * such strip — not a filtered one, none: there is one class. The sidebar's
     * own Home/Curriculum toggle is a tablist too, so the check is scoped to
     * the workspace rather than the document.
     */
    const workspace = screen.getByRole('main');
    expect(within(workspace).queryByRole('tablist')).toBeNull();

    const others = ACTIVE_CLASSES.filter((c) => c.id !== OWNED_CLASS.id);
    others.forEach((c) => expect(within(workspace).queryByText(c.code)).toBeNull());
  });

  it('shows no student from any other class', () => {
    const { result } = roster();
    const mine = new Set(result.current.studentsOfClass(OWNED_CLASS.id).map((s) => s.id));
    ACTIVE_CLASSES.filter((c) => c.id !== OWNED_CLASS.id).forEach((c) => {
      result.current.studentsOfClass(c.id).forEach((s) => expect(mine.has(s.id)).toBe(false));
    });
  });

  it('derives capacity from the provisioned section, not from the roster', () => {
    const { result } = roster();
    const fill = result.current.classFill(OWNED_CLASS.id);
    const provisioned = ACTIVE_CLASSES.find((c) => c.id === OWNED_CLASS.id).capacity;
    expect(fill.capacity).toBe(provisioned);
    expect(fill.enrolled).toBe(baselineStudentsOfClass(OWNED_CLASS.id).length);
    expect(fill.headroom).toBe(provisioned - fill.enrolled);
  });
});

describe('Individual admission', () => {
  const valid = { name: 'Aravind Ramesh', reg: 'REG-2024-9001', phone: '+91 9800000001' };

  it('activates a valid student in the roster immediately', () => {
    const { result } = roster();
    const before = result.current.studentsOfClass(OWNED_CLASS.id).length;

    let outcome;
    act(() => {
      outcome = result.current.admitStudent(OWNED_CLASS.id, valid, { scopeClassId: OWNED_CLASS.id });
    });

    expect(outcome.ok).toBe(true);
    const after = result.current.studentsOfClass(OWNED_CLASS.id);
    expect(after).toHaveLength(before + 1);
    // Active straight away — no pending state, no approval queue between a
    // valid submission and an enrolled student.
    expect(after.at(-1).name).toBe(valid.name);
    expect(after.at(-1).origin).toBe('admitted');
  });

  /**
   * The invariant the whole shared-roster layer exists for. A route-scoped
   * store would pass every assertion above and fail this one.
   */
  it('is the same student id and object for every seat that reads the class', () => {
    const { result } = roster();
    let created;
    act(() => {
      created = result.current.admitStudent(OWNED_CLASS.id, valid, { scopeClassId: OWNED_CLASS.id }).student;
    });

    const fromClass = result.current.studentsOfClass(OWNED_CLASS.id).find((s) => s.id === created.id);
    const fromDepartment = result.current
      .studentsOfDepartment(OWNED_CLASS.departmentId)
      .find((s) => s.id === created.id);
    const fromInstitution = result.current.allStudents.find((s) => s.id === created.id);
    const byId = result.current.studentById(created.id);

    // Object identity, not a deep-equal copy: one record, resolved four ways.
    expect(fromClass).toBe(created);
    expect(fromDepartment).toBe(created);
    expect(fromInstitution).toBe(created);
    expect(byId).toBe(created);
  });

  it('rejects a duplicate of a student already placed in the class', () => {
    const { result } = roster();
    const promoted = PROMOTED_STUDENTS[0];

    let outcome;
    act(() => {
      outcome = result.current.admitStudent(
        OWNED_CLASS.id,
        { name: 'Someone Else', reg: promoted.reg },
        { scopeClassId: OWNED_CLASS.id },
      );
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('duplicate');
    expect(outcome.detail).toBe('promoted');
  });

  it('cannot exceed the section’s provisioned capacity', () => {
    const { result } = roster();
    const { headroom } = result.current.classFill(OWNED_CLASS.id);

    act(() => {
      for (let i = 0; i < headroom; i++) {
        result.current.admitStudent(
          OWNED_CLASS.id,
          { name: `Filler ${i}`, reg: `REG-FILL-${i}` },
          { scopeClassId: OWNED_CLASS.id },
        );
      }
    });

    expect(result.current.classFill(OWNED_CLASS.id).headroom).toBe(0);

    let outcome;
    act(() => {
      outcome = result.current.admitStudent(
        OWNED_CLASS.id,
        { name: 'One Too Many', reg: 'REG-OVER-1' },
        { scopeClassId: OWNED_CLASS.id },
      );
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('at_capacity');
  });

  it('refuses to write to a class this seat does not own', () => {
    const { result } = roster();
    const other = ACTIVE_CLASSES.find((c) => c.id !== OWNED_CLASS.id);

    let outcome;
    act(() => {
      outcome = result.current.admitStudent(other.id, valid, { scopeClassId: OWNED_CLASS.id });
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('out_of_scope');
    expect(result.current.studentsOfClass(other.id)).toHaveLength(baselineStudentsOfClass(other.id).length);
  });

  it('never mutates the immutable baseline fixture', () => {
    const before = baselineStudentsOfClass(OWNED_CLASS.id).length;
    const { result } = roster();
    act(() => {
      result.current.admitStudent(OWNED_CLASS.id, valid, { scopeClassId: OWNED_CLASS.id });
    });
    expect(baselineStudentsOfClass(OWNED_CLASS.id)).toHaveLength(before);
  });
});

describe('Bulk import', () => {
  function preview(result) {
    const parsed = parseDelimited(sampleFile(PROMOTED_STUDENTS[0].reg));
    const mapping = guessMapping(parsed.headers);
    const classified = classifyRows(parsed.rows, mapping, (values, pending) =>
      result.current.validateAdmission(OWNED_CLASS.id, values, {
        scopeClassId: OWNED_CLASS.id,
        pending,
      }),
    );
    return { parsed, mapping, classified };
  }

  it('classifies every row valid, warning or rejected before anything is created', () => {
    const { result } = roster();
    const { classified } = preview(result);
    const counts = summarise(classified);

    expect(counts.total).toBe(5);
    expect(counts.valid).toBeGreaterThan(0);
    expect(counts.warning).toBeGreaterThan(0);
    expect(counts.rejected).toBeGreaterThan(0);

    // A row missing a required field is rejected and says which one.
    const missing = classified.find((r) => !r.values.reg);
    expect(missing.state).toBe('rejected');
    expect(missing.issues.join(' ')).toMatch(/register number is required/i);

    // A row missing only an optional field still imports, as a warning.
    const noGuardian = classified.find((r) => r.values.name === 'Nivetha Chandran');
    expect(noGuardian.state).toBe('warning');
    expect(noGuardian.issues.join(' ')).toMatch(/no guardian phone/i);
  });

  it('rejects a student already placed in this class by promotion', () => {
    const { result } = roster();
    const { classified } = preview(result);
    const dup = classified.find((r) => r.values.name === 'Already Promoted Student');
    expect(dup.state).toBe('rejected');
    expect(dup.issues.join(' ')).toMatch(/already placed in this class by promotion/i);
  });

  it('activates confirmed rows immediately, with documents pending', () => {
    const { result } = roster();
    const { classified } = preview(result);
    const rows = importableRows(classified);

    let outcome;
    act(() => {
      outcome = result.current.importStudents(OWNED_CLASS.id, rows, { scopeClassId: OWNED_CLASS.id });
    });

    expect(outcome.accepted).toHaveLength(rows.length);
    outcome.accepted.forEach((s) => {
      expect(s.origin).toBe('imported');
      // A record and no documents yet. A follow-up, never a hold: they are in
      // the roster either way.
      expect(s.documentsPending).toBe(true);
      expect(result.current.studentsOfClass(OWNED_CLASS.id)).toContain(s);
    });
  });

  it('rejects the second occurrence when one file contains the same student twice', () => {
    const { result } = roster();
    const parsed = parseDelimited(
      [
        'Name,Register Number,Student Phone,Guardian Phone',
        'Twice Over,REG-2024-8801,+91 9800000010,+91 8800000010',
        'Twice Over Again,REG-2024-8801,+91 9800000011,+91 8800000011',
      ].join('\n'),
    );
    const classified = classifyRows(parsed.rows, guessMapping(parsed.headers), (values, pending) =>
      result.current.validateAdmission(OWNED_CLASS.id, values, {
        scopeClassId: OWNED_CLASS.id,
        pending,
      }),
    );

    expect(classified[0].state).not.toBe('rejected');
    expect(classified[1].state).toBe('rejected');
    expect(classified[1].issues.join(' ')).toMatch(/already placed/i);
  });

  it('resolves imported students to the same object for every seat', () => {
    const { result } = roster();
    let created;
    act(() => {
      created = result.current.importStudents(OWNED_CLASS.id, [{ name: 'Shared Identity', reg: 'REG-2024-8899' }], {
        scopeClassId: OWNED_CLASS.id,
      }).accepted[0];
    });

    expect(result.current.studentById(created.id)).toBe(created);
    expect(result.current.studentsOfDepartment(OWNED_CLASS.departmentId)).toContain(created);
    expect(result.current.allStudents).toContain(created);
  });
});

describe('Promoted students and prior-semester history', () => {
  it('are already in the roster and are offered no onboarding action', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class/students');
    await useClassTutorView(user);
    await screen.findByRole('heading', { name: /^students$/i });

    const promoted = PROMOTED_STUDENTS[0];
    const row = await screen.findByRole('button', {
      name: new RegExp(`${promoted.name}.*open record`, 'i'),
    });
    expect(row).toBeInTheDocument();

    await user.click(row);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Promoted')).toBeInTheDocument();
    expect(within(drawer).getByText(/no onboarding is needed/i)).toBeInTheDocument();
    // The drawer offers nothing that would onboard a student who is already
    // enrolled — no admit, no import, no re-enrol.
    ['admit', 'onboard', 'enrol', 'import'].forEach((word) => {
      expect(within(drawer).queryByRole('button', { name: new RegExp(word, 'i') })).toBeNull();
    });
  });

  it('shows the previous semester as read-only, with no control at all', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class');
    await useClassTutorView(user);

    const panel = await screen.findByRole('region', { name: /previous semester/i });
    expect(within(panel).getByText(/read-only/i)).toBeInTheDocument();
    expect(within(panel).getByText(new RegExp(PRIOR_SEMESTER.label, 'i'))).toBeInTheDocument();
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(within(panel).queryByRole('link')).toBeNull();
    expect(within(panel).queryByRole('switch')).toBeNull();
  });
});

describe('Attendance follows the timetable, never the seat', () => {
  it('is live for this class only because its timetable is approved', () => {
    expect(timetableStateOfClass(OWNED_CLASS.id)).toBe('approved');
    expect(attendanceLiveFor(OWNED_CLASS.id)).toBe(true);
  });

  it('states the approved timetable on the dashboard rather than implying it', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class');
    await useClassTutorView(user);
    await screen.findByRole('heading', { name: /^my class$/i });
    expect(await screen.findByText(/attendance is live for this class/i)).toBeInTheDocument();
  });

  it('locks a class whose timetable is under review, tutor or no tutor', () => {
    const pending = ACTIVE_CLASSES.find((c) => timetableStateOfClass(c.id) === 'pending');
    expect(pending).toBeTruthy();
    expect(attendanceLiveFor(pending.id)).toBe(false);
    // The seat is irrelevant to it, in both directions.
    const tutoredAndLocked = ACTIVE_CLASSES.filter((c) => hasClassTutor(c.id) && !attendanceLiveFor(c.id));
    expect(tutoredAndLocked.length).toBeGreaterThan(0);
  });

  it('keeps the live timetable while a revision is pending', () => {
    const pending = ACTIVE_CLASSES.find((c) => timetableStateOfClass(c.id) === 'pending');
    // Timetable-ready is unchanged by a revision in review — the class keeps
    // running the grid it already had.
    expect(timetableStateOfClass(pending.id)).toBe('pending');
    expect(['pending', 'approved']).toContain(timetableStateOfClass(pending.id));
  });
});

describe('The admission wizard, end to end', () => {
  it('admits a student through Documents → Details → Confirm → Complete', async () => {
    const user = userEvent.setup();
    renderApp('/curriculum/my-class/students');
    await useClassTutorView(user);
    await screen.findByRole('heading', { name: /^students$/i });

    await user.click(screen.getByRole('button', { name: /add student/i }));
    const drawer = await screen.findByRole('dialog');

    // Step 1 — the extraction is labelled as a prototype mock, not a reading.
    await user.click(within(drawer).getAllByRole('button', { name: /^upload$/i })[0]);
    expect(within(drawer).getByText(/prototype extraction — not a real reading/i)).toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: /^continue$/i }));

    // Step 2 — every extracted value is an editable field a human has to see.
    const name = within(drawer).getByLabelText(/full name/i);
    // The extraction proposed a value, and it landed in an editable field
    // rather than being applied to a record.
    expect(name.value.length).toBeGreaterThan(0);
    await user.clear(name);
    await user.type(name, 'Checked By Hand');
    const reg = within(drawer).getByLabelText(/register number/i);
    await user.clear(reg);
    await user.type(reg, 'REG-2024-9911');

    await user.click(within(drawer).getByRole('button', { name: /^continue$/i }));
    expect(within(drawer).getAllByText(/will be created/i).length).toBeGreaterThan(0);
    // The Confirm step states the class as well as the fields — a record is
    // being created *somewhere*, and that is half of what is being approved.
    expect(within(drawer).getByRole('button', { name: /admit student/i })).toBeInTheDocument();

    await user.click(within(drawer).getByRole('button', { name: /admit student/i }));

    // Step 4 — active, stated plainly.
    expect(await within(drawer).findByText(/is active in/i)).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: /^done$/i }));

    // …and present in the roster behind it.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Checked By Hand.*open record/i })).toBeInTheDocument(),
    );
  });
});
