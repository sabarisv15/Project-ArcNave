/**
 * When a message was sent, said the way a person would say it.
 *
 * The ladder is relative all the way down — minutes, hours, days, weeks,
 * months, years — and never turns into a calendar date. A transcript is read
 * top to bottom, and the only question it has to answer about any one line is
 * "how old is this?"; a date makes the reader do the subtraction themselves,
 * and "Yesterday" is the one rung that means something different depending on
 * what time it is read. Both are gone.
 *
 * Pure functions of `(iso, now)`: no clock is read in here, so the caller owns
 * the tick and every message in a render agrees on what "now" is.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
// The average civil month/year, which is what "4 months ago" means to a reader
// — nobody is counting which months had 31 days.
const MONTH = 30.44 * DAY;
const YEAR = 365.25 * DAY;

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

/**
 * `Just now` · `2 min ago` · `45 min ago` · `3 hr ago` · `23 hr ago` ·
 * `2 days ago` · `12 days ago` · `3 weeks ago` · `4 months ago` · `2 years ago`.
 */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  // A clock that has drifted backwards (or a message written a moment into the
  // future by a fast machine) reads as "Just now", never as a negative age.
  const elapsed = Math.max(0, now - then);

  if (elapsed < MINUTE) return 'Just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} hr ago`;
  // Two weeks of days before switching to weeks: "13 days ago" is still a
  // number a reader holds easily, and rounding it to "2 weeks" loses more than
  // it saves.
  if (elapsed < 2 * WEEK) return plural(Math.floor(elapsed / DAY), 'day');
  if (elapsed < MONTH) return plural(Math.floor(elapsed / WEEK), 'week');
  if (elapsed < YEAR) return plural(Math.floor(elapsed / MONTH), 'month');
  return plural(Math.floor(elapsed / YEAR), 'year');
}

/**
 * Seeded conversations carry a human string ("2 hours ago", "Last week") and
 * no timestamp, because they were written as fixtures rather than sent. This
 * turns that string back into an instant so a seeded thread doesn't claim every
 * one of its messages arrived "Just now" the moment it is opened.
 *
 * Unrecognised text falls back to now — a wrong-but-plausible recent time is
 * better than a blank where a timestamp belongs.
 */
export function metaToTimestamp(meta, now = Date.now()) {
  const text = String(meta ?? '')
    .toLowerCase()
    .trim();
  const n = parseInt(text, 10);

  if (text.includes('just now')) return new Date(now).toISOString();
  if (text.includes('minute')) return new Date(now - (n || 1) * MINUTE).toISOString();
  if (text.includes('hour')) return new Date(now - (n || 1) * HOUR).toISOString();
  if (text.includes('yesterday')) return new Date(now - 1.2 * DAY).toISOString();
  if (text.includes('day')) return new Date(now - (n || 2) * DAY).toISOString();
  if (text.includes('last week')) return new Date(now - 8 * DAY).toISOString();
  if (text.includes('week')) return new Date(now - (n || 1) * 7 * DAY).toISOString();
  return new Date(now).toISOString();
}
