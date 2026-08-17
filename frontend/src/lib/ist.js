/**
 * Asia/Kolkata (IST, UTC+5:30, no DST) is the one timezone every
 * attendance/class-log/report date, time, timer, sort order, and deadline
 * uses — never the browser's local timezone. A `Date` is always an absolute
 * instant; only *display* and *calendar-day bucketing* are timezone-specific,
 * so every function here either formats an instant as IST wall-clock text or
 * converts IST wall-clock components to/from an instant.
 *
 * Technique: because IST has a fixed offset, shifting an instant by +5:30 and
 * then reading it with the UTC getters yields the IST wall-clock fields —
 * this avoids `Intl` formatting overhead in hot paths (timers, sort compares).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function shiftToIST(date) {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

/** `{ year, month (0-11), day, hour, minute, weekday (0=Sun) }` — the IST wall-clock reading of an instant. */
export function getISTParts(date) {
  const d = shiftToIST(date);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

/** The instant that is 00:00 IST on the same IST calendar day as `date`. */
export function istMidnight(date) {
  const { year, month, day } = getISTParts(date);
  return new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` in IST — the one key every same-day / date-range comparison should bucket on. */
export function istDayKey(date) {
  const { year, month, day } = getISTParts(date);
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function istWeekday(date) {
  return getISTParts(date).weekday;
}

/** IST midnight of the Sunday starting the week containing `date`. */
export function startOfWeekIST(date) {
  const mid = istMidnight(date);
  return new Date(mid.getTime() - istWeekday(date) * DAY_MS);
}

/** `{ start, end }` instants spanning an IST calendar day from a `YYYY-MM-DD` string — for date-range filters. */
export function parseISTDateBounds(str) {
  const [y, m, d] = str.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS - 1) };
}

/** `09:00` — 24-hour IST clock. */
export function formatTimeIST(date) {
  const { hour, minute } = getISTParts(date);
  return `${pad(hour)}:${pad(minute)}`;
}

/** `9:00 AM` — 12-hour IST clock, used only where AM/PM reads more naturally (e.g. the 4:00 PM submission deadline). */
export function formatTime12IST(date) {
  const { hour, minute } = getISTParts(date);
  let h = hour % 12;
  if (h === 0) h = 12;
  return `${h}:${pad(minute)} ${hour >= 12 ? 'PM' : 'AM'}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `15/08/2026` — the one raw date format every Curriculum surface renders
 * (schedule, attendance, class logs, reports, timetable, workload,
 * assessments) and the format CSV/PDF exports carry. Machine-readable keys
 * stay ISO via `istDayKey`; this is display only.
 */
export function formatDateDMY(date) {
  const { day, month, year } = getISTParts(date);
  return `${pad(day)}/${pad(month + 1)}/${year}`;
}

/** `13 Aug 2026` — retained for the few places a spelled month genuinely reads better. */
export function formatShortDateIST(date) {
  const { day, month, year } = getISTParts(date);
  return `${day} ${MONTHS[month]} ${year}`;
}

/** `Thu, 13 Aug 2026`. */
export function formatFullDateIST(date) {
  const { day, month, year, weekday } = getISTParts(date);
  return `${WEEKDAYS[weekday]}, ${day} ${MONTHS[month]} ${year}`;
}

/** `Thu, 13 Aug` — the compact date a drawer's context header uses, where the year is noise. */
export function formatDayMonIST(date) {
  const { day, month, weekday } = getISTParts(date);
  return `${WEEKDAYS[weekday]}, ${day} ${MONTHS[month]}`;
}

/**
 * `09:00` → `9:00 AM`. Recurring weekly patterns (the timetable) store IST
 * wall-clock strings rather than instants, so they need their own 12-hour
 * formatter — same output shape as `formatTime12IST`.
 */
export function formatClock12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}

/**
 * "Today" / "Yesterday" / `15/08/2026` — a relative label only where it is
 * genuinely more useful than the date, and the compact DD/MM/YYYY date
 * everywhere else. Never a long spelled-out English date.
 */
export function formatDateLabelIST(date, now) {
  const key = istDayKey(date);
  if (key === istDayKey(now)) return 'Today';
  if (key === istDayKey(new Date(now.getTime() - DAY_MS))) return 'Yesterday';
  return formatDateDMY(date);
}

/** `Thu 15/08/2026` — the weekday plus the compact date, for a drawer's one context line. */
export function formatDayDateDMY(date) {
  const { weekday } = getISTParts(date);
  return `${WEEKDAYS[weekday]} ${formatDateDMY(date)}`;
}

/** IST instant for a `HH:MM` wall-clock time on the IST calendar day of `date`. */
export function istInstantAt(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(istMidnight(date).getTime() + h * 3600000 + m * 60000);
}

export { DAY_MS };
