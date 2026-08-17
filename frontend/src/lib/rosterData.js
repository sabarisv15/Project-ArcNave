/**
 * Every student in the institution, in one identity space.
 *
 * **One student record, read by three seats.** L4 renders its own class's
 * roster, L3 renders its department's, L1 aggregates all of them — and until
 * now each built its own. That meant the class shared between the Class Tutor
 * and Head of Department workspaces agreed on its identity and its size while
 * disagreeing about every student in it: `mc-0…mc-47` in one, `cls-…-s0…` in
 * the other. Two seats looking at one class and naming different students is
 * not a cosmetic defect, and no promotion, transfer or roster-placement rule
 * can be built on top of it. This module is the correction: every student is
 * generated once, here, and every seat reads the same record.
 *
 * **Enrolment is bounded by provisioned capacity.** A class's roster is a fact
 * about who is in it; its capacity is a fact Platform Admin provisioned. They
 * are separate fields and the roster never exceeds the capacity — which is what
 * makes headroom, and therefore admission and import, meaningful.
 *
 * **No first-year students exist**, because no first-year class does. This file
 * iterates `ACTIVE_CLASSES` and has no way to name a semester of its own.
 *
 * Local/mock only; in the real product this is the enrolment API. Keep shapes.
 *
 * Shapes
 *  Student { id, name, roll, reg, classId, departmentId, attendance,
 *            feeTier, feeReceipt, cgpa, backlogCount, hasPending,
 *            phone, guardianPhone, origin, documentsPending, flag }
 *  Flag    { kind, note, raisedAt, status } | null
 */

import { ACTIVE_CLASSES } from './academicCalendar';

const FIRST = ['Arjun', 'Priya', 'Rahul', 'Ananya', 'Vikram', 'Sneha', 'Karan', 'Divya', 'Rohan', 'Meera', 'Aditya', 'Kavya', 'Nikhil', 'Pooja', 'Sanjay', 'Isha', 'Varun', 'Neha', 'Aakash', 'Ritika', 'Manish', 'Swathi', 'Harsha', 'Deepika', 'Nithin', 'Anjali', 'Gokul', 'Shreya', 'Bharath', 'Lavanya'];
const LAST = ['Mehta', 'Nair', 'Sharma', 'Iyer', 'Reddy', 'Gupta', 'Rao', 'Kapoor', 'Verma', 'Menon', 'Pillai', 'Krishnan', 'Balan', 'Raghavan'];

export const ATTENDANCE_THRESHOLD = 75;

/** The same seeded generator the rest of the prototype's mock data uses. */
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * A stable seed for a class, derived from its id.
 *
 * Derived rather than listed, so adding a section or changing the band cannot
 * silently hand one class another's seed — and so a class's roster is the same
 * on every run regardless of the order the classes were built in.
 */
function seedOf(classId) {
  let h = 7;
  for (let i = 0; i < classId.length; i++) h = (h * 31 + classId.charCodeAt(i)) % 233280;
  return h || 2026;
}

/**
 * A class's attendance band.
 *
 * Three bands, and the difference between them is what makes every attention
 * signal in the app reachable *as a consequence of its own students* rather
 * than by assertion. `low` puts a majority under the threshold; `watch` sits
 * just above it so healthy departments do not all land on the same average to
 * the point, which is the tell of a fixture rather than a roster.
 *
 * Mechanical carries four low classes of six, so its department average falls
 * below the institution threshold on its own students' figures. Anything not
 * listed is healthy — a fixture where every class is in trouble says nothing.
 */
const CLASS_BANDS = {
  'dept-cse-s4a': 'low',
  'dept-cse-s6b': 'watch',
  'dept-mech-s4a': 'low',
  'dept-mech-s4b': 'low',
  'dept-mech-s6a': 'low',
  'dept-mech-s6b': 'low',
  'dept-mech-s8a': 'low',
  'dept-mech-s8b': 'watch',
  'dept-civil-s4a': 'watch',
  'dept-ece-s6b': 'watch',
  'dept-comm-s4b': 'watch',
};

/**
 * Enrolment that is pinned rather than derived.
 *
 * Only one class needs it. `dept-cse-s6a` is the class the Class Tutor seat
 * owns, and it is held at 48 against a provisioned capacity of 70 so the
 * admission and bulk-import flows built in Phase 1 have real headroom to work
 * in — a class sitting at capacity would make both unreachable, and a nearly
 * empty one would make the capacity meter meaningless. Every other class fills
 * to a seeded share of its own capacity.
 */
const PINNED_ENROLMENT = {
  'dept-cse-s6a': 48,
};

function enrolmentFor(cls, rnd) {
  const pinned = PINNED_ENROLMENT[cls.id];
  if (pinned != null) return Math.min(pinned, cls.capacity);
  // Between 78% and 94% of the provisioned capacity — full enough to be a real
  // class, never over it.
  return Math.round(cls.capacity * (0.78 + rnd() * 0.16));
}

function attendanceFor(band, rnd) {
  const draw = rnd();
  if (band === 'low') {
    return draw > 0.35 ? Math.round(58 + rnd() * 15) : Math.round(76 + rnd() * 14);
  }
  if (band === 'watch') {
    return draw > 0.5 ? Math.round(70 + rnd() * 9) : Math.round(80 + rnd() * 8);
  }
  return draw > 0.86 ? Math.round(60 + rnd() * 14) : Math.round(77 + rnd() * 21);
}

