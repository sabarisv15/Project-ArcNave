import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, NotebookPen, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CalendarProvider, useCalendarStore } from '../store/CalendarProvider';
import { DateNoteDrawer } from '../components/DateNoteDrawer';
import { NotesListDrawer } from '../components/NotesListDrawer';
import { EVENT_TYPES, MONTH_NAMES, WEEKDAY_LABELS, monthGrid } from '../lib/calendarData';
import { getISTParts, istDayKey } from '@/lib/ist';

const NAV_BTN =
  'w-[26px] h-[26px] grid place-items-center rounded-[8px] border-0 bg-transparent text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink';

const HEADER_BTN =
  'inline-flex items-center gap-[6px] h-[26px] px-[9px] rounded-[8px] border border-line bg-paper font-sans text-[11.5px] font-[500] text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-tint2';

/** Saturday and Sunday, in the Monday-first grid the month view renders. */
const WEEKEND_COLUMNS = new Set([5, 6]);

/**
 * Month is the default and the only required view — a staff member's calendar
 * question is almost always "what is happening around now", and a week/day
 * switcher would add chrome without answering it better.
 *
 * Cells stay compact on purpose: institutional activities render as small
 * coloured dots with at most two truncated labels and a `+n more` count, and a
 * personal note shows as one marker — never its text, which would turn a grid
 * of dates into a wall of prose. The full picture for a date lives in the
 * drawer, which is one click away.
 */
