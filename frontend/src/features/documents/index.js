// P3 5.8 — the documents feature's public surface.
//
// Same rule as features/attendance: nothing outside this folder imports
// a file from inside it. In practice the app needs very little from here
// — the route, and the store for anything that later wants to read the
// personal tree — which is a good sign the boundary is drawn in the
// right place.
//
// Note what deliberately does NOT appear: DocumentIcon,
// DocumentPreviewDrawer and RenameNodeDialog. Each looked like shared UI
// sitting in the flat components/ folder, but every importer turned out
// to be a documents component, so they are internal to the feature.
// Contrast the drawer chrome, which genuinely was shared by ~25 unrelated
// drawers and was promoted to components/ui/Drawer.jsx instead.

export { DocumentsView } from './routes/DocumentsView';
export { useDocumentsStore, uniqueName, documentKeys } from './store/useDocumentsStore';
