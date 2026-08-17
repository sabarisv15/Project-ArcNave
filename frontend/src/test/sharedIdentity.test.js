import { describe, expect, it } from 'vitest';
import { ACTIVE_CLASSES } from '../lib/academicCalendar';
import { ALL_STUDENTS, studentsOfClass } from '../lib/rosterData';
import { CLASS_ROSTER, CLASS_HEADROOM, OWNED_CLASS, PROMOTED_STUDENTS } from '../lib/classTutorData';
import { DEPT_CLASSES, DEPT_STUDENTS, studentsOfClass as deptStudentsOfClass } from '../lib/departmentData';
import { INST_CLASSES, INST_STUDENTS, studentsOfClass as instStudentsOfClass } from '../lib/institutionData';

/**
 * The correction this file exists for: L4, L3 and L1 used to build their own
 * student populations, so the class the Class Tutor and Head of Department
 * workspaces share agreed on its identity and its size while naming completely
 * different students — `mc-0…mc-47` in one, `cls-…-s0…` in the other. No
 * promotion, transfer or roster-placement rule can be built on that.
 */
describe('One student identity space across every seat', () => {
  it('gives the shared class the same student records in L4, L3 and L1', () => {
    const ids = (list) => list.map((s) => s.id).sort();

    const l4 = ids(CLASS_ROSTER);
    const l3 = ids(deptStudentsOfClass(OWNED_CLASS.id));
    const l1 = ids(instStudentsOfClass(OWNED_CLASS.id));

    expect(l4.length).toBeGreaterThan(0);
    expect(l3).toEqual(l4);
    expect(l1).toEqual(l4);
  });

  it('has no `mc-` id space left anywhere', () => {
    ALL_STUDENTS.forEach((s) => expect(s.id.startsWith('mc-')).toBe(false));
  });

  it('reads the department and institution rosters out of the same records', () => {
    DEPT_STUDENTS.forEach((s) => expect(INST_STUDENTS).toContain(s));
    // Object identity, not a deep-equal copy: there is one record, not two that
    // happen to match today.
    const shared = CLASS_ROSTER[0];
    expect(deptStudentsOfClass(OWNED_CLASS.id)).toContain(shared);
    expect(instStudentsOfClass(OWNED_CLASS.id)).toContain(shared);
  });

  it('places every student in exactly one active class', () => {
    const classIds = new Set(ACTIVE_CLASSES.map((c) => c.id));
    ALL_STUDENTS.forEach((s) => {
      expect(classIds.has(s.classId)).toBe(true);
    });
    expect(new Set(ALL_STUDENTS.map((s) => s.id)).size).toBe(ALL_STUDENTS.length);
  });
});

describe('Enrolment is bounded by provisioned capacity', () => {
  it('never exceeds the capacity of its own section', () => {
    ACTIVE_CLASSES.forEach((c) => {
      expect(studentsOfClass(c.id).length).toBeLessThanOrEqual(c.capacity);
    });
  });

  it('carries capacity beside the roster count at every altitude', () => {
    DEPT_CLASSES.forEach((c) => expect(c.studentCount).toBeLessThanOrEqual(c.capacity));
    INST_CLASSES.forEach((c) => expect(c.studentCount).toBeLessThanOrEqual(c.capacity));
  });

  it('leaves the Class Tutor’s own class real headroom to admit into', () => {
    expect(OWNED_CLASS.capacity).toBe(70);
    expect(CLASS_HEADROOM).toBe(OWNED_CLASS.capacity - CLASS_ROSTER.length);
    expect(CLASS_HEADROOM).toBeGreaterThan(0);
  });
});

describe('How a student arrived is recorded, because one rule depends on it', () => {
  it('marks promoted students, who must never be offered an onboarding action', () => {
    expect(PROMOTED_STUDENTS.length).toBeGreaterThan(0);
    PROMOTED_STUDENTS.forEach((s) => expect(s.origin).toBe('promoted'));
  });

  it('keeps documents-pending a separate fact from how the student arrived', () => {
    const pending = CLASS_ROSTER.filter((s) => s.documentsPending);
    expect(pending.length).toBeGreaterThan(0);
    // Pending documents never gate enrolment: they are still in the roster.
    pending.forEach((s) => expect(CLASS_ROSTER).toContain(s));
    // And an origin that has documents pending is not the only origin present.
    expect(new Set(CLASS_ROSTER.map((s) => s.origin)).size).toBeGreaterThan(1);
  });
});
