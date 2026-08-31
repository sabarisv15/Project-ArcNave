import { describe, expect, it } from 'vitest';
import { ACTIVE_CLASSES } from '../lib/academicCalendar';
import { ALL_STUDENTS } from '../lib/rosterData';
import { CLASS_TUTOR_SEATS } from '../lib/seatState';
import { CLASS_TIMETABLE_STATES } from '../lib/timetableState';
import { OWNED_CLASS } from '../lib/classTutorData';
import { DEPT_CLASSES } from '../lib/departmentData';
import { INST_CLASSES } from '../lib/institutionData';
import { STAFF_CLASSES, STUDENTS } from '../lib/studentsData';
import { DAYS, TIMETABLE_VERSIONS, blocksForDay, ownedScopesForVersion } from '../lib/timetableData';
import { INCOMING_REQUESTS, MY_REQUESTS, SUBSTITUTE_LOG_HISTORY } from '../lib/substituteData';
import { REPORT_SESSIONS } from '../lib/reportsData';
import { PRIOR_CLASSES, REVIEW_CANDIDATES } from '../lib/promotionData';
import { TIMETABLE_VERSIONS as DEPT_TIMETABLE_VERSIONS } from '../lib/departmentTimetableData';

/**
 * The rule, applied to **every** fixture family in the app at once.
 *
 * ArcNave applies from semester 3 onward: semesters 1 and 2 — the whole of
 * Year 1 — have no class, roster, seat, timetable, attendance record or
 * teaching assignment anywhere in the product. That is not an institutional-
 * data rule with a personal-Staff exemption. A staff member cannot teach a
 * class that does not exist, so the personal Staff fixtures are held to it too.
 *
 * This suite exists because the rule was previously enforced screen by screen,
 * which is exactly how a first-year class survived in the Staff timetable and
 * substitute fixtures after being removed from every institutional one.
 *
 * A class label is checked as well as its numeric semester: a fixture can name
 * a class in text (`I B.Sc CS — A`, `MECH Semester 2`) without carrying a
 * `semester` field at all, and that is how three of the four surviving cases
 * were written.
 */

/** `I B.Sc CS — A`, `I B.E Mech — B` — a first-year class named in a label. */
const FIRST_YEAR_LABEL = /(^|[\s·—-])I\s+B\.(Sc|E|Com|A)\b/;
/** `MECH Semester 2`, `Semester 1` — a pre-ArcNave semester named in a label. */
const EARLY_SEMESTER_LABEL = /Semester\s*[12](\b|$)/;

function labelsOf(records, ...fields) {
  return records.flatMap((r) => fields.map((f) => r?.[f]).filter((v) => typeof v === 'string'));
}

function expectNoEarlyLabel(labels, what) {
  labels.forEach((label) => {
    expect(FIRST_YEAR_LABEL.test(label), `${what}: "${label}" names a first-year class`).toBe(false);
    expect(EARLY_SEMESTER_LABEL.test(label), `${what}: "${label}" names semester 1 or 2`).toBe(false);
  });
}

/**
 * Every class record the product can render, from every fixture family. The
 * whole point is that this list is exhaustive — a new fixture that is not in it
 * is a gap in the rule, not a gap in the test.
 */
const PRODUCT_VISIBLE_CLASSES = [
  ['active calendar', ACTIVE_CLASSES],
  ['L1 institution', INST_CLASSES],
  ['L3 department', DEPT_CLASSES],
  ['L4 owned class', [OWNED_CLASS]],
  ['personal Staff', STAFF_CLASSES],
  ['staff timetable scopes', TIMETABLE_VERSIONS.flatMap((v) => ownedScopesForVersion(v.id))],
  ['reports', REPORT_SESSIONS],
  /*
   * The semester-transition review queue is the newest way a first-year class
   * could have re-entered the product: it is the only fixture family that names
   * classes the institution is *not* currently running. It cannot name one
   * either — the prior band is 3/5/7, and this fixture derives its semesters
   * from `BAND_SEMESTERS` rather than listing them.
   */
  ['L3 promotion review — prior classes', PRIOR_CLASSES],
  ['L3 promotion review — candidates', REVIEW_CANDIDATES],
];