function CalendarBody() {
  const { eventsFor, noteFor, allNotes } = useCalendarStore();
  const todayKey = istDayKey(new Date());
  const parts = getISTParts(new Date());

  const [cursor, setCursor] = useState({ year: parts.year, month: parts.month });
  const [openDate, setOpenDate] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);

  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);

  const step = (delta) => {
    setCursor(({ year, month }) => {
      const next = month + delta;
      if (next < 0) return { year: year - 1, month: 11 };
      if (next > 11) return { year: year + 1, month: 0 };
      return { year, month: next };
    });
  };

  const goToday = () => setCursor({ year: parts.year, month: parts.month });

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-[24px] pt-[14px] pb-[16px] animate-viewIn">
      {/*
        One control row, no page hero: the month itself is the title, the two
        chevrons and Today sit directly beside it, and Notes is the only thing
        held to the right edge.
      */}
      <div className="flex-none flex items-center gap-[6px] mb-[8px]">
        <h1 className="m-0 mr-[2px] text-[14.5px] font-[600] tracking-[-.01em] tabular-nums">
          {MONTH_NAMES[cursor.month]} {cursor.year}
        </h1>
        <button
          type="button"
          aria-label="Previous month"
          title="Previous month"
          onClick={() => step(-1)}
          className={NAV_BTN}
        >
          <ChevronLeft size={15} strokeWidth={2} />
        </button>
        <button type="button" aria-label="Next month" title="Next month" onClick={() => step(1)} className={NAV_BTN}>
          <ChevronRight size={15} strokeWidth={2} />
        </button>
        <button type="button" onClick={goToday} className={HEADER_BTN}>
          Today
        </button>

        <div className="flex-1" />

        {/* Legend stays to the two facts a staff member needs to read the grid. */}
        <span className="hidden md:inline-flex items-center gap-[10px] mr-[4px] text-[11px] text-ink-faint">
          <span className="inline-flex items-center gap-[4px]">
            <span aria-hidden="true" className="w-[6px] h-[6px] rounded-full bg-accent" /> Institutional
          </span>
          <span className="inline-flex items-center gap-[4px]">
            <StickyNote size={11} strokeWidth={2} aria-hidden="true" /> My note
          </span>
        </span>

        <button
          type="button"
          onClick={() => setNotesOpen(true)}
          aria-label="Open my notes"
          title="My notes"
          className={HEADER_BTN}
        >
          <NotebookPen size={13} strokeWidth={1.9} />
          Notes
          {allNotes.length > 0 && <span className="text-[11px] text-accent tabular-nums">{allNotes.length}</span>}
        </button>
      </div>

      {/*
        One bordered container for the whole month, not a card per date: the
        cells are separated by hairlines they draw themselves (a top and a left
        border, with the container's own edge covering the first row and
        column), which is what keeps a 42-cell grid reading as a calendar
        rather than as a dashboard of tiles.
      */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-[15px] border border-line bg-paper">
        <div className="flex-none grid grid-cols-7 border-b border-line bg-tint">
          {WEEKDAY_LABELS.map((d, i) => (
            <span
              key={d}
              className={cn(
                'px-[8px] py-[6px] text-[11px] font-[500] uppercase tracking-[.05em] text-ink-muted',
                i > 0 && 'border-l border-line-light',
              )}
            >
              {d}
            </span>
          ))}
        </div>

        {/* Rows share the height when there is enough of it and hold their
            minimum when there is not, so a short viewport scrolls the weeks
            instead of crushing the cells. */}
        <div className="flex-1 min-h-0 grid grid-cols-7 grid-rows-6 overflow-y-auto scroll-quiet">
          {cells.map((cell, i) => {
            const dayEvents = eventsFor.get(cell.dateKey) ?? [];
            const note = noteFor(cell.dateKey);
            const isToday = cell.dateKey === todayKey;
            const column = i % 7;
            const weekend = WEEKEND_COLUMNS.has(column);
            return (
              <button
                key={cell.dateKey}
                type="button"
                onClick={() => setOpenDate(cell.dateKey)}
                aria-label={`${cell.dateKey}${dayEvents.length ? `, ${dayEvents.length} institutional activities` : ''}${note ? ', has my note' : ''}`}
                className={cn(
                  'min-h-[76px] flex flex-col items-stretch gap-[2px] px-[6px] pt-[5px] pb-[4px] text-left cursor-pointer overflow-hidden transition-colors duration-150 hover:bg-tint2',
                  // Only interior dividers — the container draws the outside.
                  column > 0 && 'border-l border-line-light',
                  i > 6 && 'border-t border-line-light',
                  // Weekends and days spilling in from the neighbouring months
                  // are a faint surface and a subdued number, never a
                  // different kind of cell.
                  cell.inMonth ? (weekend ? 'bg-tint/60' : 'bg-paper') : 'bg-tint/40',
                )}
              >
                <span className="flex items-center gap-[4px]">
                  {/* Today is one small soft disc under the number — the cell
                      itself stays the same surface as every other. */}
                  <span
                    className={cn(
                      'grid place-items-center w-[19px] h-[19px] rounded-full text-[11.5px] tabular-nums',
                      isToday
                        ? 'bg-accent-soft text-accent font-[600]'
                        : cell.inMonth
                          ? 'font-[500] text-ink'
                          : 'font-[400] text-ink-faint',
                    )}
                  >
                    {cell.date.getUTCDate()}
                  </span>
                  <span className="flex-1" />
                  {/* A personal note is a marker only; its text lives in the drawer. */}
                  {note && (
                    <StickyNote size={11} strokeWidth={2} className="flex-none text-accent" aria-hidden="true" />
                  )}
                </span>

                {dayEvents.slice(0, 2).map((e) => (
                  <span key={e.id} className="flex items-center gap-[5px] min-w-0">
                    <span
                      aria-hidden="true"
                      className="flex-none w-[5px] h-[5px] rounded-full"
                      style={{ backgroundColor: EVENT_TYPES[e.type]?.dot }}
                    />
                    <span className="min-w-0 text-[10.5px] leading-[15px] text-ink-muted truncate">{e.title}</span>
                  </span>
                ))}
                {dayEvents.length > 2 && (
                  <span className="pl-[10px] text-[10.5px] leading-[15px] text-ink-faint">
                    +{dayEvents.length - 2} more
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <DateNoteDrawer open={!!openDate} dateKey={openDate} onClose={() => setOpenDate(null)} />
      <NotesListDrawer
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        onPick={(dateKey) => {
          setNotesOpen(false);
          setOpenDate(dateKey);
        }}
      />
    </div>
  );
}

export function CalendarView() {
  return (
    <CalendarProvider>
      <CalendarBody />
    </CalendarProvider>
  );
}
