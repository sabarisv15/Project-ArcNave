// P3 4.6/5.9 — the assessments feature's public surface.
//
// Same rule as features/attendance, features/documents, features/chat:
// AssessmentsProvider was one of the 7 remaining flat context providers
// this modernization effort flagged as unmoved. Unlike WorkspaceProvider/
// InstitutionalLifecycleProvider/AcademicRosterProvider/AcademicTermProvider
// (which every importer check showed span Institution/Department/Class/
// Home/Chat/Project — no single feature owns them), this one had exactly
// 3 real consumers, all assessments-specific — a clean move, not a new
// taxonomy decision.
//
// AssessmentsView itself is NOT re-exported — App.jsx lazy-loads it by
// direct path, same convention every other lazy route already uses.
export { AssessmentsProvider, useAssessmentsStore } from './store/AssessmentsProvider';