describe('No product-visible class is below semester 3', () => {
  PRODUCT_VISIBLE_CLASSES.forEach(([what, records]) => {
    it(`holds for the ${what} fixtures`, () => {
      expect(records.length).toBeGreaterThan(0);
      records.forEach((c) => {
        if (typeof c.semester === 'number') {
          expect(c.semester, `${what}: ${c.code ?? c.id}`).toBeGreaterThanOrEqual(3);
        }
        if (typeof c.year === 'number') {
          expect(c.year, `${what}: ${c.code ?? c.id}`).toBeGreaterThanOrEqual(2);
        }
      });
      expectNoEarlyLabel(labelsOf(records, 'code', 'programme', 'label', 'semester'), what);
    });
  });

  it('holds for every student’s current semester and placement', () => {
    ALL_STUDENTS.forEach((s) => {
      const cls = ACTIVE_CLASSES.find((c) => c.id === s.classId);
      expect(cls).toBeTruthy();
      expect(cls.semester).toBeGreaterThanOrEqual(3);
    });

    // Personal Staff students carry their own `currentSem`, derived from the
    // class they sit in rather than from the seeded year.
    STUDENTS.forEach((s) => {
      expect(s.currentSem, `staff student ${s.id}`).toBeGreaterThanOrEqual(3);
      expect(s.year, `staff student ${s.id}`).toBeGreaterThanOrEqual(2);
    });
  });

  it('holds for every Class Tutor seat and timetable record', () => {
    const byId = Object.fromEntries(ACTIVE_CLASSES.map((c) => [c.id, c]));
    CLASS_TUTOR_SEATS.forEach((s) => expect(byId[s.classId].semester).toBeGreaterThanOrEqual(3));
    CLASS_TIMETABLE_STATES.forEach((t) => expect(byId[t.classId].semester).toBeGreaterThanOrEqual(3));
  });

  /**
   * Every cell of every timetable version, not only the version currently
   * active: a first-year class sitting in a superseded revision is still a
   * first-year class the version picker can put on screen.
   */
  it('holds for the staff timetable’s own cells, in every version', () => {
    const cells = TIMETABLE_VERSIONS.flatMap((v) => DAYS.flatMap((d) => blocksForDay(d.key, v.id).map((b) => b.class)));
    expect(cells.length).toBeGreaterThan(0);
    cells.forEach((cls) => {
      if (typeof cls.year === 'number') expect(cls.year).toBeGreaterThanOrEqual(2);
    });
    expectNoEarlyLabel(labelsOf(cells, 'code', 'programme'), 'staff timetable cells');
  });

  /**
   * The department's own timetable versions, cell by cell and in every version
   * — including the two added for Phase 2's endorsement states. A revision the
   * Revisions tab can open is a revision that can put a class on screen.
   */
  it('holds for every cell of every department timetable version', () => {
    const byId = Object.fromEntries(ACTIVE_CLASSES.map((c) => [c.id, c]));
    const cells = DEPT_TIMETABLE_VERSIONS.flatMap((v) => v.cells);
    expect(cells.length).toBeGreaterThan(0);
    cells.forEach((cell) => {
      const cls = byId[cell.classId];
      expect(cls, `department timetable cell for ${cell.classId}`).toBeTruthy();
      expect(cls.semester).toBeGreaterThanOrEqual(3);
    });
    expectNoEarlyLabel(labelsOf(DEPT_TIMETABLE_VERSIONS, 'label', 'effectiveFrom'), 'department timetable versions');
  });

  it('holds for substitute requests and history', () => {
    const slotLabels = (items) =>
      items
        .flatMap((d) => [...(d.slots ?? []), d.slot].filter(Boolean))
        .map((s) => s.code ?? '')
        .filter(Boolean);

    expect(slotLabels(INCOMING_REQUESTS).length).toBeGreaterThan(0);
    expectNoEarlyLabel(slotLabels(INCOMING_REQUESTS), 'incoming substitute requests');
    expectNoEarlyLabel(slotLabels(MY_REQUESTS), 'my substitute requests');
    expectNoEarlyLabel(slotLabels(SUBSTITUTE_LOG_HISTORY), 'substitute history');
  });
});
