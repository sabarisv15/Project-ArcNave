import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it, vi } from 'vitest';

/**
 * What a `/delegated` URL actually renders in an institution that has no
 * delegated seat.
 *
 * **Its own file, because the answer is decided at route-registration time.**
 * `App` builds the delegated route family from `delegatedRegistered()` as it
 * renders, so proving the absent behaviour needs that predicate to answer for
 * the absent institution before the app mounts — which is a module-level fact
 * and therefore a file-level mock. Only the three delegated predicates are
 * swapped; every fixture underneath them stays the live one, so what is being
 * tested is the routing rule and not a second institution's data.
 *
 * The rule under test is narrow and absolute: **the URL is answered, never
 * absorbed.** No redirect to `/`, no Staff home, no Staff scope — an institution
 * without this seat says the seat is not part of it, and everything else keeps
 * working.
 */
vi.mock('../lib/delegatedScope', async (importOriginal) => {
  const actual = await importOriginal();
  const { PROVISIONING_WITHOUT_LEVEL_2 } = await import('../lib/provisioning');
  return {
    ...actual,
    delegatedScope: () => actual.delegatedScope(PROVISIONING_WITHOUT_LEVEL_2),
    delegatedRegistered: () => actual.delegatedRegistered(PROVISIONING_WITHOUT_LEVEL_2),
    delegatedEnterable: () => actual.delegatedEnterable(PROVISIONING_WITHOUT_LEVEL_2),
  };
});

const { default: App } = await import('../App');
const { WorkspaceProvider } = await import('../store/WorkspaceProvider');
const { ComposerProvider } = await import('../store/ComposerProvider');

function renderApp(route) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <Tooltip.Provider>
          <WorkspaceProvider>
            <ComposerProvider>
              <App />
            </ComposerProvider>
          </WorkspaceProvider>
        </Tooltip.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('a delegated deep link in an institution with no delegated seat', () => {
  it('says the position is not part of this institution', async () => {
    renderApp('/delegated');
    expect(await screen.findByText(/is not part of this institution/i)).toBeTruthy();
  });

  it('does not become Staff home', async () => {
    renderApp('/delegated');
    await screen.findByText(/is not part of this institution/i);

    // Home's greeting is what a redirect to `/` would have produced.
    expect(screen.queryByRole('heading', { name: /Good (morning|afternoon|evening)/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /How can I help/i })).toBeNull();
  });

  it('does not grow a delegated navigation item', async () => {
    renderApp('/delegated');
    await screen.findByText(/is not part of this institution/i);

    const nav = screen.getByRole('navigation', { name: /navigation/i });
    expect(within(nav).queryByRole('link', { name: /Delegated/i })).toBeNull();
    expect(within(nav).queryByRole('link', { name: /Routed Approvals/i })).toBeNull();
  });

  it('answers a nested delegated path the same way', async () => {
    renderApp('/delegated/areas/exam-calendar');
    expect(await screen.findByText(/is not part of this institution/i)).toBeTruthy();
  });

  it('answers the approvals path the same way', async () => {
    renderApp('/delegated/approvals');
    expect(await screen.findByText(/is not part of this institution/i)).toBeTruthy();
  });

  it('leaves the other seats reachable', async () => {
    renderApp('/curriculum/attendance');
    expect(await screen.findByRole('navigation', { name: /curriculum navigation/i })).toBeTruthy();
  });
});