/**
 * A student's standing flag. Rare on purpose — a flag is an exception, and a
 * roster where everyone carries one says nothing at all.
 */
function buildFlag(rnd, attendance) {
  const roll = rnd();
  if (attendance < 65 && roll > 0.4) {
    return { kind: 'Attendance', note: 'Repeated absence without leave', raisedAt: '12 Aug 2026', status: 'active' };
  }
  if (roll > 0.94) {
    return { kind: 'Mentoring', note: 'Referred for academic mentoring', raisedAt: '04 Aug 2026', status: 'active' };
  }
  if (roll > 0.9) {
    return { kind: 'Attendance', note: 'Shortfall warning issued', raisedAt: '21 Jul 2026', status: 'cleared' };
  }
  return null;
}

/**
 * How each student arrived in their class.
 *
 * This matters to exactly one rule, and it is a rule the interface has to be
 * able to obey: **a promoted student is already placed and must never be
 * offered an onboarding action.** They arrived by a Head of Department
 * confirming a promotion, not by anyone admitting them, and asking a Class
 * Tutor to onboard them again would be asking for a duplicate record.
 *
 * Only the Class Tutor's own class carries a mix, because it is the only class
 * where the distinction is currently rendered. Everywhere else a roster is
 * historical: everyone in it was promoted into it.
 *
 * `documentsPending` is a separate fact, not a synonym for any origin. An
 * imported student has a record and no documents yet; an admitted one uploaded
 * theirs during the wizard. Both are active students either way — the pending
 * state is a follow-up, never a hold on enrolment.
 */
const ORIGIN_MIX = {
  'dept-cse-s6a': [
    { origin: 'admitted', count: 4, documentsPending: false },
    { origin: 'imported', count: 2, documentsPending: true },
    { origin: 'transferred', count: 1, documentsPending: false },
  ],
};

function originPlan(cls, size) {
  const plan = new Array(size).fill(null).map(() => ({ origin: 'promoted', documentsPending: false }));
  const mix = ORIGIN_MIX[cls.id];
  if (!mix) return plan;

  // Placed at the end of the roll, which is where a late arrival actually
  // lands: roll numbers are issued in order and a transfer-in does not
  // renumber the class.
  let cursor = size;
  [...mix].reverse().forEach((entry) => {
    for (let n = 0; n < entry.count && cursor > 0; n++) {
      cursor -= 1;
      plan[cursor] = { origin: entry.origin, documentsPending: entry.documentsPending };
    }
  });
  return plan;
}

function buildRoster(cls) {
  const rnd = seeded(seedOf(cls.id));
  const size = enrolmentFor(cls, rnd);
  const band = CLASS_BANDS[cls.id] ?? 'healthy';
  const plan = originPlan(cls, size);
  const students = [];

  for (let i = 0; i < size; i++) {
    const name = `${FIRST[(i + cls.semester * 3) % FIRST.length]} ${LAST[Math.floor(rnd() * LAST.length)]}`;
    const attendance = attendanceFor(band, rnd);
    const feeRoll = rnd();
    const feeTier = feeRoll > 0.85 ? 'unpaid' : feeRoll > 0.73 ? 'pending' : 'paid';
    const backlogRoll = rnd();

    students.push({
      id: `${cls.id}-s${i}`,
      name,
      roll: String(i + 1).padStart(2, '0'),
      // The admission year follows the semester: a student in semester 6 of a
      // three-year programme was admitted two years ago.
      reg: `REG-${2026 - (cls.year - 1)}-${(1000 + i * 7 + seedOf(cls.id)) % 9999}`,
      classId: cls.id,
      departmentId: cls.departmentId,
      attendance,
      feeTier,
      // A paid status is only trustworthy when a receipt backs it — an unbacked
      // "paid" is a distinct state the finance screen has to show.
      feeReceipt: feeTier === 'paid' ? rnd() > 0.12 : false,
      cgpa: (6 + rnd() * 3.4).toFixed(1),
      backlogCount: backlogRoll > 0.9 ? 2 : backlogRoll > 0.75 ? 1 : 0,
      hasPending: rnd() > 0.94,
      // Built to always be a full 10 digits. A modulo that can land near zero
      // renders "+91 90", which reads as a broken field rather than a number.
      phone: `+91 ${9000000000 + ((i * 137931347) % 1000000000)}`,
      guardianPhone: `+91 ${8000000000 + ((i * 92341271) % 1000000000)}`,
      origin: plan[i].origin,
      documentsPending: plan[i].documentsPending,
      flag: buildFlag(rnd, attendance),
    });
  }

  return students;
}

/** Every student in every active class, in one array. */
export const ALL_STUDENTS = ACTIVE_CLASSES.flatMap(buildRoster);

export const STUDENT_BY_ID = Object.fromEntries(ALL_STUDENTS.map((s) => [s.id, s]));

const BY_CLASS = ALL_STUDENTS.reduce((acc, s) => {
  (acc[s.classId] ??= []).push(s);
  return acc;
}, {});

export function studentsOfClass(classId) {
  return BY_CLASS[classId] ?? [];
}

export function studentsOfDepartment(departmentId) {
  return ALL_STUDENTS.filter((s) => s.departmentId === departmentId);
}

export function mean(values) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** A class's roster count and average, read off the roster itself. */
export function rosterStatsOf(classId) {
  const roster = studentsOfClass(classId);
  return { studentCount: roster.length, attendance: mean(roster.map((s) => s.attendance)) };
}
