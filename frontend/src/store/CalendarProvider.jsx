import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { INSTITUTIONAL_EVENTS, eventsByDay, noteHasContent } from '../lib/calendarData';
import { ME } from '../lib/documentsData';

const CalendarContext = createContext(null);

/**
 * Calendar state: read-only institutional events, and the staff member's own
 * private date notes keyed by IST day.
 *
 * Notes carry a `version` and an `updatedAt`. Autosave sends the version it
 * read; a save against a stale version is refused rather than silently
 * overwriting, which is what lets the drawer show "This note changed
 * elsewhere" instead of quietly losing someone's text. In this mock the only
 * writer is the current tab, so the check is inert — but the write path is the
 * one the real API will enforce, not a shape that has to be retrofitted later.
 *
 * Notes never appear on another staff member's calendar: they are stored under
 * the owner's id, and `noteFor()` only ever reads the current user's map.
 */
export function CalendarProvider({ children }) {
  const [notes, setNotes] = useState({}); // { [dateKey]: { dateKey, title, body, updatedAt, version, ownerId } }

  const events = INSTITUTIONAL_EVENTS;
  const eventsFor = useMemo(() => eventsByDay(events), [events]);

  const noteFor = useCallback(
    (dateKey) => {
      const note = notes[dateKey];
      return note && note.ownerId === ME.id ? note : null;
    },
    [notes]
  );

  /**
   * The single write path for a note. Returns `{ ok, conflict, note }`:
   * a stale `baseVersion` is reported back rather than applied, so the caller
   * still holds its draft and can decide what to do with it.
   */
  const saveNote = useCallback((dateKey, patch, baseVersion = null) => {
    let outcome = { ok: true, conflict: false, note: null };
    setNotes((prev) => {
      const current = prev[dateKey] ?? null;
      if (current && baseVersion !== null && current.version !== baseVersion) {
        outcome = { ok: false, conflict: true, note: current };
        return prev;
      }
      const next = {
        dateKey,
        ownerId: ME.id,
        title: patch.title ?? current?.title ?? '',
        body: patch.body ?? current?.body ?? '',
        updatedAt: new Date(),
        version: (current?.version ?? 0) + 1,
      };
      // An emptied note is removed rather than kept as a blank marker on the day.
      if (!noteHasContent(next)) {
        outcome = { ok: true, conflict: false, note: null };
        const { [dateKey]: _drop, ...rest } = prev;
        return rest;
      }
      outcome = { ok: true, conflict: false, note: next };
      return { ...prev, [dateKey]: next };
    });
    return outcome;
  }, []);

  const deleteNote = useCallback((dateKey) => {
    setNotes((prev) => {
      const { [dateKey]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);

  const allNotes = useMemo(
    () =>
      Object.values(notes)
        .filter((n) => n.ownerId === ME.id)
        .sort((a, b) => (b.dateKey < a.dateKey ? -1 : b.dateKey > a.dateKey ? 1 : 0)),
    [notes]
  );

  const value = useMemo(
    () => ({ events, eventsFor, notes, noteFor, saveNote, deleteNote, allNotes }),
    [events, eventsFor, notes, noteFor, saveNote, deleteNote, allNotes]
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendarStore() {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error('useCalendarStore must be used inside CalendarProvider');
  return ctx;
}
