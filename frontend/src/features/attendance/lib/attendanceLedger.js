/**
 * Subject attendance ledger — the model behind Attendance history.
 *
 * A subject accumulates 60-90 taught hours in a semester, so a flat
 * one-row-per-hour list answers nothing a staff member actually asks. What
 * they ask is per *student*: how many hours have they attended, what is their
 * percentage, and exactly which dates were they absent. So the ledger
 * aggregates sessions into one row per student, and keeps each student's
 * absence dates available on demand rather than in the main table.
 *
 * **Completeness rule (hard):** only `status === 'submitted'` sessions count
 * toward total hours, present hours, absent hours, or percentage. Draft,
 * Locked-but-unsubmitted, and expired-unsubmitted records are deliberately
 * excluded from every number here — they are still *scheduled* hours, which
 * is why `totalScheduledHours` is reported separately (the `72 / 90 hrs`
 * reading) but never used as a percentage denominator.
 *
 * One session is one teaching hour, matching how periods are counted
 * everywhere else in the app.
 */
import { REPORT_SESSIONS } from '@/lib/reportsData';
import { inDateRange } from '@/lib/dateFilters';

/** Below this, a student is flagged as at risk. */
export const ATTENDANCE_THRESHOLD = 75;

/** One entry per recurring subject+class the staff member teaches. */
export const LEDGER_SUBJECTS = (() => {
  const bySubject = new Map();

  for (const session of REPORT_SESSIONS) {
    if (!bySubject.has(session.subjectKey)) {
      bySubject.set(session.subjectKey, {
        key: session.subjectKey,
        subject: session.subject,
        classCode: session.classCode,
        programme: session.programme,
        section: session.section,
        batch: session.batch,
        semester: session.semester,
        academicYear: session.academicYear,
        ownership: session.ownership,
        substituteFor: session.substituteFor,
        roster: session.roster,
        scheduledHours: 0,
        submittedHours: 0,
        latest: 0,
      });
    }
    const entry = bySubject.get(session.subjectKey);
    entry.scheduledHours += 1;
    if (session.status === 'submitted') entry.submittedHours += 1;
    entry.latest = Math.max(entry.latest, session.startTime.getTime());
  }

  // Most recently taught subject first — that is the one a staff member is most likely to want.
  return [...bySubject.values()].sort((a, b) => b.latest - a.latest);
})();

export const LEDGER_SUBJECT_BY_KEY = Object.fromEntries(LEDGER_SUBJECTS.map((s) => [s.key, s]));

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Build the per-student ledger for one subject over an optional IST date
 * range. Returns both the submitted-only numbers every calculation uses and
 * the scheduled-hours context needed for the `submitted / scheduled` reading.
 */
export function buildSubjectLedger(subjectKey, { now, datePreset, customFrom, customTo } = {}) {
  const subject = LEDGER_SUBJECT_BY_KEY[subjectKey];
  if (!subject) return null;

  const inScope = REPORT_SESSIONS.filter(
    (s) =>
      s.subjectKey === subjectKey &&
      (!datePreset || inDateRange(s.date, now ?? new Date(), datePreset, customFrom, customTo)),
  );

  // The one place the completeness rule is applied — everything below derives from `submitted`.
  const submitted = inScope.filter((s) => s.status === 'submitted').sort((a, b) => b.startTime - a.startTime);
  const submittedHours = submitted.length;

  const students = subject.roster.map((student) => {
    const absences = submitted.filter((s) => !s.presentIds.has(student.id));
    const absentHours = absences.length;
    const presentHours = submittedHours - absentHours;
    return {
      id: student.id,
      name: student.name,
      roll: student.roll,
      registerNumber: student.registerNumber,
      presentHours,
      absentHours,
      submittedHours,
      percentage: submittedHours > 0 ? round1((presentHours / submittedHours) * 100) : 0,
      // Newest first — the most recent absence is the one being asked about.
      absences: absences.map((s) => ({
        id: s.id,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        topicTaught: s.topicTaught,
      })),
    };
  });

  const classAverage = students.length
    ? round1(students.reduce((sum, s) => sum + s.percentage, 0) / students.length)
    : 0;

  return {
    subject,
    students,
    submittedHours,
    scheduledHours: inScope.length,
    unsubmittedHours: inScope.length - submittedHours,
    classAverage,
    belowThreshold: students.filter((s) => s.percentage < ATTENDANCE_THRESHOLD).length,
  };
}
