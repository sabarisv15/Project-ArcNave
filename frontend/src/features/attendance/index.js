// P3 5.8 — the attendance feature's public surface.
//
// Everything outside this folder imports from `@/features/attendance`,
// never from a file inside it. That is the actual point of grouping by
// feature rather than by type: the feature gets to move, split or rename
// its internals without touching the rest of the app, and what other
// features are allowed to depend on is written down in one place instead
// of being "whatever anyone happened to import".
//
// Note what is deliberately NOT re-exported: the raw lib fixtures
// (attendanceData/attendanceLedger) beyond the few symbols other features
// genuinely already use, and useAttendanceLifecycle, which only the
// section's own route layout should ever call.

export { useAttendanceStore } from './store/attendanceStore';
export { useAttendanceLifecycle } from './store/useAttendanceLifecycle';

export { AttendanceActionDrawer } from './components/AttendanceActionDrawer';
// AttendanceStatus.jsx is a set of phase/ownership badges rather than one
// component — several are used by shared tables outside this feature.
export { PhaseBadge, CompactPhase, OwnershipBadge, CalculationImpactLine } from './components/AttendanceStatus';
export { AttendanceHomeView } from './routes/AttendanceHomeView';
export { AttendanceTabsLayout } from './routes/AttendanceTabsLayout';
export { useAttendanceLedger } from './hooks/useAttendanceLedger';
