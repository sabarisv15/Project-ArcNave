import { api } from './client';

export const conversationsApi = {
  list: ({ projectId, search, archived, limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (projectId !== undefined) params.set('project_id', projectId);
    if (search) params.set('search', search);
    if (archived !== undefined) params.set('archived', archived);
    if (limit !== undefined) params.set('limit', limit);
    if (offset !== undefined) params.set('offset', offset);
    const qs = params.toString();
    return api.get(`/conversations${qs ? `?${qs}` : ''}`);
  },
  create: ({ title, projectId }) => api.post('/conversations', { title, project_id: projectId }),
  update: (id, { title, projectId, pinned, archived }) => api.put(`/conversations/${id}`, {
    title, project_id: projectId, pinned, archived,
  }),
  remove: (id) => api.delete(`/conversations/${id}`),
  listMessages: (conversationId) => api.get(`/conversations/${conversationId}/messages`),
  addMessage: (conversationId, {
    role, content, toolUsed, toolParams, presentation, rawData, parentMessageId,
  }) => api.post(`/conversations/${conversationId}/messages`, {
    role, content, tool_used: toolUsed, tool_params: toolParams,
    presentation, raw_data: rawData, parent_message_id: parentMessageId,
  }),
};
