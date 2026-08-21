// Real-backend replacements for the three list fetchers mockApi.js used to
// fake (fetchChats/fetchProjects/fetchArtifacts). Each adapts the backend's
// real row shape (snake_case, conversations/projects/artifacts tables) onto
// the exact field names the D-drive UI components already read
// (Recents/ProjectCard/ArtifactCard etc.) — see lib/mockData.js for the
// shape being matched. sendMessage's AI reply generation is a separate,
// deliberately unwired piece — see WorkspaceProvider.jsx's own note.
import { conversationsApi } from '@/api/conversations';
import { projectsApi } from '@/api/projects';
import { artifactsApi } from '@/api/artifacts';
import { relativeTime } from './messageTime';

export async function fetchChatsReal() {
  const rows = await conversationsApi.list({ limit: 100 });
  const list = Array.isArray(rows) ? rows : (rows?.conversations ?? []);
  return list.map((c) => ({
    id: String(c.id),
    title: c.title,
    kind: c.project_id ? 'project' : 'chat',
    project: c.project_name ?? undefined,
    projectId: c.project_id ? String(c.project_id) : undefined,
    meta: relativeTime(c.updated_at || c.created_at),
  }));
}

export async function fetchProjectsReal() {
  const rows = await projectsApi.list();
  const list = Array.isArray(rows) ? rows : (rows?.projects ?? []);
  return list.map((p) => ({
    id: String(p.id),
    title: p.name,
    desc: p.instructions || 'No description yet.',
    updated: `Updated ${relativeTime(p.updated_at || p.created_at)}`,
    count: `${p.document_count ?? 0} files`,
    pinned: Boolean(p.pinned),
  }));
}

export async function fetchArtifactsReal() {
  const rows = await artifactsApi.list();
  const list = Array.isArray(rows) ? rows : (rows?.artifacts ?? []);
  return list.map((a) => ({
    id: String(a.id),
    title: a.title,
    type: a.artifact_type || 'Document',
    edited: `Edited ${relativeTime(a.updated_at || a.created_at)}`,
    link: a.conversation_title || '',
    // artifactRepository's LIST_COLUMNS already returns this — WorkspaceProvider
    // seeds `artConv` (artifactId -> conversationId) from it so ArtifactEditor's
    // revision chat re-opens on reload, not just for the current browser session.
    conversationId: a.conversation_id ? String(a.conversation_id) : null,
    // 'draft' | 'published' — ArtifactEditor uses this to swap the Export
    // action for a settled "Exported" state, mirroring assertNotPublished
    // (artifactService.js): a published artifact can't be published again.
    status: a.status,
  }));
}
