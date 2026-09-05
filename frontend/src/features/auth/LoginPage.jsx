import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { setCollegeCode } from '@/lib/authStorage';
import { ApiError } from '@/api/client';

export function LoginPage() {
  const { login, isAuthenticated, sessionReady } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collegeCode, setCollegeCodeInput] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (sessionReady && isAuthenticated) {
    return <Navigate to={location.state?.from?.pathname || '/'} replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (collegeCode) setCollegeCode(collegeCode.trim());
      const result = await login(username.trim(), password);
      if (result.mfaRequired) {
        setError('MFA is required for this account — MFA challenge screen is not wired in this build yet.');
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail || 'Login failed' : 'Could not reach the server');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-frame">
      <div className="w-full max-w-sm rounded-2xl border border-line-strong bg-raised p-8 shadow-dialog">
        <h1 className="text-lg font-semibold text-ink">Sign in to ArcNave</h1>
        <p className="mt-1 text-sm text-ink-muted">Wired to the live backend.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-soft" htmlFor="collegeCode">
              College code (optional)
            </label>
            <input
              id="collegeCode"
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              value={collegeCode}
              onChange={(e) => setCollegeCodeInput(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-soft" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-soft" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
