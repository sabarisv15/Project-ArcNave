import { istDayKey, parseISTDateBounds, startOfWeekIST } from './ist';

/** The one date-range preset list every attendance surface shares. */
export const DATE_PRESETS = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom range' },
];

/** Preset/custom range test for an IST calendar date. `date` is the record's own IST-midnight day. */
export function inDateRange(date, now, preset, customFrom, customTo) {
  if (preset === 'all' || !preset) return true;
  if (preset === 'today') return istDayKey(date) === istDayKey(now);
  if (preset === 'yesterday') return istDayKey(date) === istDayKey(new Date(now.getTime() - 86400000));
  if (preset === 'week') return date >= startOfWeekIST(now);
  if (preset === 'month') return istDayKey(date).slice(0, 7) === istDayKey(now).slice(0, 7);
  if (preset === 'custom') {
    if (customFrom && date < parseISTDateBounds(customFrom).start) return false;
    if (customTo && date > parseISTDateBounds(customTo).end) return false;
    return true;
  }
  return true;
}
