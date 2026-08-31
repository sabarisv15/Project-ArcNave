import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ACTIVE_CLASSES } from '../lib/academicCalendar';
import { ALL_STUDENTS, studentsOfClass as baselineStudentsOfClass } from '../lib/rosterData';
import { useAcademicTerm } from './AcademicTermProvider';

/**
 * The institution's roster, as the prototype currently has it.
 *
 * **One roster, read by every seat.** Phase 0 collapsed three parallel student
 * populations into a single identity space in `rosterData.js`; this layer is
 * what keeps that true once the roster can *change*. A Class Tutor admitting or
 * importing a student activates them in the real active class roster — so the
 * Head of Department and Principal workspaces must resolve the very same record,
 * by the very same id, the moment they are built. Holding new students in a
 * provider mounted only under the L4 routes would recreate exactly the
 * second-source-of-truth defect Phase 0 deleted, with the added twist that the
 * second source would disappear on navigation.
 *
 * So the provider is mounted **above every institutional route**, and its
 * selectors — not the fixture module — are what any seat's screens read once
 * they need live roster state.
 *
 * **The fixture module is never mutated.** `rosterData.js` stays the immutable
 * deterministic baseline it was; this layer holds an *overlay* of locally
 * created students and composes the two on read. Reloading the prototype
 * returns it to the baseline, which is the behaviour a deterministic fixture is
 * for. Nothing is persisted: there is no localStorage convention for domain
 * data in this project (the only stored keys are one-off UI hints), and
 * inventing one would make a demo's state outlive the demo.
 *
 * **Prototype-local interaction, not authorization.** `admitStudent` refuses a
 * class that is not the caller's own, and refuses to exceed a provisioned
 * capacity. Both are interaction behaviour so the designed experience can be
 * reviewed honestly; neither is a security boundary, and in the product both
 * decisions are made server-side against the resolved Position Account.
 *
 * Shapes
 *  Overlay  { [classId]: Student[] }   — locally created, appended in order
 *  Outcome  { ok: true, student } | { ok: false, reason, detail }
 */

const AcademicRosterContext = createContext(null);

/** Why a create was refused, in the words a screen should use. */
export const REJECTION = {
  unknown_class: 'That class is not running this semester.',
  out_of_scope: 'This position can only add students to its own class.',
  at_capacity: 'This section is at its provisioned capacity.',
  duplicate: 'A student with this register number is already placed in this class.',
  missing_field: 'A required field is missing.',
};

/**
 * A canonical identifier, normalised for comparison.
 *
 * Register number is the identifier a college actually dedups on, and it is
 * compared case- and space-insensitively because a CSV will not be consistent
 * about either. Names are deliberately **not** part of the check: two students
 * genuinely share a name often enough that rejecting on it would block real
 * admissions.
 */
