import { useEffect, useRef, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Lock, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { DrawerShell, DrawerRail, GHOST_BTN } from './AttendanceActionDrawer';
import { AutosaveStatus, DraftRestoredNote } from './AutosaveStatus';
import { useAutosave, useRestoredDraft } from '../hooks/useAutosave';
import { draftKey } from '../lib/draftStore';
import { useCalendarStore } from '../store/CalendarProvider';
import { EVENT_TYPES, noteHasContent } from '../lib/calendarData';
import { ME } from '../lib/documentsData';
import { formatDateDMY } from '../lib/ist';
import { parseISTDateBounds } from '../lib/ist';

const FIELD =
  'w-full font-sans text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]';

/**
 * One date: the institution's activities for it (read-only) and the staff
 * member's own private note (editable).
 *
 * The note autosaves as you type — 600ms debounce, a quiet Saving…/Saved line
 * in the rail, never a toast. Closing the drawer by any route (Escape,
 * backdrop, the close button, navigating away) flushes the pending save first,
 * and the text is mirrored to session storage the moment it changes, so an
 * accidental close cannot cost anything. Delete stays an explicit, confirmed
 * action.
 */
export function DateNoteDrawer({ open, dateKey, onClose }) {
  const { eventsFor, noteFor, saveNote, deleteNote } = useCalendarStore();
  const stored = dateKey ? noteFor(dateKey) : null;
  const key = draftKey(ME.id, 'date-note', dateKey ?? 'none');
  const restored = useRestoredDraft(key, open);

  const [draft, setDraft] = useState({ title: '', body: '' });
  const [seeded, setSeeded] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const baseVersion = useRef(null);
  const bodyRef = useRef(null);

  const autosave = useAutosave({
    value: draft,
    storageKey: key,
    onSave: (value) => {
      const result = saveNote(dateKey, value, baseVersion.current);
      if (result.conflict) {
        setConflict(true);
        throw new Error('stale'); // keeps the local draft and shows the retry affordance
      }
      setConflict(false);
      baseVersion.current = result.note?.version ?? null;
    },
  });

  useEffect(() => {
    if (!open) { setSeeded(false); setConflict(false); return; }
    if (seeded) return;
    const base = { title: stored?.title ?? '', body: stored?.body ?? '' };
    const recovered = restored?.value;
    setDraft(recovered ?? base);
    baseVersion.current = stored?.version ?? null;
    setSeeded(true);
    requestAnimationFrame(() => bodyRef.current?.focus());
  }, [open, seeded, stored, restored]);

  const usedDraft =
    !!restored?.value &&
    (restored.value.title !== (stored?.title ?? '') || restored.value.body !== (stored?.body ?? ''));

  const update = (patch) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    autosave.schedule();
  };

  const close = () => {
    autosave.flush(); // flush before the drawer goes — nothing typed is ever lost
    onClose();
  };

  const dayEvents = dateKey ? eventsFor.get(dateKey) ?? [] : [];
  const dateLabel = dateKey ? formatDateDMY(parseISTDateBounds(dateKey).start) : '';

  return (
    <>
      <DrawerShell
        open={open}
        onOpenChange={(v) => !v && close()}
        title={dateLabel}
        contextLine={dayEvents.length ? `${dayEvents.length} institutional ${dayEvents.length === 1 ? 'activity' : 'activities'}` : 'No institutional activity'}
        description={`Notes and activities for ${dateLabel}`}
        width="sm:w-[440px]"
      >
        <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] pt-[14px] pb-[16px]">
          {dayEvents.length > 0 && (
            <div className="mb-[16px]">
              <div className="flex items-center gap-[6px] mb-[7px] text-[10.5px] font-[500] uppercase tracking-[.06em] text-ink-faint">
                Institution
                <Lock size={11} strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="grid gap-[6px]">
                {dayEvents.map((e) => (
                  <div key={e.id} className="flex items-start gap-[8px] px-[11px] py-[8px] border border-line rounded-[11px] bg-paper">
                    <span
                      aria-hidden="true"
                      className="flex-none w-[7px] h-[7px] mt-[5px] rounded-full"
                      style={{ backgroundColor: EVENT_TYPES[e.type]?.dot }}
                    />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-[500] text-ink">{e.title}</span>
                      <span className="block mt-[1px] text-[11px] text-ink-faint">
                        {EVENT_TYPES[e.type]?.label} · {e.scope}
                      </span>
                      {e.detail && <span className="block mt-[3px] text-[11.5px] text-ink-muted">{e.detail}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-[10.5px] font-[500] uppercase tracking-[.06em] text-ink-faint mb-[7px]">My note</div>
          <input
            value={draft.title}
            onChange={(e) => update({ title: e.target.value.slice(0, 90) })}
            placeholder="Title (optional)"
            aria-label="Note title"
            className={cn(FIELD, 'h-[34px] text-[12.5px] mb-[8px]')}
          />
          <textarea
            ref={bodyRef}
            value={draft.body}
            onChange={(e) => update({ body: e.target.value })}
            rows={8}
            placeholder="Write a note for this date…"
            aria-label="Note text"
            className={cn(FIELD, 'text-[12.5px] leading-[1.6] resize-none')}
          />

          {conflict && (
            <p className="mt-[9px] mb-0 text-[11.5px] text-danger">
              This note changed elsewhere. Review the latest version — your text is still here.
            </p>
          )}
          <p className="mt-[9px] mb-0 text-[11px] text-ink-faint">Private to you. Saved automatically as you type.</p>
        </div>

        <DrawerRail
          meta={
            usedDraft && autosave.status === 'idle'
              ? <DraftRestoredNote show />
              : <AutosaveStatus status={autosave.status} savedAt={autosave.savedAt} onRetry={autosave.retry} />
          }
        >
          {noteHasContent(stored) && (
            <button
              type="button"
              className={cn(GHOST_BTN, 'text-danger')}
              onClick={() => setConfirmDelete(true)}
            >
              <span className="inline-flex items-center gap-[6px]"><Trash2 size={13} strokeWidth={2} />Delete</span>
            </button>
          )}
          <button type="button" className={GHOST_BTN} onClick={close}>Done</button>
        </DrawerRail>
      </DrawerShell>

      <AlertDialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[130] bg-overlay/20 animate-fadeUp" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[131] w-[calc(100%-48px)] max-w-[380px] bg-paper rounded-[16px] p-[20px] shadow-dialog outline-none animate-fadeUp">
            <AlertDialog.Title className="m-0 mb-[6px] text-[15.5px] font-[600]">Delete this note?</AlertDialog.Title>
            <AlertDialog.Description className="m-0 mb-[18px] text-[12.5px] text-ink-muted">
              The note for {dateLabel} will be removed from your calendar.
            </AlertDialog.Description>
            <div className="flex justify-end gap-[9px]">
              <AlertDialog.Cancel asChild>
                <button type="button" className="h-[32px] px-[14px] border border-line rounded-[10px] bg-paper font-sans text-[12.5px] font-[500] text-ink-muted cursor-pointer hover:bg-tint2">
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  onClick={() => {
                    deleteNote(dateKey);
                    autosave.markClean();
                    setDraft({ title: '', body: '' });
                    setConfirmDelete(false);
                    onClose();
                  }}
                  className="h-[32px] px-[14px] border-0 rounded-[10px] bg-danger text-white font-sans text-[12.5px] font-[500] cursor-pointer hover:bg-danger-hover"
                >
                  Delete note
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
