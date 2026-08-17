import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { DrawerShell } from './AttendanceActionDrawer';
import { useCalendarStore } from '../store/CalendarProvider';
import { notePreview } from '../lib/calendarData';
import { formatDateDMY, parseISTDateBounds } from '../lib/ist';

/**
 * Every personal note in one right-side list — never a separate page, so the
 * calendar (and the AppShell around it) stays exactly where it was. Picking a
 * note hands the date back to the calendar, which opens that date's editor:
 * the list is a way in, not a second editor.
 */
export function NotesListDrawer({ open, onClose, onPick }) {
  const { allNotes } = useCalendarStore();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return allNotes;
    return allNotes.filter((n) => {
      const date = formatDateDMY(parseISTDateBounds(n.dateKey).start);
      return (
        n.title?.toLowerCase().includes(term) ||
        n.body?.toLowerCase().includes(term) ||
        n.dateKey.includes(term) ||
        date.includes(term)
      );
    });
  }, [allNotes, query]);

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="My notes"
      contextLine={`${allNotes.length} saved note${allNotes.length === 1 ? '' : 's'} · private to you`}
      description="All saved personal calendar notes"
      width="sm:w-[420px]"
    >
      <div className="flex-none px-[18px] pt-[12px] pb-[10px]">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes by title, text or date…"
            aria-label="Search notes"
            className="w-full h-[32px] pl-[30px] pr-[10px] border border-line rounded-[9px] bg-paper font-sans text-[12.5px] text-ink outline-none focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
          />
          <span className="absolute left-[9px] top-0 bottom-0 flex items-center text-ink-ghost pointer-events-none">
            <Search size={13} strokeWidth={1.9} />
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] pb-[16px]">
        {rows.length === 0 ? (
          <p className="mt-[24px] text-center text-[12.5px] text-ink-faint">
            {allNotes.length === 0 ? 'No notes yet. Pick a date on the calendar to write one.' : 'No notes match that search.'}
          </p>
        ) : (
          <div className="grid gap-[6px]">
            {rows.map((n) => (
              <button
                key={n.dateKey}
                type="button"
                onClick={() => onPick(n.dateKey)}
                className="w-full px-[12px] py-[9px] border border-line rounded-[12px] bg-paper text-left cursor-pointer transition-colors duration-150 hover:bg-tint2"
              >
                <span className="block text-[11px] font-[500] text-accent tabular-nums">
                  {formatDateDMY(parseISTDateBounds(n.dateKey).start)}
                </span>
                <span className="block mt-[2px] text-[12.5px] font-[500] text-ink truncate">
                  {n.title?.trim() || notePreview(n)}
                </span>
                {n.title?.trim() && n.body?.trim() && (
                  <span className="block mt-[1px] text-[11.5px] text-ink-muted truncate">{notePreview({ body: n.body })}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </DrawerShell>
  );
}
