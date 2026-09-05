/**
 * What an institution head can actually read about their institution.
 *
 * **Every figure here is derived, and none of it is a total anyone typed.** The
 * department count is the provisioned departments; the class count is the active
 * band crossed with those departments' sections; provisioned capacity is the sum
 * of those classes' own capacities; enrolment is the roster; seat coverage is the
 * seat records; timetable and attendance coverage are the timetable states;
 * promotion progress is the review queue against the decisions taken on it. A
 * hand-maintained institution total is a number that stops being true the first
 * time an institution changes shape — and this seat is precisely the one that
 * would never notice.
 *
 * **It reads; it does not decide.** Nothing in this module is an action, and the
 * three readings that belong to other seats say whose they are: Class Tutor
 * coverage is each head of department's, promotion progress is each head of
 * department's, and attendance is nobody's — it is a consequence.
 *
 * **Provisioned structure is not readiness.** Departments, intake, sections and
 * capacities arrive from Platform Admin, which is built outside this prototype.
 * They appear here as the denominator an operational figure is measured
 * against, never as a task.
 *
 * Pure. The live values are assembled by `useInstitutionHealth`, which resolves
 * them from the term, roster and lifecycle layers.
 *
 * Shapes
 *  Readiness { identity, year, scale, capacity, seats, promotion, timetable,
 *              attendance, attention }
 */

import { PRINCIPAL_L1 } from './roles';
import { seatTitle } from './seatTitles';
import { TERM_STATES, NO_ACTIVE_TERM, bandLabelOfTerm } from './academicTerm';

/**
 * The institution's own identity and this seat's configured title.
 *
 * The title is read through `seatTitle` rather than written, so a college that
 * calls the seat "Director" sees that word on its own dashboard without any
 * screen changing. It is deliberately part of the readiness reading rather than
 * a header decoration: "who is reading this, and over what" is the first fact a
 * governance screen owes its reader.
 */
export function institutionIdentity(institution, provisioning) {
  return {
    institutionName: institution.name,
    seatTitle: seatTitle(PRINCIPAL_L1, provisioning),
  };
}

/** The academic year as a label, a state badge and a band. */
export function yearReading(term) {
  if (!term) {
    return { label: '—', state: NO_ACTIVE_TERM, band: '—', active: false, isNone: true };
  }
  return {
    label: term.yearLabel,
    state: TERM_STATES[term.state] ?? NO_ACTIVE_TERM,
    band: bandLabelOfTerm(term),
    active: term.state === 'active',
    isNone: false,
    generation: term.generation,
  };
}

/**
 * Capacity against enrolment.
 *
 * The capacity is the sum of the **active classes'** provisioned capacities, not
 * the departments' approved intake: intake is how many a department may admit in
 * a year, and capacity is how many seats the classes currently running actually
 * have. Reporting one as the other would tell an institution head their
 * institution was half empty when it was full.
 */
export function capacityReading(classes, enrolledOf) {
  const capacity = classes.reduce((sum, c) => sum + c.capacity, 0);
  const enrolled = classes.reduce((sum, c) => sum + enrolledOf(c.id), 0);
  return {
    capacity,
    enrolled,
    headroom: Math.max(0, capacity - enrolled),
    utilisation: capacity === 0 ? 0 : Math.round((enrolled / capacity) * 100),
  };
}

/**
 * A coverage reading as a sentence and a fraction.
 *
 * An outstanding invitation is **not** coverage, at either seat level. A seat is
 * not held until it is accepted, and a figure that counted invitations as filled
 * would report an institution as covered while classes had nobody in front of
 * them. `active` is therefore the numerator and `invited` is carried separately
 * rather than added to it.
 */
export function coverageReading(coverage) {
  const { total, active, invited, vacant } = coverage;
  return {
    total,
    active,
    invited,
    vacant,
    complete: total > 0 && active === total,
    summary: total === 0 ? 'None to cover' : `${active} of ${total} active · ${invited} invited · ${vacant} vacant`,
  };
}

/** Promotion review across every department that has a queue. */
export function promotionReading(progressByDepartment, departmentName) {
  const total = progressByDepartment.reduce((sum, p) => sum + p.total, 0);
  const reviewed = progressByDepartment.reduce((sum, p) => sum + p.reviewed, 0);
  return {
    total,
    reviewed,
    pending: total - reviewed,
    complete: total > 0 && reviewed === total,
    byDepartment: progressByDepartment.map((p) => ({
      ...p,
      name: departmentName(p.departmentId),
      percent: p.total === 0 ? 100 : Math.round((p.reviewed / p.total) * 100),
    })),
  };
}

/**
 * Timetable coverage across every active class.
 *
 * `approved` and `live` are deliberately different counts. A class with a
 * revision in review keeps running the grid it already had, so it is covered —
 * but its timetable is not settled, and attendance is not available against a
 * grid that is mid-decision. Conflating the two was a real defect once and the
 * two figures exist so it cannot recur.
 */
export function timetableReading(classes, timetableStateOf) {
  const states = classes.map((c) => timetableStateOf(c.id));
  const approved = states.filter((s) => s === 'approved').length;
  const pending = states.filter((s) => s === 'pending').length;
  const notSubmitted = states.filter((s) => s === 'not_submitted').length;
  return {
    total: classes.length,
    approved,
    pending,
    notSubmitted,
    covered: approved + pending,
    settled: approved,
  };
}

/** Attendance coverage — a consequence of the reading above, never a setting. */
export function attendanceReading(classes, attendanceLiveFor) {
  const live = classes.filter((c) => attendanceLiveFor(c.id)).length;
  return {
    total: classes.length,
    live,
    locked: classes.length - live,
    percent: classes.length === 0 ? 0 : Math.round((live / classes.length) * 100),
  };
}

/**
 * The whole reading, assembled.
 *
 * Every argument is a resolver rather than a value, so this cannot accidentally
 * be handed a stale snapshot: it computes against whatever the caller can
 * currently resolve, which after a commencement is the new term's classes,
 * seats and states.
 */
export function deriveInstitutionReadiness({
  institution,
  provisioning,
  term,
  classes,
  departments,
  enrolledOf,
  tutorCoverage,
  hodCoverage,
  promotionProgress,
  departmentName,
  timetableStateOf,
  attendanceLiveFor,
  attention = [],
}) {
  return {
    identity: institutionIdentity(institution, provisioning),
    year: yearReading(term),
    scale: {
      departmentCount: departments.length,
      classCount: classes.length,
    },
    capacity: capacityReading(classes, enrolledOf),
    seats: {
      hod: coverageReading(hodCoverage),
      tutor: coverageReading(tutorCoverage),
    },
    promotion: promotionReading(promotionProgress, departmentName),
    timetable: timetableReading(classes, timetableStateOf),
    attendance: attendanceReading(classes, attendanceLiveFor),
    attention,
  };
}
