import { api } from './client';

export const studentsApi = {
  list: (params) => api.get(`/students${params ? `?${new URLSearchParams(params)}` : ''}`),
};
