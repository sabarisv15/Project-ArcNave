import { describe, expect, it } from 'vitest';
import {
  INSTITUTIONAL_EVENTS,
  MONTH_NAMES,
  WEEKDAY_LABELS,
  eventsByDay,
  monthGrid,
  noteHasContent,
  notePreview,
} from '../features/calendar/lib/calendarData';
import { istDayKey } from '../lib/ist';

describe('institutional events', () => {
  it('are all institutional and read-only in shape', () => {
    expect(INSTITUTIONAL_EVENTS.length).toBeGreaterThan(0);
    for (const e of INSTITUTIONAL_EVENTS) {
      expect(e.source).toBe('institutional');
      expect(e.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.publishedBy).toBeTruthy();
    }
  });

  it('buckets by IST day key', () => {
    const map = eventsByDay(INSTITUTIONAL_EVENTS);
    const todayKey = istDayKey(new Date());
    expect(map.get(todayKey)?.length).toBeGreaterThan(0); // the seed always covers today
    for (const [key, list] of map) list.forEach((e) => expect(e.dateKey).toBe(key));
  });
});

describe('month grid', () => {
  it('is always 6 weeks and starts on a Monday', () => {
    const cells = monthGrid(2026, 7); // August 2026
    expect(cells).toHaveLength(42);
    expect(cells[0].date.getUTCDay()).toBe(1);
    expect(WEEKDAY_LABELS[0]).toBe('Mon');
  });

  it('marks only the requested month as in-month, and covers all its days', () => {
    const cells = monthGrid(2026, 7);
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].date.getUTCDate()).toBe(1);
    expect(MONTH_NAMES[7]).toBe('August');
  });

  it('rolls over a year boundary without gaps', () => {
    const dec = monthGrid(2026, 11);
    expect(dec.filter((c) => c.inMonth)).toHaveLength(31);
    const jan = monthGrid(2027, 0);
    expect(jan.filter((c) => c.inMonth)).toHaveLength(31);
  });
});

describe('personal notes', () => {
  it('an empty note is never real content', () => {
    expect(noteHasContent(null)).toBe(false);
    expect(noteHasContent({ title: '', body: '' })).toBe(false);
    expect(noteHasContent({ title: '   ', body: '\n' })).toBe(false);
  });

  it('a title or a body alone is enough', () => {
    expect(noteHasContent({ title: 'Duty', body: '' })).toBe(true);
    expect(noteHasContent({ title: '', body: 'Bring seating plan' })).toBe(true);
  });

  it('previews prefer the title and truncate long text', () => {
    expect(notePreview({ title: 'Duty', body: 'x' })).toBe('Duty');
    const long = 'a'.repeat(200);
    expect(notePreview({ body: long }).length).toBeLessThanOrEqual(64);
    expect(notePreview({ body: long }).endsWith('…')).toBe(true);
  });
});
