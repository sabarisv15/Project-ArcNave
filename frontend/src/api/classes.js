import { api } from './client';

export const classesApi = {
  list: ({ limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', limit);
    if (offset !== undefined) params.set('offset', offset);
    const qs = params.toString();
    return api.get(`/classes${qs ? `?${qs}` : ''}`);
  },
  get: (id) => api.get(`/classes/${id}`),
};
