import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { toast } from 'sonner';
import { useAuth } from '../hooks/useAuth';
import { documentsApi } from '../api/documents';
import { PERSONAL_ROOT, canMoveInto, uniqueName } from '../lib/documentsData';

const DocumentsContext = createContext(null);

function folderToNode(f) {
  return {
    id: f.id,
    parentId: f.parent_id ?? PERSONAL_ROOT,
    kind: 'folder',
    name: f.name,
    mimeType: null,
    size: null,
    createdAt: new Date(f.created_at),
    updatedAt: new Date(f.created_at),
    ownerId: f.owner_user_id,
    trashed: false,
    scope: 'personal',
  };
}

function documentToNode(d, folderNameToId) {
  return {
    id: d.id,
    parentId: d.folder_name ? (folderNameToId.get(d.folder_name) ?? PERSONAL_ROOT) : PERSONAL_ROOT,
    kind: 'file',
    name: d.file_name,
    mimeType: d.mime_type,
    size: d.file_size_bytes,
    createdAt: new Date(d.created_at),
    updatedAt: new Date(d.updated_at || d.created_at),
    ownerId: d.uploaded_by_user_id,
    trashed: false,
    scope: 'personal',
    // The real move-target for this file is a folder NAME (documents.
    // folder_name is a plain text match, no FK — see the backend
    // migration's own comment), not the id every other node uses for
    // its parent — kept alongside so move() below never has to re-look
    // it up.
    folderName: d.folder_name || null,
  };
}

/**
 * Documents state for `/curriculum/documents` — Personal tab only.
 * (Institutional documents are read-only and fetched directly by
 * InstitutionalDocuments.jsx, which needs real server-side filtering
 * or academic-year/category/department facets this provider has no
 * reason to hold.)
 *
 * Every read/write here goes through the real backend
 * (frontend/src/api/documents.js -> backend/src/routes/documents.js):
 * personal folders now nest (parent_id) and support rename/move,
 * personal documents support rename/move/duplicate, and delete is
 * permanently gone once confirmed — the backend soft-deletes the row,
 * but there is no restore endpoint yet, so this UI never claims
 * otherwise (no Undo toast, unlike the old mock).
 */
