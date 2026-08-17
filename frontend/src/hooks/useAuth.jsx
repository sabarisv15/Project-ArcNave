import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { authApi } from '@/api/auth';
import { hasPermission } from '@/lib/permissions';
import {
  setAccessToken, setRefreshToken, getRefreshToken, decodeJwt, clearSession,
} from '@/lib/authStorage';

const AuthContext = createContext(null);

function claimsFromToken(accessToken) {
  const claims = decodeJwt(accessToken);
  if (!claims) return null;
  return { userId: claims.sub, collegeId: claims.college_id, role: claims.role };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);

  const applyTokens = useCallback((tokens) => {
    setAccessToken(tokens.access_token);
    setRefreshToken(tokens.refresh_token);
    setUser(claimsFromToken(tokens.access_token));
  }, []);

  const login = useCallback(async (username, password) => {
    const result = await authApi.login(username, password);
    if (result.mfa_required) {
      return { mfaRequired: true, challengeId: result.challenge_id };
    }
    applyTokens(result);
    return { mfaRequired: false };
  }, [applyTokens]);

  const verifyMfa = useCallback(async (challengeId, code) => {
    const result = await authApi.verifyMfa(challengeId, code);
    applyTokens(result);
  }, [applyTokens]);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    try {
      await authApi.logout(refreshToken);
    } finally {
      clearSession();
      setUser(null);
    }
  }, []);

  const restoreSession = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      setSessionReady(true);
      return;
    }
    try {
      const tokens = await authApi.refresh(refreshToken);
      applyTokens(tokens);
    } catch {
      clearSession();
      setUser(null);
    } finally {
      setSessionReady(true);
    }
  }, [applyTokens]);

  const can = useCallback((permission) => hasPermission(user?.role, permission), [user]);

  const value = useMemo(() => ({
    user, isAuthenticated: Boolean(user), sessionReady, login, verifyMfa, logout, restoreSession, can,
  }), [user, sessionReady, login, verifyMfa, logout, restoreSession, can]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
