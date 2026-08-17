/**
 * What Platform Admin provisioned, and this app only ever reads.
 *
 * **This is the sole source for provisioned structure.** Institution identity,
 * configured role display titles, whether a Level 2 seat exists, and every
 * department's course duration, approved intake, sections and per-section
 * capacity all live here and nowhere else. No institutional screen, fixture or
 * derivation may restate any of them, and nothing in this app writes to them.
 *
 * Platform Admin itself is built **outside this D-drive visual prototype** and
 * is out of scope for this workspace — this module is the boundary where its
 * output arrives, not a stand-in for its screens. Nothing here is a Principal
 * task: an L1 seat reads readiness and operational health against these facts,
 * it does not create or edit them in this pass.
 *
 * Two rules this module exists to hold:
 *
 *  1. **Section capacities are provisioned facts and may be unequal.** A
 *     department with an approved intake of 120 may run a 70-seat section
 *     beside a 50-seat one, and no screen may assume an even split. The
 *     capacities below are deliberately unequal in three departments so that
 *     assumption cannot survive anywhere.
 *  2. **A display title is configuration, never a role key.** `ROLE_TITLES`
 *     maps a stable internal key to what this college calls that seat. Code
 *     branches on the key; the interface renders the title. The two are never
 *     the same string by coincidence — L2 here is "Dean — Academic Affairs",
 *     which no key resembles.
 *
 * Local/mock only. In the real product this arrives from the provisioning API
 * with the resolved session; keep these shapes.
 *
 * Shapes
 *  Provisioning { institution, hasLevel2, roleTitles, level2Scope, departments }
 *  Institution  { id, name }
 *  Level2Scope  { areas: string[], note }
 *  Department   { id, name, short, programmeLabel, programmeShort,
 *                 durationYears, intake, sections: Section[] }
 *  Section      { section, capacity }
 */

import {
  CLASS_TUTOR_L4,
  HOD_L3,
  LEVEL_2,
  PRINCIPAL_L1,
  TEACHING_STAFF,
} from './roles';

/**
 * Institution A — the live fixture the browser renders.
 *
 * Level 2 is provisioned here, so the delegated seat exists, appears in the
 * workflow chain, and can be reviewed. Its title is a configured string, not a
 * product concept: another college could call the same seat "Vice Principal"
 * and nothing in the code would change.
 */