export function DocumentsProvider({ children }) {
  const { user } = useAuth();
  const [folders, setFolders] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploads, setUploads] = useState([]); // { id, name, parentId, status: 'uploading'|'failed'|'done', progress }

  const refresh = useCallback(async () => {
    const [folderRows, documentRows] = await Promise.all([
      documentsApi.listPersonalFolders(),
      documentsApi.listPersonalDocuments(),
    ]);
    setFolders(Array.isArray(folderRows) ? folderRows : []);
    setDocuments(Array.isArray(documentRows) ? documentRows : []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh()
      .catch(() => toast('Could not load your documents — please try again.'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  const nodes = useMemo(() => {
    const folderNameToId = new Map(folders.map((f) => [f.name, f.id]));
    return [
      ...folders.map(folderToNode),
      ...documents.map((d) => documentToNode(d, folderNameToId)),
    ];
  }, [folders, documents]);

  const personal = nodes; // already scoped server-side to the acting user
  const childrenOf = useCallback(
    (parentId) => personal.filter((n) => n.parentId === parentId),
    [personal]
  );

  const folderNameOf = useCallback(
    (folderId) => (folderId === PERSONAL_ROOT ? null : folders.find((f) => f.id === folderId)?.name ?? null),
    [folders]
  );

  const createFolder = useCallback(async (parentId, name) => {
    const clean = (name || '').trim();
    if (!clean) return null;
    try {
      const created = await documentsApi.createPersonalFolder({
        name: clean, parentId: parentId === PERSONAL_ROOT ? null : parentId,
      });
      await refresh();
      return folderToNode(created);
    } catch (err) {
      toast(err?.detail || 'Could not create that folder — the name may already be taken.');
      return null;
    }
  }, [refresh]);

  const rename = useCallback(async (id, name) => {
    const clean = (name || '').trim();
    if (!clean) return false;
    const node = nodes.find((n) => n.id === id);
    if (!node) return false;
    try {
      if (node.kind === 'folder') {
        await documentsApi.renamePersonalFolder(id, clean);
      } else {
        await documentsApi.renamePersonalDocument(id, clean);
      }
      await refresh();
      return true;
    } catch (err) {
      toast(err?.detail || 'Could not rename that — the name may already be taken.');
      return false;
    }
  }, [nodes, refresh]);

  const move = useCallback(async (id, targetFolderId) => {
    const node = nodes.find((n) => n.id === id);
    if (!node || !canMoveInto(personal, id, targetFolderId)) return false;
    try {
      if (node.kind === 'folder') {
        await documentsApi.movePersonalFolder(id, targetFolderId === PERSONAL_ROOT ? null : targetFolderId);
      } else {
        await documentsApi.movePersonalDocument(id, folderNameOf(targetFolderId));
      }
      await refresh();
      toast('Moved');
      return true;
    } catch (err) {
      toast(err?.detail || 'Could not move that item.');
      return false;
    }
  }, [nodes, personal, folderNameOf, refresh]);

  const duplicate = useCallback(async (id) => {
    const node = nodes.find((n) => n.id === id);
    if (!node || node.kind !== 'file') return;
    try {
      await documentsApi.duplicatePersonalDocument(id);
      await refresh();
    } catch {
      toast('Could not duplicate that file.');
    }
  }, [nodes, refresh]);

  /**
   * Permanent once confirmed — the backend soft-deletes the row (a
   * folder delete cascades to its subfolders), but there is no restore
   * endpoint yet, so no Undo is offered here. The confirm dialog
   * (PersonalDocuments.jsx) says exactly this before the call is made.
   */
  const remove = useCallback(async (ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    const targets = nodes.filter((n) => list.includes(n.id));
    let count = 0;
    for (const node of targets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        if (node.kind === 'folder') await documentsApi.removePersonalFolder(node.id);
        // eslint-disable-next-line no-await-in-loop
        else await documentsApi.removeDocument(node.id);
        count += 1;
      } catch {
        toast(`Could not delete “${node.name}”.`);
      }
    }
    if (count) {
      await refresh();
      toast(`${count} item${count > 1 ? 's' : ''} deleted`);
    }
    return count;
  }, [nodes, refresh]);

  const upload = useCallback((parentId, files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const folderName = folderNameOf(parentId);
    list.forEach((file) => {
      const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setUploads((prev) => [...prev, {
        id, name: file.name, size: file.size, parentId, progress: 40, status: 'uploading',
      }]);
      documentsApi.uploadPersonalDocument({ file, folderName })
        .then(async () => {
          await refresh();
          setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: 'done', progress: 100 } : u)));
          setTimeout(() => setUploads((prev) => prev.filter((u) => u.id !== id)), 1600);
        })
        .catch(() => {
          setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: 'failed' } : u)));
        });
    });
  }, [folderNameOf, refresh]);

  const dismissUpload = useCallback((id) => setUploads((prev) => prev.filter((u) => u.id !== id)), []);

  const value = useMemo(
    () => ({
      me: user, root: PERSONAL_ROOT, loading,
      personal, nodes,
      childrenOf, createFolder, rename, move, duplicate, remove,
      uploads, upload, dismissUpload,
    }),
    [user, loading, personal, nodes, childrenOf, createFolder, rename, move, duplicate, remove, uploads, upload, dismissUpload]
  );

  return <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>;
}

export function useDocumentsStore() {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error('useDocumentsStore must be used inside DocumentsProvider');
  return ctx;
}

// uniqueName is still useful client-side (a fast, optimistic "this name
// is probably taken" hint before the round trip) even though the
// server is the real authority now — re-exported so callers don't need
// a second import from documentsData.js just for this.
export { uniqueName };
