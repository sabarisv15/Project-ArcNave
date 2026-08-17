/**
 * The academic year, the active semester band, and the classes that follow
 * from them.
 *
 * **ArcNave applies from Semester 3 onward.** Semester 1 and 2 — the whole of
 * Year 1 — are not modelled anywhere in this product: no roster, no class, no
 * Class Tutor seat, no timetable, no attendance, no readiness count, and no
 * capacity-only placeholder row either. This module is where that rule is
 * enforced once, structurally, rather than remembered on every screen. A
 * fixture cannot reintroduce a first-year class, because no fixture names a
 * class at all.
 *
 * **Only one band is active at a time.** An odd term runs semesters 3, 5 and 7;
 * an even term runs 4, 6 and 8. Which band is active is a property of the
 * academic year, and every active class in the institution is the cross product
 * of that band with each department's provisioned sections, capped by the
 * department's course duration.
 *
 * **Nothing here is a total anyone typed.** The number of active classes, and
 * therefore the number of Class Tutor seats, is derived — change the band,
 * a course duration or a section list in `provisioning.js` and every count in
 * the app moves with it. That is the point: a hard-coded seat total is a
 * fixture that stops being true the first time an institution changes shape.
 *
 * Local/mock only; keep these shapes.
 *
 * Shapes
 *  AcademicYear { id, label, state: 'draft' | 'active' | 'completed', band }
 *  ActiveClass  { id, departmentId, semester, section, year, capacity,
 *                 code, programme }
 */

import { PROVISIONED_DEPARTMENTS, PROVISIONING } from './provisioning';

/**
 * The semesters each band runs, and the only two lists in the product.
 *
 * Neither contains 1 or 2, and no code path adds to them — the rule is the
 * data here, not a filter applied somewhere downstream.
 */
export const BAND_SEMESTERS = {
  odd: [3, 5, 7],
  even: [4, 6, 8],
};

export const BAND_LABELS = {
  odd: 'Odd semester',
  even: 'Even semester',
};

/**
 * The academic year this institution is currently running.
 *
 * `state` is a real lifecycle, not a label: `draft` is a year that has been
 * created but not commenced, `active` is the one operations hang off, and
 * `completed` is archived and read-only. Attendance requires an `active` year
 * as well as an approved timetable — an approved grid with no active year is
 * not attendance, it is preparation.
 */
export const ACADEMIC_YEAR = {
  id: 'ay-2026-27',
  label: '2026–27',
  state: 'active',
  band: 'even',
};

export const ACTIVE_BAND = ACADEMIC_YEAR.band;

export const IS_YEAR_ACTIVE = ACADEMIC_YEAR.state === 'active';

/** The year a semester belongs to. Semester 4 is year 2, semester 7 is year 4. */
export function yearOfSemester(semester) {
  return Math.ceil(semester / 2);
}

const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };

/**
 * The semesters a department is actually running this term.
 *
 * The band, capped by the course. A three-year programme in an even term runs
 * semesters 4 and 6; a four-year one also runs 8. Nothing below 3 can appear,
 * because nothing below 3 is in either band.
 */
export function activeSemestersFor(department, band = ACTIVE_BAND) {
  const maxSemester = department.durationYears * 2;
  return BAND_SEMESTERS[band].filter((s) => s <= maxSemester);
}

/**
 * A class id, derived from the facts that identify it.
 *
 * Semester-and-section rather than an index into a list: an index silently
 * re-points at a different class the moment the band changes or a section is
 * added, which is exactly the kind of drift a shared id must not have.
 */
export function classIdFor(departmentId, semester, section) {
  return `${departmentId}-s${semester}${section.toLowerCase()}`;
}

function buildClass(department, semester, sectionEntry) {
  const year = yearOfSemester(semester);
  return {
    id: classIdFor(department.id, semester, sectionEntry.section),
    departmentId: department.id,
    semester,
    section: sectionEntry.section,
    year,
    capacity: sectionEntry.capacity,
    code: `${ROMAN[year]} ${department.programmeShort} — ${sectionEntry.section}`,
    programme: `${ROMAN[year]} ${department.programmeLabel}`,
  };
}

/**
 * Every active class in a department — one per active `semester × section`.
 *
 * This is also, exactly, the department's Class Tutor seat list: the rule that
 * every active semester-section class has exactly one L4 seat is expressed by
 * `seatState.js` building its seats from this array and nothing else.
 */
export function activeClassesFor(department, band = ACTIVE_BAND) {
  return activeSemestersFor(department, band).flatMap((semester) =>
    department.sections.map((sectionEntry) => buildClass(department, semester, sectionEntry))
  );
}

/**
 * The whole institution's active classes, for the live provisioned fixture.
 *
 * 25 of them, and not one of them written down: six departments, their own
 * durations, their own section lists, crossed with the even band.
 */
export const ACTIVE_CLASSES = PROVISIONED_DEPARTMENTS.flatMap((d) => activeClassesFor(d));

export const ACTIVE_CLASS_BY_ID = Object.fromEntries(ACTIVE_CLASSES.map((c) => [c.id, c]));

export const ACTIVE_CLASS_TOTAL = ACTIVE_CLASSES.length;

export function activeClassesOfDepartment(departmentId) {
  return ACTIVE_CLASSES.filter((c) => c.departmentId === departmentId);
}

export function activeClass(classId) {
  return ACTIVE_CLASS_BY_ID[classId] ?? null;
}

/**
 * The active classes of any provisioning + band pair, for the fixtures that are
 * not the live one. Pure, so a test can build an institution's whole class list
 * without touching module state.
 */
export function activeClassesOf(provisioning, band) {
  return provisioning.departments.flatMap((d) => activeClassesFor(d, band));
}

/**
 * The semester band as one short phrase, for a scope header.
 *
 * Names the semesters rather than the parity alone: "Even semester" tells a
 * reader which half of the year it is, "4 · 6 · 8" tells them which classes are
 * on screen, and the second is the one they are actually looking at.
 */
export function bandLabel(band = ACTIVE_BAND) {
  return `${BAND_LABELS[band]} · ${BAND_SEMESTERS[band].join(' · ')}`;
}

/**
 * The band that follows this one.
 *
 * The whole of a semester transition, as far as the calendar is concerned: an
 * odd term is followed by an even one and an even term by an odd one. Neither
 * list this maps between contains 1 or 2, so a commencement has no way to
 * produce a first-year class however many times it is run.
 */
export function nextBandAfter(band) {
  return band === 'odd' ? 'even' : 'odd';
}

/**
 * The academic-year label the next band belongs to.
 *
 * An odd band opens an academic year and the even band closes the same one, so
 * commencing out of an even term rolls the year over and commencing out of an
 * odd term does not. The label is parsed rather than counted from a fixture,
 * because the year a term belongs to is a property of the term.
 */
export function nextYearLabelAfter(label, band) {
  if (band === 'odd') return label;
  const start = Number(String(label).slice(0, 4));
  if (!Number.isFinite(start)) return label;
  return `${start + 1}–${String(start + 2).slice(2)}`;
}

/** The academic-year lifecycle states, in the badge vocabulary already in use. */
export const YEAR_STATES = {
  draft: { label: 'Draft', tone: 'text-ink-soft bg-tint2' },
  active: { label: 'Active', tone: 'text-success bg-success-soft' },
  completed: { label: 'Completed', tone: 'text-ink-soft bg-tint2' },
};

/** The institution the calendar belongs to — read, never restated. */
export const CALENDAR_INSTITUTION = PROVISIONING.institution;
