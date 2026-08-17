import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  INSTITUTIONAL_DOCS, ME, PERSONAL_ROOT,
  assertScope, canMoveInto, canMutate, initialPersonalNodes, uniqueName,
} from '../lib/documentsData';

const DocumentsContext = createContext(null);

/**
 * Documents state for `/curriculum/documents`.
 *
 * Every mutation goes through `canMutate()` here, not just in the UI, so an
 * institutional document stays read-only even if a stale screen (or a direct
 * call) tries to rename or delete one. The institutional list is exposed as a
 * frozen read-only array for the same reason.
 *
 * Deletes move to trash rather than destroying anything, and the restore path
 * is offered in the same quiet toast — the one destructive-looking action in
 * the module is recoverable by construction.
 *
 * Mock-data caveat, deliberately explicit: this is client state. The real API
 * must re-apply ownership and institutional-publish rights server-side.
 */
export function DocumentsProvider({ children }) {
  const [nodes, setNodes] = useState(() => initialPersonalNodes());
  const [uploads, setUploads] = useState([]); // { id, name, progress, status: 'uploading'|'failed'|'done', parentId, size }

  const institutional = useMemo(() => assertScope(INSTITUTIONAL_DOCS, 'institutional'), []);
  const personal = useMemo(() => assertScope(nodes, 'personal').filter((n) => !n.trashed), [nodes]);
  const trashed = useMemo(() => nodes.filter((n) => n.trashed), [nodes]);

  const childrenOf = useCallback(
    (parentId) => personal.filter((n) => n.parentId === parentId),
    [personal]
  );

  const createFolder = useCallback((parentId, name) => {
    const clean = (name || '').trim();
    if (!clean) return null;
    let created = null;
    setNodes((prev) => {
      const siblings = prev.filter((n) => n.parentId === parentId && !n.trashed);
      const now = new Date();
      created = {
        id: `p-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
        parentId, kind: 'folder', name: uniqueName(siblings, clean),
        mimeType: null, size: null,
        createdAt: now, updatedAt: now,
        ownerId: ME.id, trashed: false, scope: 'personal',
      };
      return [...prev, created];
    });
    return created;
  }, []);

  const rename = useCallback((id, name) => {
    const clean = (name || '').trim();
    if (!clean) return false;
    let ok = false;
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n;
        if (!canMutate(n)) return n; // institutional / not owned — refused here, not just hidden
        ok = true;
        const siblings = prev.filter((s) => s.parentId === n.parentId && s.id !== id && !s.trashed);
        return { ...n, name: uniqueName(siblings, clean), updatedAt: new Date() };
      })
    );
    return ok;
  }, []);

  const move = useCallback((id, targetFolderId) => {
    let ok = false;
    setNodes((prev) => {
      const node = prev.find((n) => n.id === id);
      if (!node || !canMutate(node) || !canMoveInto(prev, id, targetFolderId)) return prev;
      ok = true;
      const siblings = prev.filter((s) => s.parentId === targetFolderId && !s.trashed);
      return prev.map((n) =>
        n.id === id ? { ...n, parentId: targetFolderId, name: uniqueName(siblings, n.name), updatedAt: new Date() } : n
      );
    });
    if (ok) toast('Moved');
    return ok;
  }, []);

  const duplicate = useCallback((id) => {
    setNodes((prev) => {
      const node = prev.find((n) => n.id === id);
      if (!node || !canMutate(node) || node.kind !== 'file') return prev;
      const siblings = prev.filter((s) => s.parentId === node.parentId && !s.trashed);
      const now = new Date();
      return [...prev, {
        ...node,
        id: `p-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
        name: uniqueName(siblings, node.name),
        createdAt: now, updatedAt: now,
      }];
    });
  }, []);

  /** Delete is always recoverable: the node is trashed, and the toast offers Undo. */
  const remove = useCallback((ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    let count = 0;
    setNodes((prev) =>
      prev.map((n) => {
        if (!list.includes(n.id) || !canMutate(n)) return n;
        count += 1;
        return { ...n, trashed: true, trashedAt: new Date() };
      })
    );
    if (count) {
      toast(`${count} item${count > 1 ? 's' : ''} moved to Trash`, {
        action: {
          label: 'Undo',
          onClick: () => setNodes((prev) => prev.map((n) => (list.includes(n.id) ? { ...n, trashed: false } : n))),
        },
      });
    }
    return count;
  }, []);

  const restore = useCallback((id) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, trashed: false, trashedAt: null } : n)));
  }, []);

  /**
   * Upload with a visible, accessible progress row. A failed upload keeps its
   * row and its Retry action rather than vanishing — the file is still on the
   * user's disk, and silently dropping it would look like success.
   */
  const upload = useCallback((parentId, files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    list.forEach((f) => {
      const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setUploads((prev) => [...prev, { id, name: f.name, size: f.size, parentId, progress: 0, status: 'uploading' }]);

      let progress = 0;
      const tick = setInterval(() => {
        progress = Math.min(100, progress + 20 + Math.random() * 25);
        setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, progress: Math.round(progress) } : u)));
        if (progress >= 100) {
          clearInterval(tick);
          setNodes((prev) => {
            const siblings = prev.filter((s) => s.parentId === parentId && !s.trashed);
            const now = new Date();
            return [...prev, {
              id: `p-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
              parentId, kind: 'file',
              name: uniqueName(siblings, f.name),
              mimeType: f.type || 'application/octet-stream',
              size: f.size,
              createdAt: now, updatedAt: now,
              ownerId: ME.id, trashed: false, scope: 'personal',
            }];
          });
          setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: 'done', progress: 100 } : u)));
          setTimeout(() => setUploads((prev) => prev.filter((u) => u.id !== id)), 1600);
        }
      }, 220);
    });
  }, []);

  const dismissUpload = useCallback((id) => setUploads((prev) => prev.filter((u) => u.id !== id)), []);

  const value = useMemo(
    () => ({
      me: ME, root: PERSONAL_ROOT,
      institutional, personal, trashed, nodes,
      childrenOf, createFolder, rename, move, duplicate, remove, restore,
      uploads, upload, dismissUpload,
      canMutate,
    }),
    [institutional, personal, trashed, nodes, childrenOf, createFolder, rename, move, duplicate, remove, restore, uploads, upload, dismissUpload]
  );

  return <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>;
}

export function useDocumentsStore() {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error('useDocumentsStore must be used inside DocumentsProvider');
  return ctx;
}