export const PROVISIONING = {
  institution: { id: 'inst-svc', name: 'Sri Venkateswara College' },
  hasLevel2: true,
  roleTitles: {
    [PRINCIPAL_L1]: 'Principal',
    [LEVEL_2]: 'Dean — Academic Affairs',
    [HOD_L3]: 'Head of Department',
    [CLASS_TUTOR_L4]: 'Class Tutor',
    [TEACHING_STAFF]: 'Teaching Staff',
  },
  /**
   * What the delegated seat was provisioned to cover.
   *
   * Configuration, exactly like the title beside it: another college could
   * delegate an entirely different set of areas to the same seat, and no code
   * would change. It is here rather than in an L2 module because **there is no
   * L2 module** — the delegated workspace is a later phase, and this pass shows
   * only what an institution head can already read about a seat that exists.
   *
   * `PROVISIONING_WITHOUT_LEVEL_2` deliberately omits the key entirely rather
   * than carrying an empty one: an institution with no delegated seat has no
   * delegated scope, and a `[]` would invite a screen to render an empty card
   * for something that was never provisioned.
   */
  level2Scope: {
    areas: ['Academic operations', 'Timetable review', 'Examination calendar'],
    note: 'Reviews department timetable endorsements before they reach the institution head',
    /*
     * The departments this seat was delegated. **Three of six**, deliberately:
     * a delegated scope that happened to be every department would let a screen
     * pass its scope test by ignoring scope entirely.
     */
    departmentIds: ['dept-cse', 'dept-ece', 'dept-mech'],
    /*
     * The work this seat was configured to carry, as destinations. Two of them,
     * because this college configured two — not because two is what a delegated
     * seat has. Another college could configure none, or five, and the
     * navigation is built from whatever is here.
     */
    workAreas: [
      {
        id: 'exam-calendar',
        label: 'Examination calendar',
        note: 'Maintains the internal assessment and examination dates across the delegated departments.',
      },
      {
        id: 'academic-ops',
        label: 'Academic operations review',
        note: 'Weekly reading of coverage, timetable readiness and seat gaps in the delegated departments.',
      },
    ],
    /* Configured responsibilities, rendered as rows. Descriptive, not granted. */
    responsibilities: [
      {
        id: 'timetable-review',
        label: 'Timetable review',
        detail: 'Reviews an endorsed revision and routes it onward. The final approval stays with the institution head.',
      },
      {
        id: 'monitoring',
        label: 'Department monitoring',
        detail: 'Reads coverage and readiness across the delegated departments.',
      },
    ],
    /*
     * Where this seat sits in a workflow chain. `timetableReview: false` would
     * be an equally ordinary configuration — a delegated seat that monitors and
     * decides nothing — and the chain builder reads this rather than assuming.
     */
    workflow: { timetableReview: true },
  },
  /*
   * Who holds the delegated seat. Provisioned occupancy, kept beside the scope
   * because the two are different questions: an institution can have a
   * configured delegated seat that nobody is sitting in, and that is not the
   * same state as having no such seat at all.
   */
  level2Occupancy: {
    state: 'active',
    holderName: 'Dr. Lakshmi Narayanan',
    holderDesignation: 'Dean — Academic Affairs',
    since: '02 Jul 2026',
  },
  departments: [
    {
      id: 'dept-cse',
      name: 'Computer Science',
      short: 'CSE',
      programmeLabel: 'B.Sc Computer Science',
      programmeShort: 'B.Sc CS',
      durationYears: 3,
      intake: 120,
      // Deliberately unequal: 70 and 50, not 60 and 60.
      sections: [
        { section: 'A', capacity: 70 },
        { section: 'B', capacity: 50 },
      ],
    },
    {
      id: 'dept-mech',
      name: 'Mechanical Engineering',
      short: 'MECH',
      programmeLabel: 'B.E Mechanical',
      programmeShort: 'B.E Mech',
      durationYears: 4,
      intake: 120,
      sections: [
        { section: 'A', capacity: 60 },
        { section: 'B', capacity: 60 },
      ],
    },
    {
      id: 'dept-civil',
      name: 'Civil Engineering',
      short: 'CIVIL',
      programmeLabel: 'B.E Civil',
      programmeShort: 'B.E Civil',
      durationYears: 4,
      intake: 60,
      // A single-section department. Nothing may assume two.
      sections: [{ section: 'A', capacity: 60 }],
    },
    {
      id: 'dept-ece',
      name: 'Electronics and Communication',
      short: 'ECE',
      programmeLabel: 'B.E Electronics',
      programmeShort: 'B.E ECE',
      durationYears: 4,
      intake: 100,
      sections: [
        { section: 'A', capacity: 55 },
        { section: 'B', capacity: 45 },
      ],
    },
    {
      id: 'dept-comm',
      name: 'Commerce',
      short: 'COM',
      programmeLabel: 'B.Com',
      programmeShort: 'B.Com',
      durationYears: 3,
      intake: 180,
      sections: [
        { section: 'A', capacity: 95 },
        { section: 'B', capacity: 85 },
      ],
    },
    {
      id: 'dept-maths',
      name: 'Mathematics',
      short: 'MATHS',
      programmeLabel: 'B.Sc Mathematics',
      programmeShort: 'B.Sc Maths',
      durationYears: 3,
      intake: 60,
      sections: [{ section: 'A', capacity: 60 }],
    },
  ],
};

/**
 * Institution B — provisioned **without** a Level 2 seat.
 *
 * A test-only fixture, deliberately not reachable from the interface: there is
 * no institution switcher and adding one would be a new affordance rather than
 * a design. It exists so "L2 is optional" can be proved rather than asserted —
 * every L1/L3/L4 route, navigation item, invite path and workflow visual must
 * render here exactly as it does in Institution A, minus the L2 step.
 *
 * Its titles differ from A's on purpose. A test that passed only because both
 * fixtures said "Principal" would not be testing the title resolver at all.
 */
