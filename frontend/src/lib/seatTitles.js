/**
 * What this college calls each seat.
 *
 * The one place a seat key becomes a word. Every scope header, badge, switcher
 * entry, audit line and empty state renders through `seatTitle()`, so changing
 * a provisioned title changes the whole interface and changing a key changes
 * none of it.
 *
 * **Never render an L-number.** "L1", "L3", "L4" are internal vocabulary for
 * this codebase and its documentation; a college that calls its L3 seat
 * "Department Head" should never see the letter L anywhere. The scope note is
 * the same rule one level down: it says what the seat acts over — an
 * institution, a delegated scope, a department, one class — in the words the
 * screen already uses, and it is derived from the seat's actual scope rather
 * than hard-coded, which is why no department name appears in this file.
 */

import { PROVISIONING } from './provisioning';
import { CLASS_TUTOR_L4, HOD_L3, LEVEL_2, PRINCIPAL_L1, TEACHING_STAFF } from './roles';

/**
 * The fallback title for a seat whose configured title is missing.
 *
 * A provisioned institution that omits a title is a real state — most obviously
 * the L2 entry in an institution that has no L2 seat — and the interface has to
 * say something rather than render `undefined`. These are deliberately generic:
 * they are what the product calls the seat when the college has not, never a
 * second opinion about what the college meant.
 */
const GENERIC_TITLES = {
  [PRINCIPAL_L1]: 'Institution Head',
  [LEVEL_2]: 'Delegated Officer',
  [HOD_L3]: 'Department Head',
  [CLASS_TUTOR_L4]: 'Class Tutor',
  [TEACHING_STAFF]: 'Teaching Staff',
};

/**
 * The configured display title for a seat.
 *
 * `provisioning` is a parameter rather than a fixed import so the L2-absent
 * institution can be resolved in tests without a module-level swap.
 */
export function seatTitle(key, provisioning = PROVISIONING) {
  return provisioning?.roleTitles?.[key] ?? GENERIC_TITLES[key] ?? 'Seat';
}

/** Whether the college configured a title for this seat at all. */
export function hasConfiguredTitle(key, provisioning = PROVISIONING) {
  return Boolean(provisioning?.roleTitles?.[key]);
}

/**
 * The scope a seat acts over, as one short phrase.
 *
 * Taken as an argument rather than looked up, because scope is a property of
 * the *session* — which department, which class — not of the seat kind. What
 * this function owns is only the wording, so "One class" reads the same way in
 * the switcher, the sidebar indicator and an empty state.
 */
export function seatScopeNote(key, { departmentShort, classCode, areaCount } = {}) {
  if (key === PRINCIPAL_L1) return 'Institution';
  if (key === LEVEL_2) {
    return typeof areaCount === 'number' ? `Delegated scope · ${areaCount} areas` : 'Delegated scope';
  }
  if (key === HOD_L3) return departmentShort ? `${departmentShort} department` : 'One department';
  if (key === CLASS_TUTOR_L4) return classCode ?? 'One class';
  return 'Your assigned classes';
}
