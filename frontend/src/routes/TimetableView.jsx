import { cn } from '../lib/utils';
import {
  DAYS,
  SLOTS,
  currentSlotIndex,
  dayCellMap,
  periodCountForVersion,
  todayDayKey,
  versionMeta,
} from '../lib/timetableData';
import { formatClock12 } from '../lib/ist';
import { PANE, TABLE_HEAD } from '../components/WorkspaceLayout';
import { SESSION_TYPES, SessionTypeIcon, SessionTypeLegend } from '../components/SessionType';
import { TimetableVersionSelect } from '../components/TimetableVersionSelect';
import { useAttendanceStore } from '@/features/attendance';

const GRID = 'grid grid-cols-[92px_repeat(5,minmax(148px,1fr))]';

/** Restrained fixed heights: 8 periods + both interval bands stay inside the desktop workspace. */
const PERIOD_ROW_H = 48;
const INTERVAL_ROW_H = 24;
const HEADER_ROW_H = 32;

/** Grid line numbers: row 1 is the day header, so slot `i` starts on row `i + 2`. */
const rowFor = (slotIndex) => slotIndex + 2;
const colFor = (dayIndex) => dayIndex + 2;

function TimeCell({ slot, isNow, slotIndex }) {
  const isInterval = slot.period === null;
  return (
    <div
      className={cn(
        'sticky left-0 z-[30] flex flex-col justify-center px-[9px] border-r border-line',
        isNow ? 'bg-accent-soft' : isInterval ? 'bg-tint2' : 'bg-paper',
      )}
      style={{ gridColumn: 1, gridRow: rowFor(slotIndex), height: isInterval ? INTERVAL_ROW_H : PERIOD_ROW_H }}
    >
      <span
        className={cn(
          'tabular-nums leading-[1.2] whitespace-nowrap',
          isInterval ? 'text-[10px] text-ink-faint' : cn('text-[11px] font-[500]', isNow ? 'text-accent' : 'text-ink'),
        )}
      >
        {formatClock12(slot.start)}
      </span>
      {!isInterval && (
        <span className="text-[9.5px] text-ink-faint tabular-nums leading-[1.2] whitespace-nowrap">
          {formatClock12(slot.end)}
        </span>
      )}
    </div>
  );
}

/** Break/Lunch spans the whole teaching week — one calm low band, and nothing is ever merged through it. */
function IntervalBand({ slot, slotIndex, isNow }) {
  return (
    <div
      className={cn('flex items-center justify-center', isNow ? 'bg-accent-soft' : 'bg-tint2')}
      style={{ gridColumn: '2 / span 5', gridRow: rowFor(slotIndex), height: INTERVAL_ROW_H }}
    >
      <span className="text-[9.5px] font-[600] tracking-[.09em] uppercase text-ink-faint">{slot.label}</span>
    </div>
  );
}

function FreeCell({ slotIndex, dayIndex, isToday, isNow }) {
  return (
    <div
      className={cn(
        'flex items-center px-[9px] border-r border-line-lighter',
        isNow ? 'bg-accent-soft/40' : isToday && 'bg-accent-soft/25',
      )}
      style={{ gridColumn: colFor(dayIndex), gridRow: rowFor(slotIndex), height: PERIOD_ROW_H }}
    >
      <span className="text-[11px] text-ink-faint">Free</span>
    </div>
  );
}

/**
 * One session. A practical that runs across consecutive periods renders as a
 * single block spanning those rows — its subject and class are stated once,
 * not repeated per hour, and it carries one extra compact duration line. A
 * theory cell stays at two lines: subject, then a smaller muted class line.
 */
function SessionCell({ block, slotIndex, dayIndex, isToday, isNow }) {
  const { class: cls, span } = block;
  const type = SESSION_TYPES[cls.type] ? cls.type : 'theory';
  const meta = SESSION_TYPES[type];
  const merged = span > 1;
  const classLabel = `${cls.code}${cls.batch ? ` · ${cls.batch}` : ''}`;
  const timeLabel = `${formatClock12(block.start)}–${formatClock12(block.end)}`;

  return (
    <div
      className={cn(
        'min-w-0 flex flex-col justify-center gap-[1px] px-[9px] border-r border-line-lighter border-l-2',
        meta.cell,
        // Current period: a quiet teal edge, never a filled highlight block.
        isNow ? 'border-l-accent' : meta.edge,
        isToday && !isNow && 'shadow-[inset_0_0_0_100vmax_rgba(11,114,133,.02)]',
      )}
      style={{
        gridColumn: colFor(dayIndex),
        gridRow: `${rowFor(slotIndex)} / span ${span}`,
        minHeight: PERIOD_ROW_H,
      }}
      title={`${cls.subject} · ${classLabel} · ${meta.label} · ${timeLabel}${merged ? ` · ${span} periods` : ''}${cls.ownership === 'substitute' ? ` · Substitute for ${cls.substituteFor}` : ''}`}
    >
      <div className="flex items-center gap-[4px] min-w-0">
        <SessionTypeIcon type={type} />
        <span className="text-[12px] font-[500] text-ink truncate leading-[1.3]">{cls.subject}</span>
        {cls.ownership === 'substitute' && (
          <span
            className="flex-none text-[9px] font-[600] uppercase tracking-[.04em] text-pending"
            aria-label="Substitute"
          >
            Sub
          </span>
        )}
      </div>
      <div className="text-[10px] text-ink-faint truncate leading-[1.3]">{classLabel}</div>
      {merged && (
        <div className="text-[9.5px] font-[600] tabular-nums text-ink-muted truncate leading-[1.3]">
          {span} hrs · {timeLabel}
        </div>
      )}
    </div>
  );
}

