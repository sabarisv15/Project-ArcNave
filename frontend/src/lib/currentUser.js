// P3 5.8 — the acting-user fixture, extracted from lib/documentsData.js.
//
// Four modules outside documents (AssessmentCreateDrawer,
// AssessmentDetailDrawer, DateNoteDrawer, CalendarProvider) imported
// `ME` from documentsData and nothing else from it. That was invisible
// in a flat lib/ folder and became a problem the moment documents moved
// into its own feature: an assessments drawer would have had to import
// from the documents feature to learn who the current user is.
//
// It is identity, not documents data, so it lives here.
//
// FLAGGED, deliberately NOT unified: two other `ME` fixtures exist —
// lib/assessmentsData.js (`{ id: 'staff-me', name: 'Priya Ramesh' }`,
// no role) and lib/substituteData.js (`{ id: 'staff-me', name: 'You' }`).
// Same id, different names and shapes. Merging them would change visible
// UI text (substitute rows deliberately read "You"), which is a product
// decision, not a refactor. Recorded here so the duplication is at least
// written down instead of rediscovered.
export const ME = { id: 'staff-me', name: 'Priya Ramesh', role: 'Assistant Professor' };
