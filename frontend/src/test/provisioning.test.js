import { describe, expect, it } from 'vitest';
import {
  HAS_LEVEL_2,
  PROVISIONED_DEPARTMENTS,
  PROVISIONING,
  PROVISIONING_WITHOUT_LEVEL_2,
  sectionCapacity,
  sectionsOf,
} from '../lib/provisioning';
import { seatScopeNote, seatTitle } from '../lib/seatTitles';
import {
  CLASS_TUTOR_L4,
  HOD_L3,
  INSTITUTIONAL_SEATS,
  LEVEL_2,
  PRINCIPAL_L1,
  SEAT_KEYS,
  TEACHING_STAFF,
  isInstitutionalSeat,
} from '../lib/roles';

describe('Provisioning — the single read-only source', () => {
  it('carries every provisioned structural fact', () => {
    PROVISIONED_DEPARTMENTS.forEach((d) => {
      expect(typeof d.durationYears).toBe('number');
      expect(typeof d.intake).toBe('number');
      expect(d.sections.length).toBeGreaterThan(0);
      d.sections.forEach((s) => expect(typeof s.capacity).toBe('number'));
    });
  });

  it('provisions section capacities that add up to the approved intake', () => {
    PROVISIONED_DEPARTMENTS.forEach((d) => {
      const total = d.sections.reduce((sum, s) => sum + s.capacity, 0);
      expect(total).toBe(d.intake);
    });
  });

  it('provisions unequal sections, so nothing may assume an even split', () => {
    const unequal = PROVISIONED_DEPARTMENTS.filter(
      (d) => d.sections.length > 1 && new Set(d.sections.map((s) => s.capacity)).size > 1,
    );
    expect(unequal.length).toBeGreaterThan(0);

    // The worked example: an intake of 120 running a 70-seat section beside a
    // 50-seat one. A screen that hard-coded 60/60 would be wrong here.
    expect(sectionCapacity('dept-cse', 'A')).toBe(70);
    expect(sectionCapacity('dept-cse', 'B')).toBe(50);
  });

  it('provisions single-section departments, so nothing may assume two', () => {
    expect(sectionsOf('dept-civil')).toHaveLength(1);
  });

  it('records whether a Level 2 seat exists at all', () => {
    expect(HAS_LEVEL_2).toBe(true);
    expect(PROVISIONING_WITHOUT_LEVEL_2.hasLevel2).toBe(false);
  });
});

describe('Configured display titles', () => {
  it('renders the college’s own words, never a role key', () => {
    expect(seatTitle(PRINCIPAL_L1)).toBe('Principal');
    expect(seatTitle(LEVEL_2)).toBe('Dean — Academic Affairs');
    expect(seatTitle(HOD_L3)).toBe('Head of Department');
    expect(seatTitle(CLASS_TUTOR_L4)).toBe('Class Tutor');
  });

  it('resolves a different institution’s titles without any code changing', () => {
    expect(seatTitle(PRINCIPAL_L1, PROVISIONING_WITHOUT_LEVEL_2)).toBe('Director');
    expect(seatTitle(HOD_L3, PROVISIONING_WITHOUT_LEVEL_2)).toBe('Department Head');
    expect(seatTitle(CLASS_TUTOR_L4, PROVISIONING_WITHOUT_LEVEL_2)).toBe('Class Advisor');
  });

  it('never renders an L-number, in any institution', () => {
    [PROVISIONING, PROVISIONING_WITHOUT_LEVEL_2].forEach((p) => {
      SEAT_KEYS.forEach((key) => {
        expect(seatTitle(key, p)).not.toMatch(/\bL[1-4]\b/);
        expect(seatScopeNote(key)).not.toMatch(/\bL[1-4]\b/);
      });
    });
  });

  it('falls back to a generic title rather than rendering undefined', () => {
    // The L2 entry of an institution with no L2 seat is the real case.
    expect(seatTitle(LEVEL_2, PROVISIONING_WITHOUT_LEVEL_2)).toBe('Delegated Officer');
  });

  it('keeps titles out of the role registry entirely', () => {
    // The keys are stable internal vocabulary and carry no display string.
    expect(SEAT_KEYS).toEqual([TEACHING_STAFF, PRINCIPAL_L1, LEVEL_2, HOD_L3, CLASS_TUTOR_L4]);
    expect(INSTITUTIONAL_SEATS).not.toContain(TEACHING_STAFF);
    expect(isInstitutionalSeat(TEACHING_STAFF)).toBe(false);
    INSTITUTIONAL_SEATS.forEach((key) => expect(isInstitutionalSeat(key)).toBe(true));
  });
});
