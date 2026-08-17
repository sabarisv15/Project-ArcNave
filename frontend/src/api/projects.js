import { api } from './client';

export const projectsApi = {
  list: () => api.get('/projects'),
  create: ({ name }) => api.post('/projects', { name }),
  rename: (id, { name }) => api.put(`/projects/${id}`, { name }),
  updateInstructions: (id, { instructions }) => api.put(`/projects/${id}`, { instructions }),
  setPinned: (id, { pinned }) => api.put(`/projects/${id}`, { pinned }),
  remove: (id) => api.delete(`/projects/${id}`),
  listDocuments: (id) => api.get(`/projects/${id}/documents`),
  attachDocument: (id, documentId) => api.post(`/projects/${id}/documents`, { document_id: documentId }),
  detachDocument: (id, documentId) => api.delete(`/projects/${id}/documents/${documentId}`),
};
