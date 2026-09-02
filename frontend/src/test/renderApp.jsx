import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { AuthContext } from '@/hooks/useAuth';
import { WorkspaceProvider } from '@/store/WorkspaceProvider';
import { ComposerProvider } from '@/store/ComposerProvider';
import { hasPermission } from '@/lib/permissions';
import App from '@/App';

// P3 5.8 — one shared render helper, replacing a hand-copied `renderApp`
// in each of ~17 test files.
//
// Those copies had all drifted into the same real breakage: every one of
// them mounted WorkspaceProvider WITHOUT an AuthProvider above it. Once
// WorkspaceProvider started calling useAuth() (to gate its three real
// backend queries on isAuthenticated), every test rendering the full app
// threw "useAuth must be used within AuthProvider" before rendering
// anything — which is the bulk of this project's long-standing
// pre-existing frontend test failures. Fixing 17 copies independently
// would have re-created the same drift, so they now share this one.
//
// Auth is supplied as a context value rather than by driving the real
// AuthProvider through a mocked network refresh. ProtectedRoute gates on
// `sessionReady` AND `isAuthenticated`, and the real provider only sets
// sessionReady from restoreSession(), so a test using the real provider
// renders "Loading your session…" forever. Supplying the value directly
// is both simpler and more honest about what the test controls: these
// are UI/behaviour tests over the lib/*Data fixtures, not tests of the
// login handshake (auth flow has its own coverage).

const DEFAULT_USER = {
  userId: 'test-user',
  collegeId: 'test-college',
  role: 'teaching_staff',
};

export function buildAuthValue({ user = DEFAULT_USER, authenticated = true, sessionReady = true } = {}) {
  const resolvedUser = authenticated ? user : null;
  return {
    user: resolvedUser,
    isAuthenticated: Boolean(resolvedUser),
    sessionReady,
    login: async () => ({ mfaRequired: false }),
    verifyMfa: async () => {},
    logout: async () => {},
    restoreSession: async () => {},
    // Same real permission table production uses — a test must not get
    // a blanket "can do everything" that production would refuse.
    can: (permission) => hasPermission(resolvedUser?.role, permission),
  };
}

// `retry: false` so a failing query surfaces immediately instead of
// burning the test's timeout on react-query's default backoff.
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/**
 * Renders the whole app at `route` inside the full provider stack.
 *
 * The stack below is exactly what all ~17 hand-written copies used
 * (QueryClient / MemoryRouter / Tooltip / Workspace / Composer), plus the
 * AuthContext they were all missing. The academic-term, roster and
 * lifecycle providers some of those files also import are NOT part of
 * this: they belong to separate `renderHook` wrappers in those files and
 * were never in the app render path.
 *
 * @param {string} route             initial MemoryRouter entry
 * @param {object} options
 * @param {string} options.role      role for the authenticated test user
 */
export function renderApp(route = '/', { role, user, authenticated, sessionReady } = {}) {
  const authValue = buildAuthValue({
    user: role ? { ...DEFAULT_USER, role } : user,
    authenticated,
    sessionReady,
  });

  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthContext.Provider value={authValue}>
        <MemoryRouter initialEntries={[route]}>
          <Tooltip.Provider>
            <WorkspaceProvider>
              <ComposerProvider>
                <App />
              </ComposerProvider>
            </WorkspaceProvider>
          </Tooltip.Provider>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}