export function canonicalKey(reg) {
  return String(reg ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/**
 * The id a newly created student gets.
 *
 * It continues the baseline's own `${classId}-s${n}` sequence rather than
 * opening a second id space for locally created students — a student admitted
 * today is not a different kind of record from one who was promoted in, and an
 * id that announced how they arrived would invite screens to branch on it.
 * `origin` is the field that carries that, and it is separate for exactly that
 * reason. Deterministic given the roster it lands in: the same sequence of
 * admissions always produces the same ids.
 */
function nextIdentity(classId, existing) {
  const used = new Set(existing.map((s) => s.id));
  let n = existing.length;
  let id = `${classId}-s${n}`;
  while (used.has(id)) {
    n += 1;
    id = `${classId}-s${n}`;
  }
  const roll = String(existing.reduce((max, s) => Math.max(max, Number(s.roll) || 0), 0) + 1).padStart(2, '0');
  return { id, roll };
}

/**
 * A new student record, in exactly the baseline's shape.
 *
 * Every field the roster carries is present, so no screen has to guard against
 * a locally created student being a thinner record than a seeded one. The
 * academic fields a new arrival genuinely has no history for start empty rather
 * than being invented: attendance is 0 because they have attended nothing yet,
 * and a fabricated 85% would be a lie the attendance screens would then report.
 */
function buildStudent({ id, roll, classId, departmentId, input, origin, documentsPending }) {
  return {
    id,
    name: String(input.name ?? '').trim(),
    roll,
    reg: String(input.reg ?? '').trim(),
    classId,
    departmentId,
    attendance: 0,
    feeTier: input.feeTier ?? 'pending',
    feeReceipt: false,
    cgpa: input.cgpa ?? '—',
    backlogCount: 0,
    hasPending: false,
    phone: String(input.phone ?? '').trim(),
    guardianPhone: String(input.guardianPhone ?? '').trim(),
    origin,
    documentsPending,
    flag: null,
    // The one field a seeded student does not carry: locally created records
    // are marked so the prototype can tell a demo addition from the fixture it
    // started with, without any screen needing to.
    createdLocally: true,
  };
}

export function AcademicRosterProvider({ children }) {
  /*
   * Which classes exist is a fact about the *term*, not about this module. At
   * generation 0 this index is `ACTIVE_CLASS_BY_ID` itself, so every rule below
   * resolves exactly the class it resolved before; after a commencement it is
   * the new band's classes, so a promotion places into a class that is actually
   * running rather than being refused as unknown.
   */
  const { activeClassById } = useAcademicTerm();

  /*
   * The overlay is held in a ref *and* in state, and the two are written
   * together. The ref is the authority the create actions read and write, so
   * `admitStudent` and `importStudents` can validate against the current roster
   * and return a truthful outcome **synchronously**; the state exists to
   * trigger the render. Computing the outcome inside a state updater instead
   * would make the return value depend on when React chose to run it, which is
   * not something a caller can reason about — and an admission that reports
   * success or failure a beat late is worse than one that reports nothing.
   */
  const overlayRef = useRef({});
  const [overlay, setOverlay] = useState(overlayRef.current);

  const commit = useCallback((next) => {
    overlayRef.current = next;
    setOverlay(next);
  }, []);

  const rosterOf = useCallback(
    (classId) => [...baselineStudentsOfClass(classId), ...(overlay[classId] ?? [])],
    [overlay],
  );

  /**
   * Every student in the institution, baseline plus overlay, in class order.
   * This is what a department or institution screen reads — the same array
   * shape `rosterData.ALL_STUDENTS` has, so those screens change their import
   * and nothing else when they are wired up.
   */
  const allStudents = useMemo(() => {
    const added = Object.values(overlay).flat();
    return added.length === 0 ? ALL_STUDENTS : [...ALL_STUDENTS, ...added];
  }, [overlay]);

  const studentById = useCallback((id) => allStudents.find((s) => s.id === id) ?? null, [allStudents]);

  const studentsOfDepartment = useCallback(
    (departmentId) => allStudents.filter((s) => s.departmentId === departmentId),
    [allStudents],
  );

  /** Enrolled against provisioned, and the headroom between them. */
  const classFill = useCallback(
    (classId) => {
      const cls = activeClassById[classId];
      if (!cls) return { enrolled: 0, capacity: 0, headroom: 0 };
      const enrolled = rosterOf(classId).length;
      return { enrolled, capacity: cls.capacity, headroom: Math.max(0, cls.capacity - enrolled) };
    },
    [rosterOf, activeClassById],
  );

  /**
   * Whether one prospective student can join a class, and why not if they
   * cannot. Pure and exported through the context so the admission wizard and
   * the import preview apply **one** rule rather than two that agree today.
   */
  const validateAdmission = useCallback(
    (classId, input, { scopeClassId = null, pending = [] } = {}) => {
      const cls = activeClassById[classId];
      if (!cls) return { ok: false, reason: 'unknown_class' };
      if (scopeClassId && scopeClassId !== classId) return { ok: false, reason: 'out_of_scope' };

      if (!String(input.name ?? '').trim()) return { ok: false, reason: 'missing_field', detail: 'Name' };
      if (!String(input.reg ?? '').trim()) return { ok: false, reason: 'missing_field', detail: 'Register number' };

      const key = canonicalKey(input.reg);
      const placed = rosterOf(classId);
      /*
       * A duplicate is checked against everyone already placed in the class —
       * seeded, promoted, admitted earlier in this session, and (for an import)
       * the rows above this one in the same file. A student promoted into the
       * class is the case that matters most: they are already enrolled, and
       * importing them again would create a second record for one person.
       */
      const clash =
        placed.find((s) => canonicalKey(s.reg) === key) ?? pending.find((s) => canonicalKey(s.reg) === key) ?? null;
      if (clash) {
        return { ok: false, reason: 'duplicate', detail: clash.origin ?? 'placed', clash };
      }

      if (placed.length + pending.length >= cls.capacity) {
        return { ok: false, reason: 'at_capacity' };
      }

      return { ok: true };
    },
    [rosterOf, activeClassById],
  );

  /**
   * Admit one student, and activate them immediately.
   *
   * There is no approval queue between a valid submission and an active
   * student: a Class Tutor admitting a genuinely new student into their own
   * class is the decision, not a request for one.
   */
  const admitStudent = useCallback(
    (classId, input, { scopeClassId = null, origin = 'admitted', documentsPending = false } = {}) => {
      const cls = activeClassById[classId];
      if (!cls) return { ok: false, reason: 'unknown_class' };

      const current = overlayRef.current;
      const existing = [...baselineStudentsOfClass(classId), ...(current[classId] ?? [])];
      const check = validateAdmissionAgainst(existing, cls, input, scopeClassId, classId);
      if (!check.ok) return check;

      const { id, roll } = nextIdentity(classId, existing);
      const student = buildStudent({
        id,
        roll,
        classId,
        departmentId: cls.departmentId,
        input,
        origin,
        documentsPending,
      });

      commit({ ...current, [classId]: [...(current[classId] ?? []), student] });
      return { ok: true, student };
    },
    [commit, activeClassById],
  );

  /**
   * Confirm a set of import rows.
   *
   * Only rows that are still valid at the moment of confirmation are taken —
   * the preview classified them, but capacity can have been consumed by an
   * admission in between, and the confirm step re-checks rather than trusting a
   * decision made earlier. Rows are applied in order against a running roster,
   * so a file containing the same student twice takes the first and rejects the
   * second rather than creating two records for one person.
   */
  const importStudents = useCallback(
    (classId, rows, { scopeClassId = null } = {}) => {
      const cls = activeClassById[classId];
      if (!cls) {
        return { accepted: [], rejected: rows.map((row) => ({ row, reason: 'unknown_class' })) };
      }

      const current = overlayRef.current;
      const added = [...(current[classId] ?? [])];
      const accepted = [];
      const rejected = [];

      rows.forEach((input) => {
        const existing = [...baselineStudentsOfClass(classId), ...added];
        const check = validateAdmissionAgainst(existing, cls, input, scopeClassId, classId);
        if (!check.ok) {
          rejected.push({ row: input, ...check });
          return;
        }
        const { id, roll } = nextIdentity(classId, existing);
        const student = buildStudent({
          id,
          roll,
          classId,
          departmentId: cls.departmentId,
          input,
          origin: 'imported',
          // An imported student has a record and no documents yet. It is a
          // follow-up, never a hold on enrolment — they are active either way.
          documentsPending: true,
        });
        added.push(student);
        accepted.push(student);
      });

      if (accepted.length > 0) commit({ ...current, [classId]: added });
      return { accepted, rejected };
    },
    [commit, activeClassById],
  );

  /**
   * Place a student who **already exists** into a class.
   *
   * This is what a confirmed promotion does, and it is deliberately a different
   * operation from `admitStudent`. An admission mints an identity; a promotion
   * carries one across a semester boundary. The record keeps the id, register
   * number and name it already had, so the Class Tutor, the Head of Department
   * and the Principal all resolve one person before and after the transition —
   * and so `origin: 'promoted'` means what it says on the L4 roster, where it is
   * the reason that student is never offered an onboarding action.
   *
   * The capacity and duplicate rules are the ordinary ones: a promotion cannot
   * overfill a provisioned section, and somebody already placed in the target
   * class is refused rather than duplicated.
   */
  const placeExisting = useCallback(
    (classId, student, { origin = 'promoted', documentsPending = false, extra = {} } = {}) => {
      const cls = activeClassById[classId];
      if (!cls) return { ok: false, reason: 'unknown_class' };

      const current = overlayRef.current;
      const existing = [...baselineStudentsOfClass(classId), ...(current[classId] ?? [])];
      const check = validateAdmissionAgainst(existing, cls, student, null, classId);
      if (!check.ok) return check;

      const { roll } = nextIdentity(classId, existing);
      const placed = {
        ...buildStudent({
          id: student.id,
          roll,
          classId,
          departmentId: cls.departmentId,
          input: student,
          origin,
          documentsPending,
        }),
        /*
         * Carried across rather than reset: a promoted student's academic
         * standing is the standing they earned last semester. Only attendance
         * starts from nothing, because the semester it is measured over has.
         */
        cgpa: student.cgpa ?? '—',
        backlogCount: student.backlogCount ?? 0,
        feeTier: student.feeTier ?? 'pending',
        // Not a locally invented record — this person was already in the roster
        // of a class that has since closed.
        createdLocally: false,
        ...extra,
      };

      commit({ ...current, [classId]: [...(current[classId] ?? []), placed] });
      return { ok: true, student: placed };
    },
    [commit, activeClassById],
  );

  /**
   * Back to the deterministic baseline. The prototype has no seat or fixture
   * reset of its own, so this exists for tests and for a reviewer who wants a
   * clean run without reloading.
   */
  const resetRoster = useCallback(() => commit({}), [commit]);

  const value = useMemo(
    () => ({
      allStudents,
      studentsOfClass: rosterOf,
      studentsOfDepartment,
      studentById,
      classFill,
      validateAdmission,
      admitStudent,
      importStudents,
      placeExisting,
      resetRoster,
      locallyAdded: Object.values(overlay).flat(),
    }),
    [
      allStudents,
      rosterOf,
      studentsOfDepartment,
      studentById,
      classFill,
      validateAdmission,
      admitStudent,
      importStudents,
      placeExisting,
      resetRoster,
      overlay,
    ],
  );

  return <AcademicRosterContext.Provider value={value}>{children}</AcademicRosterContext.Provider>;
}

/**
 * The same rule `validateAdmission` applies, against an explicitly supplied
 * roster.
 *
 * The create actions need to check each row against the roster **including the
 * rows accepted before it**, not against the roster as it was when the drawer
 * opened. Passing the running set in explicitly is what makes an import of two
 * identical rows take the first and reject the second, and what stops a file
 * longer than the remaining headroom from overfilling the section.
 */
function validateAdmissionAgainst(existing, cls, input, scopeClassId, classId) {
  if (scopeClassId && scopeClassId !== classId) return { ok: false, reason: 'out_of_scope' };
  if (!String(input.name ?? '').trim()) return { ok: false, reason: 'missing_field', detail: 'Name' };
  if (!String(input.reg ?? '').trim()) return { ok: false, reason: 'missing_field', detail: 'Register number' };

  const key = canonicalKey(input.reg);
  const clash = existing.find((s) => canonicalKey(s.reg) === key);
  if (clash) return { ok: false, reason: 'duplicate', detail: clash.origin ?? 'placed', clash };

  if (existing.length >= cls.capacity) return { ok: false, reason: 'at_capacity' };
  return { ok: true };
}

export function useAcademicRoster() {
  const ctx = useContext(AcademicRosterContext);
  if (!ctx) throw new Error('useAcademicRoster must be used inside AcademicRosterProvider');
  return ctx;
}

/** Every active class, for anything that needs the list without the calendar. */
export { ACTIVE_CLASSES };
