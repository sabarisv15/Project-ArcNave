import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { documentsApi } from '@/api/documents';
import { PERSONAL_ROOT, canMoveInto, uniqueName } from '../lib/documentsData';

// P3 5.9 — the SERVER-state half of "context -> a proper small state
// library". Attendance was the client-state half (Zustand, purely local
// fixture data); this is the other one, and it is where React Query
// actually earns its place.
//
// What DocumentsProvider was doing by hand, and what replaces it:
//
//   * `useState` for folders/documents/loading, plus a `refresh()` that
//     re-fetched BOTH lists, plus a mount effect with a `cancelled` flag
//     to avoid setting state after unmount.
//     -> two `useQuery` calls. Cancellation, staleness and dedupe are
//        the library's job, not hand-written bookkeeping.
//
//   * every mutation ending in `await refresh()`, i.e. two full network
//     round trips after every rename/move/delete/upload, unconditionally.
//     -> `invalidateQueries`. Same guarantee (the UI reflects the server),
//        but refetching is decided once, in one place, and a mutation no
//        longer has to remember to do it.
//
// react-query has been a dependency and wrapped at main.jsx this whole
// time with ZERO hooks using it — this is the first place it does real
// work, which is exactly the gap 5.9 exists to close.
//
// The public hook keeps its name and its returned shape, so
// PersonalDocuments.jsx and DocumentsView.jsx are untouched by this.

export const documentKeys = {
  folders: ['personal-folders'],
  documents: ['personal-documents'],
};

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
 * InstitutionalDocuments.jsx, which needs real server-side filtering on
 * academic-year/category/department facets this store has no reason to
 * hold.)
 *
 * Every read/write goes through the real backend
 * (api/documents.js -> backend/src/routes/documents.js): personal
 * folders nest (parent_id) and support rename/move, personal documents
 * support rename/move/duplicate, and delete is permanently gone once
 * confirmed — the backend soft-deletes the row, but there is no restore
 * endpoint yet, so this UI never claims otherwise (no Undo toast).
 */
