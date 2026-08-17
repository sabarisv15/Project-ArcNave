import { api } from './client';

export const authApi = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  verifyMfa: (challengeId, code) => api.post('/auth/mfa/verify', { challenge_id: challengeId, code }),
  resendMfa: (challengeId) => api.post('/auth/mfa/resend', { challenge_id: challengeId }),
  refresh: (refreshToken) => api.post('/auth/refresh', { refresh_token: refreshToken }),
  logout: (refreshToken) => api.post('/auth/logout', { refresh_token: refreshToken }),
  requestPasswordReset: (email) => api.post('/auth/password-reset', { email }),
  confirmPasswordReset: (token, newPassword) =>
    api.post('/auth/password-reset/confirm', { token, new_password: newPassword }),
  me: () => api.get('/auth/me'),
};
