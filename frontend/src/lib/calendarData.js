/**
 * Calendar — institutional activities plus the staff member's own date notes.
 *
 * Institutional events (academic dates, exams, holidays, department events,
 * meetings, official deadlines) are published by the institution and are
 * read-only to an ordinary staff member: this module exposes no create, edit
 * or delete path for them at all.
 *
 * Personal date notes are private to the signed-in staff member. They are
 * deliberately small — an optional title and a body — because this is a note
 * against a date, not a task manager: no assignees, no status, no reminders.
 *
 * Every date calculation goes through `ist.js` (Asia/Kolkata) and every
 * user-facing date renders DD/MM/YYYY, matching the rest of Curriculum.
 */

import { DAY_MS, istDayKey, istMidnight } from './ist';

export const EVENT_TYPES = {
  academic: { label: 'Academic', dot: 'rgb(var(--c-accent))' },
  exam: { label: 'Exam', dot: '#B4453C' },
  holiday: { label: 'Holiday', dot: '#1D7A52' },
  department: { label: 'Department', dot: '#7A5AA8' },
  meeting: { label: 'Meeting', dot: '#2F6FA8' },
  deadline: { label: 'Deadline', dot: '#B07A17' },
};

const today = istMidnight(new Date());
const shift = (days) => istDayKey(new Date(today.getTime() + days * DAY_MS));

const ev = (id, offset, title, type, scope, detail) => ({
  id,
  dateKey: shift(offset),
  title,
  type,
  scope,
  detail,
  source: 'institutional',
  publishedBy: 'Academic office',
});

/**
 * Seeded around today so the month view always has something to show. Real
 * data replaces this wholesale; the shape is what matters.
 */
export const INSTITUTIONAL_EVENTS = [
  ev('cal-01', -12, 'Odd semester classes begin', 'academic', 'All departments', 'Regular timetable in force from this date.'),
  ev('cal-02', -6, 'Department meeting — CSE', 'meeting', 'Computer Science', 'Agenda: internal assessment schedule, lab rota.'),
  ev('cal-03', -2, 'Independence Day', 'holiday', 'Institution', 'Institution closed. Flag hoisting at 08:00.'),
  ev('cal-04', 0, 'Internal Assessment II — day 1', 'exam', 'All departments', 'Forenoon session. Invigilation duty as circulated.'),
  ev('cal-05', 1, 'Internal Assessment II — day 2', 'exam', 'All departments', 'Forenoon session.'),
  ev('cal-06', 2, 'Internal Assessment II — day 3', 'exam', 'All departments', 'Afternoon session.'),
  ev('cal-07', 3, 'Mark entry deadline — Internal II', 'deadline', 'All staff', 'Marks must be published before 17:00.'),
  ev('cal-08', 5, 'Parent–teacher meeting', 'department', 'CSE, ECE', 'Class-wise slots shared by the class tutors.'),
  ev('cal-09', 8, 'Guest lecture — distributed systems', 'department', 'Computer Science', 'Seminar hall, 11:00 onwards.'),
  ev('cal-10', 11, 'Faculty meeting', 'meeting', 'All staff', 'Principal’s conference room, 15:30.'),
  ev('cal-11', 14, 'Semester fee deadline', 'deadline', 'All students', 'Late fee applies after this date.'),
  ev('cal-12', 18, 'NAAC documentation review', 'academic', 'Institution', 'Department files to be submitted to IQAC.'),
  ev('cal-13', 22, 'Placement drive — round one', 'department', 'Final year', 'Attendance for final-year students is compulsory.'),
  ev('cal-14', 26, 'Model exam timetable published', 'academic', 'All departments', 'Circulated by the academic office.'),
  ev('cal-15', 30, 'Onam holiday', 'holiday', 'Institution', 'Institution closed.'),
];

export function eventsByDay(events) {
  const map = new Map();
  events.forEach((e) => {
    const list = map.get(e.dateKey) ?? [];
    list.push(e);
    map.set(e.dateKey, list);
  });
  return map;
}

/**
 * The 6×7 grid a month view renders, Monday-first, in IST. Cells outside the
 * month are still real dates so clicking one is never a dead interaction.
 */
export function monthGrid(year, monthIndex) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const weekday = (first.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(first.getTime() - weekday * DAY_MS);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getTime() + i * DAY_MS);
    return {
      date,
      dateKey: istDayKey(date),
      inMonth: date.getUTCMonth() === monthIndex,
    };
  });
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A note counts as real once it has any content; an empty one is never stored. */
export function noteHasContent(note) {
  return !!note && (!!note.title?.trim() || !!note.body?.trim());
}

export function notePreview(note) {
  if (!note) return '';
  const text = note.title?.trim() || note.body?.trim() || '';
  return text.length > 64 ? `${text.slice(0, 63)}…` : text;
}