export function useDocumentsStore() {
  const { user } = useAuth();
  const qc = useQueryClient();
  // Upload progress is genuinely local, transient UI state — it has no
  // server representation to cache, so it stays plain component state
  // rather than being forced into either library.
  const [uploads, setUploads] = useState([]);

  // Deliberately NOT gated on isAuthenticated, unlike WorkspaceProvider's
  // own queries. That gate exists there because those queries mount on
  // the pre-login shell and would sit permanently 401'd. This store is
  // only ever reached inside /curriculum/documents, i.e. already behind
  // ProtectedRoute — adding a gate here would buy nothing and introduce a
  // real failure mode, since a never-enabled query stays `isPending`
  // forever and `loading` below would pin the UI on a spinner.
  //
  // Wrapped in arrow functions rather than passed by reference: React
  // Query calls queryFn with a context argument, and these api helpers
  // take their own parameters.
  const foldersQuery = useQuery({
    queryKey: documentKeys.folders,
    queryFn: () => documentsApi.listPersonalFolders(),
  });
  const documentsQuery = useQuery({
    queryKey: documentKeys.documents,
    queryFn: () => documentsApi.listPersonalDocuments(),
  });

  const folders = useMemo(
    () => (Array.isArray(foldersQuery.data) ? foldersQuery.data : []),
    [foldersQuery.data],
  );
  const documents = useMemo(
    () => (Array.isArray(documentsQuery.data) ? documentsQuery.data : []),
    [documentsQuery.data],
  );

  const invalidate = useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: documentKeys.folders }),
        qc.invalidateQueries({ queryKey: documentKeys.documents }),
      ]),
    [qc],
  );

  const anyLoadFailed = Boolean(foldersQuery.error || documentsQuery.error);

  const nodes = useMemo(() => {
    // All-or-nothing on purpose. The provider fetched both lists with a
    // single Promise.all, so one failure left BOTH empty. Two independent
    // queries would instead render whatever arrived — and a folders
    // failure is the bad case: every document maps to PERSONAL_ROOT when
    // the folder map is empty, so files that live in folders would appear
    // at the root as though they were unfiled. Showing nothing is the
    // honest answer, and it is what this UI already did.
    if (anyLoadFailed) return [];
    const folderNameToId = new Map(folders.map((f) => [f.name, f.id]));
    return [...folders.map(folderToNode), ...documents.map((d) => documentToNode(d, folderNameToId))];
  }, [folders, documents, anyLoadFailed]);

  const personal = nodes; // already scoped server-side to the acting user
  const childrenOf = useCallback((parentId) => personal.filter((n) => n.parentId === parentId), [personal]);

  const folderNameOf = useCallback(
    (folderId) => (folderId === PERSONAL_ROOT ? null : (folders.find((f) => f.id === folderId)?.name ?? null)),
    [folders],
  );

  const createFolderMutation = useMutation({
    mutationFn: ({ parentId, name }) =>
      documentsApi.createPersonalFolder({ name, parentId: parentId === PERSONAL_ROOT ? null : parentId }),
    onSuccess: invalidate,
  });

  const createFolder = useCallback(
    async (parentId, name) => {
      const clean = (name || '').trim();
      if (!clean) return null;
      try {
        const created = await createFolderMutation.mutateAsync({ parentId, name: clean });
        return folderToNode(created);
      } catch (err) {
        toast(err?.detail || 'Could not create that folder — the name may already be taken.');
        return null;
      }
    },
    [createFolderMutation],
  );

  const renameMutation = useMutation({
    mutationFn: ({ node, name }) =>
      node.kind === 'folder'
        ? documentsApi.renamePersonalFolder(node.id, name)
        : documentsApi.renamePersonalDocument(node.id, name),
    onSuccess: invalidate,
  });

  const rename = useCallback(
    async (id, name) => {
      const clean = (name || '').trim();
      if (!clean) return false;
      const node = nodes.find((n) => n.id === id);
      if (!node) return false;
      try {
        await renameMutation.mutateAsync({ node, name: clean });
        return true;
      } catch (err) {
        toast(err?.detail || 'Could not rename that — the name may already be taken.');
        return false;
      }
    },
    [nodes, renameMutation],
  );

  const moveMutation = useMutation({
    mutationFn: ({ node, targetFolderId }) =>
      node.kind === 'folder'
        ? documentsApi.movePersonalFolder(node.id, targetFolderId === PERSONAL_ROOT ? null : targetFolderId)
        : documentsApi.movePersonalDocument(node.id, folderNameOf(targetFolderId)),
    onSuccess: invalidate,
  });

  const move = useCallback(
    async (id, targetFolderId) => {
      const node = nodes.find((n) => n.id === id);
      // Cycle check stays client-side and BEFORE the request: moving a
      // folder into its own descendant is refused without a round trip.
      if (!node || !canMoveInto(personal, id, targetFolderId)) return false;
      try {
        await moveMutation.mutateAsync({ node, targetFolderId });
        toast('Moved');
        return true;
      } catch (err) {
        toast(err?.detail || 'Could not move that item.');
        return false;
      }
    },
    [nodes, personal, moveMutation],
  );

  const duplicateMutation = useMutation({
    mutationFn: (id) => documentsApi.duplicatePersonalDocument(id),
    onSuccess: invalidate,
  });

  const duplicate = useCallback(
    async (id) => {
      const node = nodes.find((n) => n.id === id);
      if (!node || node.kind !== 'file') return;
      try {
        await duplicateMutation.mutateAsync(id);
      } catch {
        toast('Could not duplicate that file.');
      }
    },
    [nodes, duplicateMutation],
  );

  /**
   * Permanent once confirmed — the backend soft-deletes the row (a
   * folder delete cascades to its subfolders), but there is no restore
   * endpoint yet, so no Undo is offered here. The confirm dialog
   * (PersonalDocuments.jsx) says exactly this before the call is made.
   *
   * Deletes stay sequential and per-item, exactly as before: each one
   * reports its own failure by name, and a partial success still
   * refetches and reports the count that did land.
   */
  const remove = useCallback(
    async (ids) => {
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
        await invalidate();
        toast(`${count} item${count > 1 ? 's' : ''} deleted`);
      }
      return count;
    },
    [nodes, invalidate],
  );

  const upload = useCallback(
    (parentId, files) => {
      const list = Array.from(files || []);
      if (!list.length) return;
      const folderName = folderNameOf(parentId);
      list.forEach((file) => {
        const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setUploads((prev) => [
          ...prev,
          { id, name: file.name, size: file.size, parentId, progress: 40, status: 'uploading' },
        ]);
        documentsApi
          .uploadPersonalDocument({ file, folderName })
          .then(async () => {
            await invalidate();
            setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: 'done', progress: 100 } : u)));
            setTimeout(() => setUploads((prev) => prev.filter((u) => u.id !== id)), 1600);
          })
          .catch(() => {
            setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, status: 'failed' } : u)));
          });
      });
    },
    [folderNameOf, invalidate],
  );

  const dismissUpload = useCallback((id) => setUploads((prev) => prev.filter((u) => u.id !== id)), []);

  // The provider surfaced a single `loading` flag, and callers still get
  // exactly that. It stays true until BOTH lists have resolved, because
  // `nodes` is only coherent once folders and documents are both in —
  // rendering half of a tree would be worse than a moment more spinner.
  const loading = foldersQuery.isPending || documentsQuery.isPending;

  // A failed initial load surfaced as a toast from the provider's mount
  // effect. React Query owns the error state now, but the user-visible
  // behaviour must not quietly disappear — so the toast still fires,
  // once per transition into a failed state rather than once per render.
  const loadError = foldersQuery.error || documentsQuery.error || null;
  const reportedError = useRef(null);
  useEffect(() => {
    if (loadError && reportedError.current !== loadError) {
      reportedError.current = loadError;
      toast('Could not load your documents — please try again.');
    } else if (!loadError) {
      reportedError.current = null;
    }
  }, [loadError]);

  return {
    me: user,
    root: PERSONAL_ROOT,
    loading,
    loadError,
    personal,
    nodes,
    childrenOf,
    createFolder,
    rename,
    move,
    duplicate,
    remove,
    uploads,
    upload,
    dismissUpload,
  };
}

// uniqueName is still useful client-side (a fast, optimistic "this name
// is probably taken" hint before the round trip) even though the server
// is the real authority — re-exported so callers don't need a second
// import from documentsData.js just for this.
export { uniqueName };
