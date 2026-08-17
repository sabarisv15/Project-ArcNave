import { api } from './client';

export const staffApi = {
  list: ({ limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', limit);
    if (offset !== undefined) params.set('offset', offset);
    const qs = params.toString();
    return api.get(`/staff${qs ? `?${qs}` : ''}`);
  },
  get: (id) => api.get(`/staff/${id}`),
  getOwnProfile: () => api.get('/staff/me'),
};
