import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AuthContext } from '@/hooks/useAuth';
import { documentsApi } from '@/api/documents';
import { useDocumentsStore } from './useDocumentsStore';
import { PERSONAL_ROOT } from '../lib/documentsData';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('@/api/documents', () => ({
  documentsApi: {
    listPersonalFolders: vi.fn(),
    listPersonalDocuments: vi.fn(),
    createPersonalFolder: vi.fn(),
    renamePersonalFolder: vi.fn(),
    renamePersonalDocument: vi.fn(),
    movePersonalFolder: vi.fn(),
    movePersonalDocument: vi.fn(),
    removePersonalFolder: vi.fn(),
    removeDocument: vi.fn(),
    duplicatePersonalDocument: vi.fn(),
    uploadPersonalDocument: vi.fn(),
  },
}));

// P3 5.9 — direct tests for the React Query rewrite of DocumentsProvider.
//
// These exist because the migration replaced the entire fetch/mutation
// layer (hand-rolled useState + a `refresh()` after every write) with
// queries and invalidation, and nothing covered it: documents.test.js
// only exercises the pure documentsData helpers. The assertions below
// deliberately target the behaviours that the rewrite could plausibly
// have broken, not the parts that merely moved.

const FOLDERS = [
  { id: 'f1', name: 'Semester 5', parent_id: null, created_at: '2026-01-01T00:00:00Z', owner_user_id: 'u1' },
  { id: 'f2', name: 'Labs', parent_id: 'f1', created_at: '2026-01-02T00:00:00Z', owner_user_id: 'u1' },
];
const DOCUMENTS = [
  {
    id: 'd1',
    file_name: 'syllabus.pdf',
    mime_type: 'application/pdf',
    file_size_bytes: 1024,
    created_at: '2026-01-03T00:00:00Z',
    updated_at: '2026-01-04T00:00:00Z',
    uploaded_by_user_id: 'u1',
    folder_name: 'Semester 5',
  },
  {
    id: 'd2',
    file_name: 'loose-note.txt',
    mime_type: 'text/plain',
    file_size_bytes: 12,
    created_at: '2026-01-05T00:00:00Z',
    updated_at: null,
    uploaded_by_user_id: 'u1',
    folder_name: null,
  },
];

const authValue = {
  user: { userId: 'u1', collegeId: 'c1', role: 'teaching_staff' },
  isAuthenticated: true,
  sessionReady: true,
  login: async () => {},
  verifyMfa: async () => {},
  logout: async () => {},
  restoreSession: async () => {},
  can: () => true,
};

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
    </QueryClientProvider>
  );
}

