import { api } from './client';

export const artifactsApi = {
  list: () => api.get('/artifacts'),
  get: (id) => api.get(`/artifacts/${id}`),
  listVersions: (id) => api.get(`/artifacts/${id}/versions`),
  create: ({
    title, content, conversationId, sourceMessageId, artifactType,
  }) => api.post('/artifacts', {
    title, content, conversation_id: conversationId, source_message_id: sourceMessageId, artifact_type: artifactType,
  }),
  update: (id, { title, content, conversationId }) => api.put(`/artifacts/${id}`, {
    title, content, conversation_id: conversationId,
  }),
  remove: (id) => api.delete(`/artifacts/${id}`),
  publish: (id) => api.post(`/artifacts/${id}/publish`),
};
