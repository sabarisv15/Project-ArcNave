import { describe, expect, it } from 'vitest';
import {
  ACADEMIC_YEAR,
  ACTIVE_BAND,
  ACTIVE_CLASSES,
  ACTIVE_CLASS_TOTAL,
  BAND_SEMESTERS,
  activeClassesFor,
  activeClassesOf,
  activeClassesOfDepartment,
  activeSemestersFor,
  bandLabel,
  yearOfSemester,
} from '../lib/academicCalendar';
import { PROVISIONED_DEPARTMENTS, PROVISIONING_WITHOUT_LEVEL_2 } from '../lib/provisioning';
import { ALL_STUDENTS } from '../lib/rosterData';
import { DEPT_CLASSES } from '../lib/departmentData';
import { INST_CLASSES } from '../lib/institutionData';
import { OWNED_CLASS } from '../lib/classTutorData';

describe('Academic calendar — ArcNave starts at semester 3', () => {
  it('has no band containing semester 1 or 2', () => {
    Object.values(BAND_SEMESTERS).forEach((semesters) => {
      semesters.forEach((s) => expect(s).toBeGreaterThanOrEqual(3));
    });
    expect(BAND_SEMESTERS.odd).toEqual([3, 5, 7]);
    expect(BAND_SEMESTERS.even).toEqual([4, 6, 8]);
  });

  /**
   * The load-bearing assertion of the whole correction, and deliberately made
   * against every institutional fixture at once rather than screen by screen.
   * A first-year class cannot come back by being typed into one file, because
   * no file names a class at all.
   */
  it('produces no first-year class, roster or seat anywhere in the institution', () => {
    const everyClass = [...ACTIVE_CLASSES, ...INST_CLASSES, ...DEPT_CLASSES, OWNED_CLASS];
    everyClass.forEach((c) => {
      expect(c.semester).toBeGreaterThanOrEqual(3);
      expect(c.year).toBeGreaterThanOrEqual(2);
    });

    const classIds = new Set(ACTIVE_CLASSES.map((c) => c.id));
    ALL_STUDENTS.forEach((s) => expect(classIds.has(s.classId)).toBe(true));
  });

  it('runs exactly one band at a time', () => {
    const semesters = new Set(ACTIVE_CLASSES.map((c) => c.semester));
    const inBand = BAND_SEMESTERS[ACTIVE_BAND];
    [...semesters].forEach((s) => expect(inBand).toContain(s));
    expect(ACADEMIC_YEAR.band).toBe(ACTIVE_BAND);
  });

  it('maps a semester to its year without arithmetic anyone has to redo', () => {
    expect(yearOfSemester(3)).toBe(2);
    expect(yearOfSemester(4)).toBe(2);
    expect(yearOfSemester(7)).toBe(4);
    expect(yearOfSemester(8)).toBe(4);
  });
});

describe('Academic calendar — active classes are derived, never listed', () => {
  it('caps the band by each department’s course duration', () => {
    PROVISIONED_DEPARTMENTS.forEach((d) => {
      const semesters = activeSemestersFor(d);
      semesters.forEach((s) => expect(s).toBeLessThanOrEqual(d.durationYears * 2));
      expect(semesters).toEqual(BAND_SEMESTERS[ACTIVE_BAND].filter((s) => s <= d.durationYears * 2));
    });

    // A three-year programme in an even term runs 4 and 6; a four-year one
    // also runs 8.
    expect(activeSemestersFor(PROVISIONED_DEPARTMENTS.find((d) => d.id === 'dept-cse'))).toEqual([4, 6]);
    expect(activeSemestersFor(PROVISIONED_DEPARTMENTS.find((d) => d.id === 'dept-mech'))).toEqual([4, 6, 8]);
  });

  it('is the cross product of the active band with the provisioned sections', () => {
    PROVISIONED_DEPARTMENTS.forEach((d) => {
      const expected = activeSemestersFor(d).length * d.sections.length;
      expect(activeClassesOfDepartment(d.id)).toHaveLength(expected);
    });

    const total = PROVISIONED_DEPARTMENTS.reduce(
      (sum, d) => sum + activeSemestersFor(d).length * d.sections.length,
      0
    );
    // Computed from provisioning, never compared to a number anyone typed.
    expect(ACTIVE_CLASS_TOTAL).toBe(total);
  });

  it('carries the provisioned capacity of its own section onto every class', () => {
    ACTIVE_CLASSES.forEach((c) => {
      const dept = PROVISIONED_DEPARTMENTS.find((d) => d.id === c.departmentId);
      const section = dept.sections.find((s) => s.section === c.section);
      expect(c.capacity).toBe(section.capacity);
    });
  });

  it('moves with the band rather than needing to be retyped', () => {
    const cse = PROVISIONED_DEPARTMENTS.find((d) => d.id === 'dept-cse');
    const odd = activeClassesFor(cse, 'odd');
    expect(odd.map((c) => c.semester).sort()).toEqual([3, 3, 5, 5]);
    odd.forEach((c) => expect(c.semester).toBeGreaterThanOrEqual(3));
    expect(bandLabel('odd')).toContain('3 · 5 · 7');
  });

  it('derives another institution’s classes from its own provisioning', () => {
    const other = activeClassesOf(PROVISIONING_WITHOUT_LEVEL_2, 'odd');
    // Three three-year departments: 3 and 5 are active, sections 2 + 1 + 1.
    expect(other).toHaveLength(2 * 2 + 2 * 1 + 2 * 1);
    other.forEach((c) => expect(c.semester).toBeGreaterThanOrEqual(3));
  });
});
