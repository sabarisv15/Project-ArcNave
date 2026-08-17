/**
 * Documents — two genuinely different things, kept apart by construction.
 *
 * **Institutional documents** are published by an authorised higher authority
 * (HOD, Principal, the coordination office). To an ordinary staff member they
 * are read-only: view, search, filter, preview, download. There is no upload,
 * rename, move, replace, delete or reorganise path for them anywhere in this
 * module — the actions are absent from the UI rather than shown disabled,
 * because a control a staff member can never use is noise, not information.
 *
 * **Personal documents** are the staff member's own private files and folders,
 * scoped to their user id. They are not visible to other staff.
 *
 * The two live in separate collections with separate shapes, so a document
 * cannot leak from one surface into the other by a forgotten filter: the
 * institutional list has no `ownerId` and the personal tree has no
 * `publishedBy`. `assertScope()` below is the belt-and-braces check.
 *
 * **This is mock data.** The real system must enforce all of this server-side —
 * a staff member's institutional read access, and personal-document ownership,
 * are authorization decisions, and hiding a button is not one. `canMutate()`
 * and `assertScope()` encode the rules the API has to apply for real.
 *
 * Shapes
 *  InstitutionalDoc { id, name, mimeType, category, folder, publishedAt: Date,
 *                     publishedBy, publisherRole, size, scope: 'institutional' }
 *  PersonalNode     { id, parentId, kind: 'folder'|'file', name, mimeType,
 *                     size, createdAt, updatedAt, ownerId, trashed,
 *                     scope: 'personal' }
 */

import { istMidnight, DAY_MS } from './ist';

export const ME = { id: 'staff-me', name: 'Priya Ramesh', role: 'Assistant Professor' };

export const PERSONAL_ROOT = 'root';

const today = istMidnight(new Date());
const daysAgo = (n) => new Date(today.getTime() - n * DAY_MS);

/** File kinds ArcNave shows an icon and a preview affordance for. */
export const FILE_KINDS = {
  pdf: { label: 'PDF', preview: true },
  doc: { label: 'Document', preview: true },
  sheet: { label: 'Spreadsheet', preview: false },
  slide: { label: 'Presentation', preview: false },
  image: { label: 'Image', preview: true },
  text: { label: 'Note', preview: true },
  other: { label: 'File', preview: false },
};

export function fileKind(mimeType = '') {
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'doc';
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'sheet';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'slide';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('text/')) return 'text';
  return 'other';
}

export function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Institutional — read-only for staff
// ---------------------------------------------------------------------------

export const INSTITUTIONAL_CATEGORIES = [
  'Circulars',
  'Academic policies',
  'Department notices',
  'Timetables',
  'Official forms',
  'Curriculum documents',
  'Meeting minutes',
  'Institutional templates',
];

const inst = (id, name, mimeType, category, folder, days, publishedBy, publisherRole, size) => ({
  id, name, mimeType, category, folder,
  publishedAt: daysAgo(days),
  publishedBy, publisherRole, size,
  scope: 'institutional',
});

export const INSTITUTIONAL_DOCS = [
  inst('inst-01', 'Semester fee circular — Odd 2026-27.pdf', 'application/pdf', 'Circulars', 'Administration', 3, 'Accounts Office', 'Institutional administrator', 284_000),
  inst('inst-02', 'Attendance policy — revision 4.pdf', 'application/pdf', 'Academic policies', 'Academic office', 11, 'Dr. S. Meenakshi', 'Principal', 412_000),
  inst('inst-03', 'Evaluation and re-evaluation policy.pdf', 'application/pdf', 'Academic policies', 'Academic office', 26, 'Dr. S. Meenakshi', 'Principal', 366_000),
  inst('inst-04', 'CSE department notice — lab rota.pdf', 'application/pdf', 'Department notices', 'Computer Science', 1, 'Dr. Anand Kumar', 'HOD, Computer Science', 118_000),
  inst('inst-05', 'Department meeting minutes — 02/08/2026.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Meeting minutes', 'Computer Science', 9, 'Dr. Anand Kumar', 'HOD, Computer Science', 96_000),
  inst('inst-06', 'Approved timetable — Odd 2026-27 (Revised v2).pdf', 'application/pdf', 'Timetables', 'Academic office', 5, 'Academic Coordinator', 'Institutional administrator', 502_000),
  inst('inst-07', 'Leave application form.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Official forms', 'Administration', 48, 'Establishment Section', 'Institutional administrator', 54_000),
  inst('inst-08', 'On-duty request form.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Official forms', 'Administration', 48, 'Establishment Section', 'Institutional administrator', 51_000),
  inst('inst-09', 'B.Sc Computer Science — syllabus 2026 regulation.pdf', 'application/pdf', 'Curriculum documents', 'Computer Science', 61, 'Dr. Anand Kumar', 'HOD, Computer Science', 1_840_000),
  inst('inst-10', 'Course outcome mapping template.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Institutional templates', 'Academic office', 34, 'IQAC', 'Institutional administrator', 78_000),
  inst('inst-11', 'Question paper format — internal exams.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Institutional templates', 'Academic office', 34, 'IQAC', 'Institutional administrator', 62_000),
  inst('inst-12', 'Academic calendar 2026-27.pdf', 'application/pdf', 'Academic policies', 'Academic office', 72, 'Academic Coordinator', 'Institutional administrator', 233_000),
  inst('inst-13', 'Internal assessment II — instruction circular.pdf', 'application/pdf', 'Circulars', 'Academic office', 2, 'Dr. S. Meenakshi', 'Principal', 141_000),
  inst('inst-14', 'Anti-ragging committee notice.pdf', 'application/pdf', 'Department notices', 'Administration', 19, 'Establishment Section', 'Institutional administrator', 88_000),
  inst('inst-15', 'Practical record format — CS labs.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Institutional templates', 'Computer Science', 40, 'Dr. Anand Kumar', 'HOD, Computer Science', 71_000),
  inst('inst-16', 'Faculty meeting minutes — 21/07/2026.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Meeting minutes', 'Academic office', 23, 'Academic Coordinator', 'Institutional administrator', 84_000),
];

