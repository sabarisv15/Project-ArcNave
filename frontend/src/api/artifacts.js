import { api } from './client';

export const artifactsApi = {
  list: () => api.get('/artifacts'),
  get: (id) => api.get(`/artifacts/${id}`),
  listVersions: (id) => api.get(`/artifacts/${id}/versions`),
  create: ({ title, content, conversationId, sourceMessageId }) => api.post('/artifacts', {
    title, content, conversation_id: conversationId, source_message_id: sourceMessageId,
  }),
  update: (id, { title, content }) => api.put(`/artifacts/${id}`, { title, content }),
  remove: (id) => api.delete(`/artifacts/${id}`),
  publish: (id) => api.post(`/artifacts/${id}/publish`),
};
