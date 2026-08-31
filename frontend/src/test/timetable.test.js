import { describe, expect, it } from 'vitest';
import {
  SLOTS,
  blocksForDay,
  expandSession,
  workloadForVersion,
  TIMETABLE_VERSIONS,
  dayCellMap,
} from '../lib/timetableData';

const INTERVALS = SLOTS.map((s, i) => (s.period === null ? i : null)).filter((i) => i !== null);
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

describe('timetable blocks and derived workload', () => {
  it('never spans an interval and is always contiguous', () => {
    for (const v of TIMETABLE_VERSIONS) {
      for (const d of DAYS) {
        for (const b of blocksForDay(d, v.id)) {
          expect(b.slotIndexes.every((x, i) => i === 0 || x === b.slotIndexes[i - 1] + 1)).toBe(true);
          expect(b.slotIndexes.some((i) => INTERVALS.includes(i))).toBe(false);
        }
      }
    }
  });

  it('splits a span that would run through Break into separate blocks around it', () => {
    // p2,p3,p4: Break sits between p3 and p4 -> must become [p2,p3] and [p4]
    const blocks = expandSession({ p: 2, c: 'dslab', span: 3 });
    expect(blocks.map((b) => b.periods)).toEqual([[2, 3], [4]]);
    expect(blocks.map((b) => b.span)).toEqual([2, 1]);
  });

  it('splits a span that would run through Lunch too', () => {
    // p4,p5: Lunch sits between them -> two single-period blocks
    const blocks = expandSession({ p: 4, c: 'dslab', span: 2 });
    expect(blocks.map((b) => b.periods)).toEqual([[4], [5]]);
  });

  it('keeps a genuine 3-hour practical as one block', () => {
    const blocks = expandSession({ p: 6, c: 'dslab', span: 3 });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].hours).toBe(3);
    expect(blocks[0].start).toBe('15:00');
    expect(blocks[0].end).toBe('18:00');
  });

  it('reports a different total per version', () => {
    const totals = TIMETABLE_VERSIONS.map((v) => [v.label, workloadForVersion(v.id).totalHours]);
    console.log('totals', JSON.stringify(totals));
    expect(new Set(totals.map(([, t]) => t)).size).toBe(TIMETABLE_VERSIONS.length);
  });

  it('emits no cell for slots covered by a merged block', () => {
    expect(dayCellMap('wed').filter((c) => c?.kind === 'covered')).toHaveLength(2);
  });
});
