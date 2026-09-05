import { api } from './client';

// ARCNAVE modernization P0 (PDF 5.1 / clash C6): refresh/logout no
// longer take a refreshToken argument — it travels as an httpOnly
// cookie the browser attaches automatically (api/client.js's
// `credentials: 'include'`), never touched by this module's own code.
export const authApi = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  verifyMfa: (challengeId, code) => api.post('/auth/mfa/verify', { challenge_id: challengeId, code }),
  resendMfa: (challengeId) => api.post('/auth/mfa/resend', { challenge_id: challengeId }),
  refresh: () => api.post('/auth/refresh'),
  logout: () => api.post('/auth/logout'),
  requestPasswordReset: (email) => api.post('/auth/password-reset', { email }),
  confirmPasswordReset: (token, newPassword) =>
    api.post('/auth/password-reset/confirm', { token, new_password: newPassword }),
  me: () => api.get('/auth/me'),
};