export const PROVISIONING_WITHOUT_LEVEL_2 = {
  institution: { id: 'inst-kmc', name: 'Kamaraj Memorial College' },
  hasLevel2: false,
  roleTitles: {
    [PRINCIPAL_L1]: 'Director',
    [HOD_L3]: 'Department Head',
    [CLASS_TUTOR_L4]: 'Class Advisor',
    [TEACHING_STAFF]: 'Teaching Staff',
  },
  departments: [
    {
      id: 'kmc-dept-cs',
      name: 'Computer Applications',
      short: 'BCA',
      programmeLabel: 'BCA',
      programmeShort: 'BCA',
      durationYears: 3,
      intake: 90,
      sections: [
        { section: 'A', capacity: 50 },
        { section: 'B', capacity: 40 },
      ],
    },
    {
      id: 'kmc-dept-com',
      name: 'Commerce',
      short: 'COM',
      programmeLabel: 'B.Com',
      programmeShort: 'B.Com',
      durationYears: 3,
      intake: 60,
      sections: [{ section: 'A', capacity: 60 }],
    },
    {
      id: 'kmc-dept-eng',
      name: 'English',
      short: 'ENG',
      programmeLabel: 'B.A English',
      programmeShort: 'B.A Eng',
      durationYears: 3,
      intake: 45,
      sections: [{ section: 'A', capacity: 45 }],
    },
  ],
};

/**
 * Institution C — provisioned **with** a Level 2 seat that nobody holds.
 *
 * A test-only fixture, and the third of three states this app has to keep
 * apart. It is deliberately not the same as Institution B: the structure exists
 * here, the configured chain still routes through the seat, and the institution
 * head can still read it — what is missing is an occupant. A timetable routed
 * through this seat stays visibly with it rather than quietly reaching the
 * institution head, because skipping a configured step is what an empty chair
 * must never cause.
 *
 * There is no interface path to it. Adding one would be a visible institution
 * switcher, which is a new affordance rather than a design.
 */
export const PROVISIONING_WITH_VACANT_LEVEL_2 = {
  ...PROVISIONING,
  institution: { id: 'inst-tnc', name: 'Thiruvalluvar National College' },
  level2Occupancy: { state: 'vacant' },
};

export const INSTITUTION_IDENTITY = PROVISIONING.institution;

export const PROVISIONED_DEPARTMENTS = PROVISIONING.departments;

export const DEPARTMENT_BY_ID = Object.fromEntries(
  PROVISIONED_DEPARTMENTS.map((d) => [d.id, d])
);

export function provisionedDepartment(departmentId) {
  return DEPARTMENT_BY_ID[departmentId] ?? null;
}

/** The provisioned capacity of one section, or null if it was never provisioned. */
export function sectionCapacity(departmentId, section) {
  const dept = DEPARTMENT_BY_ID[departmentId];
  return dept?.sections.find((s) => s.section === section)?.capacity ?? null;
}

/** The sections a department actually runs — never assumed to be A and B. */
export function sectionsOf(departmentId) {
  return DEPARTMENT_BY_ID[departmentId]?.sections ?? [];
}

/**
 * Whether this institution has a Level 2 seat at all.
 *
 * Every L2 route, navigation item, switcher entry and workflow step is
 * registered through this, so an institution provisioned without one has no L2
 * surface to reach rather than a hidden one.
 */
export const HAS_LEVEL_2 = PROVISIONING.hasLevel2;

/**
 * The delegated seat's configured scope, or `null` when no such seat exists.
 *
 * Returns `null` rather than an empty object for an institution provisioned
 * without a Level 2 seat, so a screen's only correct rendering of that case is
 * to render nothing at all.
 */
export function level2Scope(provisioning = PROVISIONING) {
  if (!provisioning?.hasLevel2) return null;
  return provisioning.level2Scope ?? { areas: [], note: '' };
}

/**
 * Whether the delegated seat is a step in the timetable approval chain.
 *
 * Configuration, not structure: an institution can provision a delegated seat
 * that monitors and carries work areas without sitting in any approval chain,
 * and the chain builder reads this rather than inferring the step from the
 * seat's existence. Absence of the flag on a provisioned scope means yes, which
 * keeps the live fixture's chain unchanged from before this flag existed.
 *
 * **It does not read occupancy.** A configured step with nobody in the chair is
 * still a step — that is the difference between a seat that was never
 * provisioned and one that is momentarily empty.
 */
export function level2InTimetableChain(provisioning = PROVISIONING) {
  const scope = level2Scope(provisioning);
  if (!scope) return false;
  return scope.workflow?.timetableReview !== false;
}
