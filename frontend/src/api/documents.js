import { api, downloadFile } from './client';

/** File -> base64 (no data: prefix) — what every upload route here takes as file_base64. */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

export const documentsApi = {
  // --- Personal documents (Documents > Personal tab) ---------------
  listPersonalDocuments: () => api.get('/documents/personal'),
  listPersonalFolders: () => api.get('/documents/personal/folders'),
  createPersonalFolder: ({ name, parentId }) =>
    api.post('/documents/personal/folders', {
      name,
      parent_id: parentId ?? null,
    }),
  renamePersonalFolder: (id, name) => api.patch(`/documents/personal/folders/${id}`, { name }),
  movePersonalFolder: (id, parentId) => api.patch(`/documents/personal/folders/${id}`, { parent_id: parentId ?? null }),
  removePersonalFolder: (id) => api.delete(`/documents/personal/folders/${id}`),

  async uploadPersonalDocument({ file, folderName }) {
    const fileBase64 = await fileToBase64(file);
    return api.post('/documents/personal', {
      title: file.name,
      folder_name: folderName ?? null,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      file_base64: fileBase64,
    });
  },
  renamePersonalDocument: (id, fileName) =>
    api.patch(`/documents/personal/${id}`, { file_name: fileName, title: fileName }),
  movePersonalDocument: (id, folderName) => api.patch(`/documents/personal/${id}`, { folder_name: folderName ?? null }),
  duplicatePersonalDocument: (id) => api.post(`/documents/personal/${id}/duplicate`),

  // --- Institutional documents (Documents > Institutional tab, read-only) ---
  listInstitutionalDocuments: ({ categoryId, departmentId, academicYearId, search } = {}) => {
    const params = new URLSearchParams();
    if (categoryId) params.set('category_id', categoryId);
    if (departmentId) params.set('department_id', departmentId);
    if (academicYearId) params.set('academic_year_id', academicYearId);
    if (search) params.set('search', search);
    const qs = params.toString();
    return api.get(`/documents/institutional${qs ? `?${qs}` : ''}`);
  },
  listDocumentCategories: () => api.get('/document-categories'),
  listDepartments: () => api.get('/documents/institutional/departments'),

  // --- Shared -------------------------------------------------------
  removeDocument: (id) => api.delete(`/documents/${id}`),
  /** Streams the real bytes and triggers a browser save — client.js's own downloadFile. */
  download: (id, fallbackFileName) => downloadFile(`/documents/${id}/download`, fallbackFileName),
};
