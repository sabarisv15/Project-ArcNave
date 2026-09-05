// P3 4.6/5.9 — the calendar feature's public surface.
//
// Same rule as features/attendance, features/documents, features/chat,
// features/assessments: CalendarProvider was one of the 7 remaining flat
// context providers, but every real consumer (DateNoteDrawer,
// NotesListDrawer, CalendarView) turned out to be calendar-only — a
// clean move, not a new taxonomy decision like the 5 providers still
// left flat.
//
// CalendarView itself is NOT re-exported — App.jsx lazy-loads it by
// direct path, same convention every other lazy route already uses.
export { CalendarProvider, useCalendarStore } from './store/CalendarProvider';
