import { useMemo } from 'react';
import { DEPARTMENT_ID, DEPT_CLASSES } from '../lib/departmentData';
import { classHealth } from '../lib/departmentSignals';
import { mean } from '../lib/rosterData';
import { attendanceLiveFor, isTimetableReady, timetableStateOfClass } from '../lib/timetableState';
import { useAcademicRoster } from '../store/AcademicRosterProvider';
import { useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';

/**
 * The department's active classes, resolved against everything that can move.
 *
 * `DEPT_CLASSES` is settled at import off the canonical baseline, which is
 * correct and also not enough: a seat can be reassigned and a student can be
 * promoted while the prototype is running, and every L3 screen has to read the
 * result of the action the screen next to it just took. This hook is where those
 * live layers meet the derived class list, once, so the overview, the class
 * table and the drawers are three readings of one set of facts rather than three
 * near-identical compositions that drift.
 *
 * Nothing here is a stored total. The class list is still the provisioned
 * sections crossed with the active band; the seat list is still one seat per
 * class; enrolment is still counted off the roster. Change a section in
 * `provisioning.js` and every figure this returns moves with it.
 */
export function useDepartmentClasses(departmentId = DEPARTMENT_ID) {
  const { studentsOfClass, classFill } = useAcademicRoster();
  const { seatOf, coverage } = useInstitutionalLifecycle();

  return useMemo(() => {
    /*
     * Filtered on the class's own department rather than trusting that this
     * array was built for the department the caller asked about. It is the same
     * list either way today; it stops being the same list the moment anything
     * upstream widens.
     */
    const base = DEPT_CLASSES.filter((c) => c.departmentId === departmentId);

    const classes = base.map((cls) => {
      const roster = studentsOfClass(cls.id);
      const seat = seatOf(cls.id);
      const fill = classFill(cls.id);

      return {
        ...classHealth(cls, {
          seat,
          studentCount: roster.length,
          attendance: mean(roster.map((s) => s.attendance)),
        }),
        seat,
        enrolled: fill.enrolled,
        headroom: fill.headroom,
        timetableState: timetableStateOfClass(cls.id),
        timetableReady: isTimetableReady(cls.id),
        attendanceLive: attendanceLiveFor(cls.id),
      };
    });

    const capacity = classes.reduce((sum, c) => sum + c.capacity, 0);
    const enrolled = classes.reduce((sum, c) => sum + c.enrolled, 0);

    return {
      classes,
      totals: {
        classCount: classes.length,
        capacity,
        enrolled,
        headroom: Math.max(0, capacity - enrolled),
        timetableReady: classes.filter((c) => c.timetableReady).length,
        attendanceLive: classes.filter((c) => c.attendanceLive).length,
      },
      seatCoverage: coverage(departmentId),
    };
  }, [departmentId, studentsOfClass, classFill, seatOf, coverage]);
}
