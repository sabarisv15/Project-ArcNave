/**
 * The institutional seats this prototype can render.
 *
 * **Keys only.** This file used to carry display labels and even a department
 * name; it no longer carries either. What a college calls a seat is provisioned
 * configuration and lives in `provisioning.js`, resolved through
 * `seatTitles.js` — so "Principal", "Dean — Academic Affairs" and "Class Tutor"
 * are strings this module has never heard of. Two colleges rendering different
 * words for the same seat must exercise the same code path, and that is only
 * true if the code path holds no word at all.
 *
 * **Nothing here grants, checks or implies authority** — this app has no auth
 * and no server. In the real product the active seat is resolved server-side
 * from the signed-in Position Account, and what a seat may do is decided there,
 * per class/department ownership, never by a list in the client.
 *
 * Anything that needs to branch does so off these keys, never off a rendered
 * string. The keys are stable and are not renamed to match documentation prose.
 */

export const TEACHING_STAFF = 'teaching_staff';
export const CLASS_TUTOR_L4 = 'class_tutor_l4';
export const HOD_L3 = 'hod_l3';
export const LEVEL_2 = 'level_2';
export const PRINCIPAL_L1 = 'principal_l1';

/**
 * The four institutional seats, in chain order — L1 → L2 → L3 → L4.
 *
 * Personal Staff is deliberately **not** in this list. A staff member holding a
 * designation that reads "Principal" or "Class Tutor" is still in the personal
 * Staff context until they enter the institutional seat itself, and a list that
 * mixed the two would make that distinction a matter of filtering rather than
 * of kind.
 */
export const INSTITUTIONAL_SEATS = [PRINCIPAL_L1, LEVEL_2, HOD_L3, CLASS_TUTOR_L4];

/** Every seat this app can render, personal Staff included. */
export const SEAT_KEYS = [TEACHING_STAFF, ...INSTITUTIONAL_SEATS];

export function isInstitutionalSeat(key) {
  return INSTITUTIONAL_SEATS.includes(key);
}

export function isClassTutor(key) {
  return key === CLASS_TUTOR_L4;
}

export function isHod(key) {
  return key === HOD_L3;
}

export function isLevel2(key) {
  return key === LEVEL_2;
}

export function isPrincipal(key) {
  return key === PRINCIPAL_L1;
}