/**
 * The staff member's fixed weekly allocation for one approved timetable
 * version: 5 teaching days × 8 one-hour period slots, with the institution's
 * Break and Lunch bands in their real positions. View-only — a timetable
 * change is an authority action elsewhere, so no editing or publishing control
 * exists here. Never a department-wide grid, and never a room number.
 *
 * Cells are placed explicitly (`gridColumn`/`gridRow`) rather than by
 * auto-flow, because a merged practical spanning three rows would otherwise
 * push every following day's cell one column out of alignment.
 */
export function TimetableView() {
  const { timetableVersionId, setTimetableVersionId } = useAttendanceStore();
  const now = new Date();
  const activeDay = todayDayKey(now);
  const activeSlot = currentSlotIndex(now);
  const meta = versionMeta(timetableVersionId);

  return (
    <div className={PANE}>
      {/* The Level 1 tab already says "Timetable" — one quiet meta line plus version context, no heading, no history card. */}
      <div className="flex-none flex items-center gap-[10px] flex-wrap mb-[10px]">
        <div className="flex items-center gap-[8px] text-[11.5px] text-ink-muted">
          <span>Approved allocation</span>
          <span className="text-ink-faint" aria-hidden="true">
            ·
          </span>
          <span>Mon–Fri · 8 periods</span>
          <span className="text-ink-faint" aria-hidden="true">
            ·
          </span>
          <span className="tabular-nums">{periodCountForVersion(timetableVersionId)} periods/week</span>
          {meta?.effectiveFrom && (
            <>
              <span className="text-ink-faint" aria-hidden="true">
                ·
              </span>
              <span className="text-ink-faint">Effective from {meta.effectiveFrom}</span>
            </>
          )}
        </div>
        <div className="flex-1" />
        <SessionTypeLegend />
        <TimetableVersionSelect value={timetableVersionId} onChange={setTimetableVersionId} />
      </div>

      <div className="flex-none max-h-full border border-line rounded-[16px] bg-paper overflow-hidden">
        <div className="max-h-full overflow-auto scroll-quiet">
          <div className={cn(GRID, 'min-w-[832px]')}>
            {/* Header row — sticky to the top; its first cell is sticky in both axes. */}
            <div
              className={cn(
                'sticky top-0 left-0 z-[50] flex items-center px-[9px] bg-tint border-b border-r border-line',
                TABLE_HEAD,
              )}
              style={{ gridColumn: 1, gridRow: 1, height: HEADER_ROW_H }}
            >
              Time
            </div>
            {DAYS.map((day, dayIndex) => (
              <div
                key={day.key}
                className={cn(
                  'sticky top-0 z-[40] flex items-center gap-[5px] px-[9px] bg-tint border-b border-r border-line',
                  TABLE_HEAD,
                  day.key === activeDay && 'text-accent',
                )}
                style={{ gridColumn: colFor(dayIndex), gridRow: 1, height: HEADER_ROW_H }}
              >
                {day.short}
                {day.key === activeDay && (
                  <span className="font-[600] normal-case tracking-normal text-[9.5px]">Today</span>
                )}
              </div>
            ))}

            {SLOTS.map((slot, slotIndex) => (
              <TimeCell
                key={`t-${slot.key}`}
                slot={slot}
                slotIndex={slotIndex}
                isNow={slotIndex === activeSlot && !!activeDay}
              />
            ))}

            {SLOTS.map((slot, slotIndex) =>
              slot.period === null ? (
                <IntervalBand
                  key={`i-${slot.key}`}
                  slot={slot}
                  slotIndex={slotIndex}
                  isNow={slotIndex === activeSlot && !!activeDay}
                />
              ) : null,
            )}

            {DAYS.map((day, dayIndex) => {
              const cells = dayCellMap(day.key, timetableVersionId);
              const isToday = day.key === activeDay;

              return cells.map((cell, slotIndex) => {
                if (SLOTS[slotIndex].period === null) return null;
                // A covered slot belongs to the merged block above it — emitting
                // anything here would both duplicate content and break alignment.
                if (cell?.kind === 'covered') return null;

                const isNow = isToday && slotIndex === activeSlot;
                const key = `${day.key}-${SLOTS[slotIndex].key}`;

                if (!cell) {
                  return (
                    <FreeCell key={key} slotIndex={slotIndex} dayIndex={dayIndex} isToday={isToday} isNow={isNow} />
                  );
                }
                return (
                  <SessionCell
                    key={key}
                    block={cell.block}
                    slotIndex={slotIndex}
                    dayIndex={dayIndex}
                    isToday={isToday}
                    isNow={isNow || (isToday && cell.block.slotIndexes.includes(activeSlot))}
                  />
                );
              });
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
