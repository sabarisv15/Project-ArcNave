import { useMemo } from 'react';
import {
  DEPARTMENTS,
  FACULTY_BY_ID,
  INSTITUTION,
  departmentLabel,
} from '../lib/institutionData';
import { PROVISIONING } from '../lib/provisioning';
import { INSTITUTION_ATTENTION, departmentHealth } from '../lib/institutionSignals';
import { deriveInstitutionReadiness } from '../lib/institutionReadiness';
import { buildLiveSnapshot, deriveInstitutionSetup } from '../lib/institutionSetupData';
import { useAcademicTerm } from '../store/AcademicTermProvider';
import { useAcademicRoster } from '../store/AcademicRosterProvider';
import { useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';

/**
 * The institution as it currently is, rather than as it was when the fixtures
 * loaded.
 *
 * **Why a hook and not another module constant.** `DEPARTMENT_HEALTH` and
 * `INSTITUTION_SETUP` are computed once, at import, from the seat and timetable
 * records as they stood then. That was correct while none of them could change.
 * Now an institution head can fill a department's leadership seat and commence a
 * semester, and a governance screen that kept reading the frozen arrays would
 * report a vacancy that had just been filled — which is the one thing a
 * readiness panel must never do.
 *
 * So the derivations stay exactly where they are, pure and testable, and this
 * hook is what hands them live inputs. The frozen exports remain, because a test
 * asserting the baseline reading should not have to mount three providers.
 *
 * Everything here is **read-only**. No action is exposed, and the two readings
 * that belong to other seats — Class Tutor coverage and promotion progress —
 * arrive as counts with nothing attached to them.
 */
export function useInstitutionHealth() {
  const { term, activeClasses, timetableStateOf, attendanceLiveFor } = useAcademicTerm();
  const { studentsOfClass } = useAcademicRoster();
  const { coverage, hodCoverage, hodSeatOf, seatOf, reviewProgressByDepartment } =
    useInstitutionalLifecycle();

  const enrolledOf = useMemo(() => (classId) => studentsOfClass(classId).length, [studentsOfClass]);

  /**
   * Department rows resolved against the **live** leadership seats.
   *
   * `departmentHealth` is the same function the frozen export uses; only the
   * seat it is told about differs. A department whose head was invited a moment
   * ago reads as invited here and as vacant in the frozen array, and this is the
   * one the screens render.
   *
   * An invitation deliberately does not produce a `hod`: the seat is not held
   * until it is accepted, and a row that named the invitee as the head would
   * report an institution as led while a department had nobody.
   */
  const departments = useMemo(
    () =>
      DEPARTMENTS.map((d) => {
        const seat = hodSeatOf(d.id);
        const holderId = seat?.state === 'active' ? seat.holderId : null;
        return departmentHealth(
          { ...d, hodId: holderId, hodSeatState: seat?.state ?? 'vacant' },
          { seat, hod: holderId ? FACULTY_BY_ID[holderId] ?? null : null }
        );
      }),
    [hodSeatOf]
  );

  const departmentById = useMemo(
    () => Object.fromEntries(departments.map((d) => [d.id, d])),
    [departments]
  );

  const promotionProgress = useMemo(
    () => reviewProgressByDepartment(),
    [reviewProgressByDepartment]
  );

  const readiness = useMemo(
    () =>
      deriveInstitutionReadiness({
        institution: INSTITUTION,
        provisioning: PROVISIONING,
        term,
        classes: activeClasses,
        departments: DEPARTMENTS,
        enrolledOf,
        tutorCoverage: coverage(),
        hodCoverage: hodCoverage(),
        promotionProgress,
        departmentName: departmentLabel,
        timetableStateOf,
        attendanceLiveFor,
        attention: INSTITUTION_ATTENTION,
      }),
    [
      term,
      activeClasses,
      enrolledOf,
      coverage,
      hodCoverage,
      promotionProgress,
      timetableStateOf,
      attendanceLiveFor,
    ]
  );

  /**
   * The readiness rows, over the same live facts.
   *
   * Class Tutor coverage comes from each class's own seat record, so a term that
   * has just been commenced reports its new vacant seats rather than the closed
   * term's assignments. An outstanding invitation is not coverage here either.
   */
  const setup = useMemo(
    () =>
      deriveInstitutionSetup(
        buildLiveSnapshot({
          yearActive: term?.state === 'active',
          academicYear: term?.yearLabel ?? null,
          departments: DEPARTMENTS,
          classes: activeClasses,
          hodStateOf: (id) => {
            const state = hodSeatOf(id)?.state;
            return state === 'active' ? 'active' : state === 'invite_pending' ? 'invited' : 'vacant';
          },
          hasTutor: (classId) => seatOf(classId)?.state === 'active',
          timetableStateOf,
          promotion: {
            total: readiness.promotion.total,
            reviewed: readiness.promotion.reviewed,
            pending: readiness.promotion.pending,
          },
        })
      ),
    [activeClasses, hodSeatOf, readiness, seatOf, term, timetableStateOf]
  );

  return { readiness, setup, departments, departmentById };
}
