import { describe, expect, it } from 'vitest';
import {
  canPublish, eligibleScopes, initialAssessments, isValidMark, marksProgress, scopeById, studentsForScope,
} from '../lib/assessmentsData';
import { ownedScopesForVersion, blocksForDay, ACTIVE_VERSION_ID } from '../lib/timetableData';

describe('assessment scope is timetable-derived', () => {
  it('offers only allocations the staff member owns', () => {
    const scopes = eligibleScopes();
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes).toEqual(ownedScopesForVersion(ACTIVE_VERSION_ID));
  });

  it('never offers a substitute-covered class', () => {
    const covered = new Set();
    for (const d of ['mon', 'tue', 'wed', 'thu', 'fri']) {
      for (const b of blocksForDay(d, ACTIVE_VERSION_ID)) {
        if (b.class.ownership === 'substitute') covered.add(b.class.subject);
      }
    }
    expect(covered.size).toBeGreaterThan(0);
    for (const s of eligibleScopes()) expect(covered.has(s.subject)).toBe(false);
  });

  it('rejects an unknown scope id', () => {
    expect(scopeById('not-a-real-scope')).toBeNull();
  });

  it('every seeded assessment sits inside an eligible scope', () => {
    const ids = new Set(eligibleScopes().map((s) => s.id));
    for (const a of initialAssessments()) expect(ids.has(a.scopeId)).toBe(true);
  });
});

describe('marks validation and publication', () => {
  const assessment = initialAssessments().find((a) => a.status === 'draft' && Object.keys(a.marks).length > 0);
  const students = studentsForScope(scopeById(assessment.scopeId));

  it('accepts 0..max, absent, and rejects out-of-range or non-numeric', () => {
    expect(isValidMark({ value: 0, absent: false }, 50)).toBe(true);
    expect(isValidMark({ value: 50, absent: false }, 50)).toBe(true);
    expect(isValidMark({ value: null, absent: true }, 50)).toBe(true);
    expect(isValidMark({ value: 51, absent: false }, 50)).toBe(false);
    expect(isValidMark({ value: -1, absent: false }, 50)).toBe(false);
    expect(isValidMark({ value: Number('abc'), absent: false }, 50)).toBe(false);
    expect(isValidMark(undefined, 50)).toBe(false);
  });

  it('refuses to publish while any student is unmarked', () => {
    const { entered, total } = marksProgress(assessment, students);
    expect(entered).toBeLessThan(total);
    expect(canPublish(assessment, students)).toBe(false);
  });

  it('allows publish once every student has a valid entry', () => {
    const full = { ...assessment, marks: Object.fromEntries(students.map((s) => [s.id, { value: 10, absent: false }])) };
    expect(canPublish(full, students)).toBe(true);
  });

  it('counts an absent student as entered', () => {
    const one = { ...assessment, marks: { [students[0].id]: { value: null, absent: true } } };
    expect(marksProgress(one, students).entered).toBe(1);
  });
});
