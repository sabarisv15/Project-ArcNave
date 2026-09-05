import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { authApi } from '@/api/auth';
import { hasPermission } from '@/lib/permissions';
import { setAccessToken, decodeJwt, clearSession } from '@/lib/authStorage';

// Exported so tests can supply a ready, authenticated auth value
// directly instead of driving the real AuthProvider through a mocked
// network refresh. Production code must always go through AuthProvider /
// useAuth below — nothing in src/ outside tests should import this.
export const AuthContext = createContext(null);

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
    setUser(claimsFromToken(tokens.access_token));
  }, []);

  const login = useCallback(
    async (username, password) => {
      const result = await authApi.login(username, password);
      if (result.mfa_required) {
        return { mfaRequired: true, challengeId: result.challenge_id };
      }
      applyTokens(result);
      return { mfaRequired: false };
    },
    [applyTokens],
  );

  const verifyMfa = useCallback(
    async (challengeId, code) => {
      const result = await authApi.verifyMfa(challengeId, code);
      applyTokens(result);
    },
    [applyTokens],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearSession();
      setUser(null);
    }
  }, []);

  // ARCNAVE modernization P0 (PDF 5.1 / clash C6): there is no
  // client-readable refresh token to check for anymore — the browser
  // either has the httpOnly cookie or it doesn't, and only the server
  // can tell which. Always attempt the refresh on load; a genuinely
  // logged-out browser (no cookie) just gets a clean 401, same
  // end state as the old "skip if absent" branch, one network round
  // trip earlier than before.
  const restoreSession = useCallback(async () => {
    try {
      const tokens = await authApi.refresh();
      applyTokens(tokens);
    } catch {
      clearSession();
      setUser(null);
    } finally {
      setSessionReady(true);
    }
  }, [applyTokens]);

  const can = useCallback((permission) => hasPermission(user?.role, permission), [user]);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      sessionReady,
      login,
      verifyMfa,
      logout,
      restoreSession,
      can,
    }),
    [user, sessionReady, login, verifyMfa, logout, restoreSession, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
