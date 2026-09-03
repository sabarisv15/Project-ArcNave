import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import * as Tooltip from '@radix-ui/react-tooltip';
import { AuthContext } from '@/hooks/useAuth';
import { WorkspaceProvider } from '@/store/WorkspaceProvider';
import { ComposerProvider } from '@/features/chat';
import { QueryClientProvider } from '@tanstack/react-query';
import { buildAuthValue, createTestQueryClient } from '@/test/renderApp';
import { AppShell } from './AppShell';

// A custom Routes tree (not the shared renderApp/App helper) — this test
// needs to inject a route that reliably throws, which no real page does.
// Same provider stack renderApp.jsx already proves sufficient for anything
// AppShell/WorkspaceProvider needs.
//
// `<TestNav>` sits beside `<Routes>`, outside AppShell/Outlet — a stand-in
// for the real persistent Sidebar, which is likewise unaffected by
// whatever the currently-routed page does. A link INSIDE the crashed
// route's own element would never render at all (a render throw discards
// that whole element's output, not just the throwing part of it), so
// recovery has to be driven from something that survives the crash, same
// as it would for a real user clicking the real sidebar.
function TestNav() {
  return (
    <nav>
      <Link to="/fine">go to fine page</Link>
    </nav>
  );
}

function renderShellAt(route, children) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthContext.Provider value={buildAuthValue()}>
        <MemoryRouter initialEntries={[route]}>
          <Tooltip.Provider>
            <WorkspaceProvider>
              <ComposerProvider>
                <TestNav />
                <Routes>
                  <Route element={<AppShell />}>{children}</Route>
                </Routes>
              </ComposerProvider>
            </WorkspaceProvider>
          </Tooltip.Provider>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

function Thrower() {
  throw new Error('boom');
}

describe('AppShell — route-level error boundary (P4 5.12)', () => {
  it('keeps the sidebar usable when the routed page content throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderShellAt('/broken', [
      <Route key="broken" path="/broken" element={<Thrower />} />,
      <Route key="fine" path="/fine" element={<p>a fine page</p>} />,
    ]);

    expect(await screen.findByText('This page hit a problem.')).toBeInTheDocument();
    // The persistent shell around the crashed page — not just "didn't
    // crash" — is what "isolated" actually means here: the nav is real
    // React that stayed mounted and interactive, not leftover static HTML.
    expect(screen.getByRole('link', { name: 'go to fine page' })).toBeInTheDocument();
  });

  it('recovers when the user navigates away from a crashed route', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();

    renderShellAt('/broken', [
      <Route key="broken" path="/broken" element={<Thrower />} />,
      <Route key="fine" path="/fine" element={<p>a fine page</p>} />,
    ]);

    expect(await screen.findByText('This page hit a problem.')).toBeInTheDocument();

    await user.click(screen.getByText('go to fine page'));

    expect(await screen.findByText('a fine page')).toBeInTheDocument();
    expect(screen.queryByText('This page hit a problem.')).not.toBeInTheDocument();
  });
});
