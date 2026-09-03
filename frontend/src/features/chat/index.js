// P3 5.9 — the chat feature's public surface.
//
// Same rule as features/attendance and features/documents: consumers
// outside this folder reach the chat surfaces (embedded in ChatRoute,
// ProjectDetail's project chat, and ArtifactEditor's revision chat) through
// here, not by reaching into features/chat/components directly.
//
// ChatRoute itself is NOT re-exported — App.jsx lazy-loads it by direct
// path (`./features/chat/routes/ChatRoute`), same convention
// AttendanceHomeView/DocumentsView already use for their own lazy routes,
// so importing it here would defeat that code-split.
//
// Not exported, on purpose — every one of these turned out to be
// chat-internal once every importer was checked (the opposite of
// AttendanceActionDrawer's drawer chrome, which was shared and got
// promoted OUT to components/ui/ instead): ComposerAttachmentStrip,
// GenerationState, ScopeToggle, ThinkingLevelToggle, CollapsibleContent,
// SourcePreviewDrawer, AttachmentManager, useComposerAttachments.
export { AIComposer } from './components/AIComposer';
export { ChatHeader } from './components/ChatHeader';
export { ChatMessage } from './components/ChatMessage';
export { ChatWorkspace, ChatTranscriptScrollArea, ChatComposerDock, CHAT_GUTTER } from './components/ChatWorkspace';
export { SourcesWidget, SourcesTrigger } from './components/SourcesPopover';
// Same 4 consumers as AIComposer (HomeView, ProjectDetail, ArtifactEditor,
// ChatView) — moved here alongside it rather than staying in flat store/,
// since it's a mechanical move (identical consumer set), not a new
// taxonomy decision.
export { ComposerProvider, composerScope, isEmptyComposer, useComposer } from './store/ComposerProvider';