async function mountLoaded() {
  const hook = renderHook(() => useDocumentsStore(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  documentsApi.listPersonalFolders.mockResolvedValue(FOLDERS);
  documentsApi.listPersonalDocuments.mockResolvedValue(DOCUMENTS);
});

describe('useDocumentsStore — loading and shape', () => {
  it('reports loading until BOTH lists have resolved', async () => {
    let releaseDocuments;
    documentsApi.listPersonalDocuments.mockReturnValue(
      new Promise((resolve) => {
        releaseDocuments = () => resolve(DOCUMENTS);
      }),
    );

    const { result } = renderHook(() => useDocumentsStore(), { wrapper });
    expect(result.current.loading).toBe(true);

    // Folders alone are not enough — `nodes` is only coherent once both
    // are in, so a half-loaded tree must never render.
    await waitFor(() => expect(documentsApi.listPersonalFolders).toHaveBeenCalled());
    expect(result.current.loading).toBe(true);

    await act(async () => {
      releaseDocuments();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('maps folders and documents into one node list', async () => {
    const { result } = await mountLoaded();
    expect(result.current.nodes).toHaveLength(FOLDERS.length + DOCUMENTS.length);

    const folder = result.current.nodes.find((n) => n.id === 'f1');
    expect(folder.kind).toBe('folder');
    expect(folder.parentId).toBe(PERSONAL_ROOT);

    const nested = result.current.nodes.find((n) => n.id === 'f2');
    expect(nested.parentId).toBe('f1');
  });

  it('resolves a document to its folder by NAME, not id', async () => {
    // documents.folder_name is a plain text match with no FK (see the
    // backend migration) — this mapping is the only thing bridging it to
    // the id-based tree the UI renders.
    const { result } = await mountLoaded();
    expect(result.current.nodes.find((n) => n.id === 'd1').parentId).toBe('f1');
    expect(result.current.nodes.find((n) => n.id === 'd2').parentId).toBe(PERSONAL_ROOT);
  });

  it('childrenOf scopes to one parent', async () => {
    const { result } = await mountLoaded();
    expect(
      result.current
        .childrenOf('f1')
        .map((n) => n.id)
        .sort(),
    ).toEqual(['d1', 'f2']);
  });

  it('tolerates a non-array response without crashing the tree', async () => {
    documentsApi.listPersonalFolders.mockResolvedValue(null);
    documentsApi.listPersonalDocuments.mockResolvedValue(undefined);
    const { result } = await mountLoaded();
    expect(result.current.nodes).toEqual([]);
  });
});

describe('useDocumentsStore — mutations refetch through invalidation', () => {
  it('creating a folder refetches both lists instead of hand-rolling a refresh', async () => {
    const { result } = await mountLoaded();
    documentsApi.createPersonalFolder.mockResolvedValue({
      id: 'f3',
      name: 'New',
      parent_id: null,
      created_at: '2026-02-01T00:00:00Z',
      owner_user_id: 'u1',
    });

    await act(async () => {
      await result.current.createFolder(PERSONAL_ROOT, 'New');
    });

    expect(documentsApi.createPersonalFolder).toHaveBeenCalledWith({ name: 'New', parentId: null });
    await waitFor(() => expect(documentsApi.listPersonalFolders).toHaveBeenCalledTimes(2));
  });

  it('refuses an empty folder name without touching the network', async () => {
    const { result } = await mountLoaded();
    let created;
    await act(async () => {
      created = await result.current.createFolder(PERSONAL_ROOT, '   ');
    });
    expect(created).toBeNull();
    expect(documentsApi.createPersonalFolder).not.toHaveBeenCalled();
  });

  it('renames a folder and a file through their own endpoints', async () => {
    const { result } = await mountLoaded();
    documentsApi.renamePersonalFolder.mockResolvedValue({});
    documentsApi.renamePersonalDocument.mockResolvedValue({});

    await act(async () => {
      await result.current.rename('f1', 'Semester 6');
    });
    expect(documentsApi.renamePersonalFolder).toHaveBeenCalledWith('f1', 'Semester 6');

    await act(async () => {
      await result.current.rename('d1', 'new.pdf');
    });
    expect(documentsApi.renamePersonalDocument).toHaveBeenCalledWith('d1', 'new.pdf');
  });

  it('reports a failed rename as false rather than throwing', async () => {
    const { result } = await mountLoaded();
    documentsApi.renamePersonalFolder.mockRejectedValue({ detail: 'taken' });

    let ok;
    await act(async () => {
      ok = await result.current.rename('f1', 'Labs');
    });
    expect(ok).toBe(false);
  });

  it('moves a file by folder NAME and a folder by parent id', async () => {
    const { result } = await mountLoaded();
    documentsApi.movePersonalDocument.mockResolvedValue({});
    documentsApi.movePersonalFolder.mockResolvedValue({});

    await act(async () => {
      await result.current.move('d2', 'f1');
    });
    expect(documentsApi.movePersonalDocument).toHaveBeenCalledWith('d2', 'Semester 5');

    await act(async () => {
      await result.current.move('f2', PERSONAL_ROOT);
    });
    expect(documentsApi.movePersonalFolder).toHaveBeenCalledWith('f2', null);
  });

  it('refuses to move a folder into its own descendant, without a round trip', async () => {
    // The cycle check must stay client-side and BEFORE the request —
    // this is the one validation the server is not asked to make.
    const { result } = await mountLoaded();
    let ok;
    await act(async () => {
      ok = await result.current.move('f1', 'f2');
    });
    expect(ok).toBe(false);
    expect(documentsApi.movePersonalFolder).not.toHaveBeenCalled();
  });

  it('only duplicates files, never folders', async () => {
    const { result } = await mountLoaded();
    await act(async () => {
      await result.current.duplicate('f1');
    });
    expect(documentsApi.duplicatePersonalDocument).not.toHaveBeenCalled();

    documentsApi.duplicatePersonalDocument.mockResolvedValue({});
    await act(async () => {
      await result.current.duplicate('d1');
    });
    expect(documentsApi.duplicatePersonalDocument).toHaveBeenCalledWith('d1');
  });

  it('returns the count actually deleted when one of several fails', async () => {
    const { result } = await mountLoaded();
    documentsApi.removeDocument.mockImplementation((id) =>
      id === 'd1' ? Promise.resolve({}) : Promise.reject(new Error('nope')),
    );

    let count;
    await act(async () => {
      count = await result.current.remove(['d1', 'd2']);
    });
    expect(count).toBe(1);
  });

  it('does not refetch when nothing was deleted', async () => {
    const { result } = await mountLoaded();
    documentsApi.removeDocument.mockRejectedValue(new Error('nope'));
    const callsBefore = documentsApi.listPersonalDocuments.mock.calls.length;

    await act(async () => {
      await result.current.remove(['d1']);
    });
    expect(documentsApi.listPersonalDocuments.mock.calls.length).toBe(callsBefore);
  });
});

describe('useDocumentsStore — failure surface', () => {
  it('surfaces a failed initial load rather than silently showing an empty tree', async () => {
    documentsApi.listPersonalFolders.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDocumentsStore(), { wrapper });

    await waitFor(() => expect(result.current.loadError).toBeTruthy());
    expect(result.current.nodes).toEqual([]);
  });
});
