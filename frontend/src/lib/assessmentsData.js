/**
 * Staff assessments — created only inside the staff member's own
 * timetable-derived teaching scope.
 *
 * The scope list is `ownedScopesForVersion()` from `timetableData.js`, so a
 * subject/class the staff member does not teach is not merely rejected, it is
 * never offered: there is no free-text class or subject field anywhere in this
 * module. Substitute-covered allocations are excluded from that list on
 * purpose — covering one period of someone else's class grants marking rights
 * for that period, not standing authority to assess the class.
 *
 * This is not an institution-wide exam administration tool. It has no concept
 * of exam sessions, hall allocation, or other staff's assessments.
 *
 * Shapes
 *  Assessment { id, name, type, scopeId, subject, code, programme, section,
 *               date: Date, maxMarks, instructions,
 *               status: 'draft' | 'published',
 *               marks: { [studentId]: { value: number|null, absent: boolean } },
 *               timetableVersionId, timetableScopeRef,
 *               createdBy, createdAt, publishedBy, publishedAt }
 *
 * Audit fields are populated on every state change and never cleared — a
 * published assessment keeps who created it as well as who published it.
 */

import { ACTIVE_VERSION_ID, ownedScopesForVersion, scopeLabel } from './timetableData';
import { buildRoster } from './attendanceData';
import { istMidnight, DAY_MS } from './ist';

export const ME = { id: 'staff-me', name: 'Priya Ramesh' };

export const ASSESSMENT_TYPES = [
  { value: 'internal', label: 'Internal exam' },
  { value: 'model', label: 'Model exam' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'practical', label: 'Practical assessment' },
  { value: 'other', label: 'Other' },
];

export const TYPE_LABELS = Object.fromEntries(ASSESSMENT_TYPES.map((t) => [t.value, t.label]));

/** The only scopes a staff member may assess — their own allocations in the active approved timetable. */
export function eligibleScopes(versionId = ACTIVE_VERSION_ID) {
  return ownedScopesForVersion(versionId);
}

export function scopeById(scopeId, versionId = ACTIVE_VERSION_ID) {
  return eligibleScopes(versionId).find((s) => s.id === scopeId) ?? null;
}

export { scopeLabel };

/**
 * The enrolled students for a scope. Rosters come from the same seeded
 * generator the attendance module uses, keyed by the timetable's class key, so
 * the same class shows the same students in attendance and in assessments.
 */
function rosterSeedFor(classKey) {
  let h = 0;
  for (let i = 0; i < classKey.length; i++) h = (h * 31 + classKey.charCodeAt(i)) % 9973;
  return 100 + h;
}

export function studentsForScope(scope) {
  if (!scope) return [];
  const seed = rosterSeedFor(scope.classKey);
  return buildRoster(seed, 32 + (seed % 18));
}

function daysAgo(n) {
  return new Date(istMidnight(new Date()).getTime() - n * DAY_MS);
}

/** Seeded marks so a demo assessment has believable, partially-entered data. */
function seedMarks(students, maxMarks, { entered, absentIndexes = [] }) {
  const marks = {};
  students.slice(0, entered).forEach((s, i) => {
    if (absentIndexes.includes(i)) {
      marks[s.id] = { value: null, absent: true };
      return;
    }
    const spread = (i * 37) % 100;
    const value = Math.max(0, Math.min(maxMarks, Math.round(maxMarks * (0.42 + (spread / 100) * 0.56))));
    marks[s.id] = { value, absent: false };
  });
  return marks;
}

function makeAssessment({ id, name, type, scope, date, maxMarks, status, entered, absentIndexes, instructions = '' }) {
  const students = studentsForScope(scope);
  return {
    id,
    name,
    type,
    scopeId: scope.id,
    classKey: scope.classKey,
    subject: scope.subject,
    code: scope.code,
    programme: scope.programme,
    section: scope.section,
    date,
    maxMarks,
    instructions,
    status,
    marks: seedMarks(students, maxMarks, { entered, absentIndexes }),
    // The exact approved allocation that authorised this assessment.
    timetableVersionId: scope.versionId,
    timetableScopeRef: scope.id,
    createdBy: ME.name,
    createdAt: new Date(date.getTime() - 3 * DAY_MS),
    publishedBy: status === 'published' ? ME.name : null,
    publishedAt: status === 'published' ? new Date(date.getTime() + DAY_MS) : null,
  };
}

/** Mock seed — replace with the real assessments API, keeping the shapes. */
export function initialAssessments(versionId = ACTIVE_VERSION_ID) {
  const scopes = eligibleScopes(versionId);
  if (scopes.length === 0) return [];

  const pick = (subject) => scopes.find((s) => s.subject === subject) ?? scopes[0];

  const seeds = [
    { id: 'as-1', name: 'Internal Test 1', type: 'internal', scope: pick('Data Structures'), date: daysAgo(9), maxMarks: 50, status: 'published', entered: Infinity, absentIndexes: [4] },
    { id: 'as-2', name: 'Unit 3 Quiz', type: 'quiz', scope: pick('Operating Systems'), date: daysAgo(4), maxMarks: 20, status: 'published', entered: Infinity, absentIndexes: [] },
    { id: 'as-3', name: 'Model Exam', type: 'model', scope: pick('Database Systems'), date: daysAgo(1), maxMarks: 100, status: 'draft', entered: 18, absentIndexes: [2] },
    { id: 'as-4', name: 'Record Assignment 2', type: 'assignment', scope: pick('Computer Networks'), date: daysAgo(6), maxMarks: 25, status: 'draft', entered: 0, absentIndexes: [] },
    { id: 'as-5', name: 'Lab Practical 1', type: 'practical', scope: pick('Networks Lab'), date: daysAgo(12), maxMarks: 40, status: 'published', entered: Infinity, absentIndexes: [7] },
  ];

  return seeds
    .filter((s) => s.scope)
    .map((s) => makeAssessment({ ...s, entered: s.entered === Infinity ? studentsForScope(s.scope).length : s.entered }));
}

/** `38 / 45 entered` — an absent student counts as entered; a blank does not. */
export function marksProgress(assessment, students) {
  const total = students.length;
  const entered = students.reduce((n, s) => {
    const m = assessment.marks[s.id];
    return n + (m && (m.absent || typeof m.value === 'number') ? 1 : 0);
  }, 0);
  return { entered, total, complete: entered === total && total > 0 };
}

/** A mark is valid when it is absent, or a number within 0…maxMarks. */
export function isValidMark(entry, maxMarks) {
  if (!entry) return false;
  if (entry.absent) return true;
  return typeof entry.value === 'number' && Number.isFinite(entry.value) && entry.value >= 0 && entry.value <= maxMarks;
}

/** Publish is refused unless every enrolled student has a valid entry. */
export function canPublish(assessment, students) {
  if (assessment.status === 'published') return false;
  if (students.length === 0) return false;
  return students.every((s) => isValidMark(assessment.marks[s.id], assessment.maxMarks));
}

export function percentageFor(entry, maxMarks) {
  if (!entry || entry.absent || typeof entry.value !== 'number' || maxMarks <= 0) return null;
  return Math.round((entry.value / maxMarks) * 1000) / 10;
}

export const ASSESSMENT_SORTS = [
  { key: 'recent', label: 'Most recent first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'subject', label: 'Subject A–Z' },
];
