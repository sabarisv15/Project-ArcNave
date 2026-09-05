// P3 5.9 — the institution feature's public surface.
//
// InstitutionalLifecycleProvider, AcademicRosterProvider and
// AcademicTermProvider were 3 of the 7 remaining flat context providers.
// Unlike AssessmentsProvider/CalendarProvider (each had a small, clean set
// of exclusive consumers), every real consumer of these three spans
// Institution + Department + Delegated + MyClass/Class-Tutor routes and
// drawers — moving THOSE files too would mean inventing feature
// boundaries across seat levels that don't exist yet, a real architecture
// decision this move doesn't make unilaterally.
//
// So only the providers themselves moved here (they already depend on
// each other — InstitutionalLifecycleProvider uses both
// AcademicRosterProvider and AcademicTermProvider, AcademicRosterProvider
// uses AcademicTermProvider — confirming they're a genuine cluster, not
// three unrelated files bundled by convenience). Every one of their ~20
// consumer components/routes stays flat, importing through this barrel
// instead of the old store/ path.
export {
  InstitutionalLifecycleProvider,
  useInstitutionalLifecycle,
  LIFECYCLE_REJECTION,
} from './store/InstitutionalLifecycleProvider';
export {
  AcademicRosterProvider,
  useAcademicRoster,
  REJECTION,
  canonicalKey,
  ACTIVE_CLASSES,
} from './store/AcademicRosterProvider';
export { AcademicTermProvider, useAcademicTerm, TERM_REJECTION } from './store/AcademicTermProvider';