export const INSTITUTIONAL_FOLDERS = [...new Set(INSTITUTIONAL_DOCS.map((d) => d.folder))].sort();

// ---------------------------------------------------------------------------
// Personal — owned by the signed-in staff member
// ---------------------------------------------------------------------------

const folder = (id, parentId, name, days) => ({
  id, parentId, kind: 'folder', name,
  mimeType: null, size: null,
  createdAt: daysAgo(days + 4), updatedAt: daysAgo(days),
  ownerId: ME.id, trashed: false, scope: 'personal',
});

const file = (id, parentId, name, mimeType, size, days) => ({
  id, parentId, kind: 'file', name, mimeType, size,
  createdAt: daysAgo(days + 2), updatedAt: daysAgo(days),
  ownerId: ME.id, trashed: false, scope: 'personal',
});

export function initialPersonalNodes() {
  return [
    folder('p-teaching', PERSONAL_ROOT, 'Teaching materials', 1),
    folder('p-sem3', 'p-teaching', 'Sem 3', 1),
    folder('p-sem5', 'p-teaching', 'Sem 5', 6),
    folder('p-question', PERSONAL_ROOT, 'Question banks', 4),
    folder('p-research', PERSONAL_ROOT, 'Research', 14),
    folder('p-admin', PERSONAL_ROOT, 'Admin copies', 8),

    file('p-f01', 'p-sem3', 'OS — unit 3 notes.pdf', 'application/pdf', 892_000, 1),
    file('p-f02', 'p-sem3', 'Process scheduling worked examples.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 143_000, 2),
    file('p-f03', 'p-sem3', 'Deadlock tutorial sheet.pdf', 'application/pdf', 221_000, 5),
    file('p-f04', 'p-sem5', 'DBMS — normalisation slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 2_410_000, 6),
    file('p-f05', 'p-sem5', 'SQL practice set.sql', 'text/plain', 12_000, 7),
    file('p-f06', 'p-question', 'Internal 1 — question bank.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 168_000, 4),
    file('p-f07', 'p-question', 'Model exam — draft paper.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 154_000, 3),
    file('p-f08', 'p-research', 'Paper draft — scheduling heuristics.pdf', 'application/pdf', 1_120_000, 14),
    file('p-f09', 'p-research', 'Experiment results.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 306_000, 16),
    file('p-f10', 'p-admin', 'Workload declaration (my copy).pdf', 'application/pdf', 98_000, 8),
    file('p-f11', PERSONAL_ROOT, 'Lab rota — my notes.txt', 'text/plain', 4_200, 0),
    file('p-f12', PERSONAL_ROOT, 'Class photo — II CS B.png', 'image/png', 1_640_000, 21),
  ];
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * The permission rule this module is built around. Institutional documents are
 * never mutable by an ordinary staff member; personal nodes are mutable only by
 * their owner. The UI hides what this refuses — it does not merely disable it.
 */
export function canMutate(node, userId = ME.id) {
  if (!node) return false;
  if (node.scope === 'institutional') return false;
  return node.ownerId === userId;
}

/** Guards a collection against the other scope's records ever appearing in it. */
export function assertScope(nodes, scope) {
  return nodes.filter((n) => n.scope === scope);
}

/** Breadcrumb trail from the personal root down to `folderId`, inclusive. */
export function pathTo(nodes, folderId) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const trail = [];
  let current = folderId;
  while (current && current !== PERSONAL_ROOT) {
    const node = byId.get(current);
    if (!node) break;
    trail.unshift(node);
    current = node.parentId;
  }
  return [{ id: PERSONAL_ROOT, name: 'Personal documents', kind: 'folder' }, ...trail];
}

/** Every descendant folder id of `folderId`, used to keep a move from creating a cycle. */
export function descendantIds(nodes, folderId) {
  const out = new Set();
  const walk = (id) => {
    nodes.filter((n) => n.parentId === id).forEach((child) => {
      out.add(child.id);
      if (child.kind === 'folder') walk(child.id);
    });
  };
  walk(folderId);
  return out;
}

/** A folder may not be moved into itself or into its own subtree. */
export function canMoveInto(nodes, nodeId, targetFolderId) {
  if (nodeId === targetFolderId) return false;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  if (node.parentId === targetFolderId) return false;
  if (node.kind !== 'folder') return true;
  return !descendantIds(nodes, nodeId).has(targetFolderId);
}

/** "Report.pdf" already taken → "Report (2).pdf". Keeps duplicate/upload from silently colliding. */
export function uniqueName(siblings, name) {
  const taken = new Set(siblings.map((s) => s.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}
