import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { WorkspaceProvider } from '../store/WorkspaceProvider';
import { ComposerProvider } from '../store/ComposerProvider';
import { curriculumNavFor } from '../components/SidebarNavigation';
import { TEACHING_STAFF } from '../lib/roles';

/**
 * Personal Staff is already built, and the institutional work must not move it.
 *
 * The three files Staff shares with the institutional seats — the shell, the
 * shared empty states and the role registry — were all touched in this pass,
 * additively. This suite is the net under that: it pins the Staff menu, the
 * destinations it offers and the context chrome it does *not* get, so a later
 * institutional change cannot quietly alter the experience of a staff member
 * who holds no seat at all.
 */

function renderApp(route = '/curriculum') {
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
    </QueryClientProvider>
  );
}

const STAFF_DESTINATIONS = [
  { to: '/curriculum/students', label: 'Students' },
  { to: '/curriculum/staff', label: 'Staff' },
  { to: '/curriculum/attendance', label: 'Attendance & Class log' },
  { to: '/curriculum/assessments', label: 'Assessments' },
  { to: '/curriculum/documents', label: 'Documents' },
  { to: '/curriculum/calendar', label: 'Calendar' },
];

describe('Personal Staff — unchanged by the institutional foundation', () => {
  it('is the workspace the app opens in', () => {
    const nav = curriculumNavFor(TEACHING_STAFF);
    expect(nav.map((i) => i.label)).toEqual(STAFF_DESTINATIONS.map((d) => d.label));
    expect(nav.map((i) => i.to)).toEqual(STAFF_DESTINATIONS.map((d) => d.to));
  });

  it('renders exactly those six destinations and nothing institutional', async () => {
    renderApp();
    const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    const links = within(nav).getAllByRole('link');
    // Students and Staff carry their own count badge inside the link, so the
    // label is compared without the trailing digits rather than by exact text.
    expect(links.map((l) => l.textContent.trim().replace(/\d+$/, ''))).toEqual(
      STAFF_DESTINATIONS.map((d) => d.label)
    );

    // No institutional destination leaks into the Staff menu.
    ['My Class', 'Department', 'Institution', 'Approvals'].forEach((label) => {
      expect(within(nav).queryByRole('link', { name: new RegExp(`^${label}$`, 'i') })).toBeNull();
    });
  });

  /**
   * The seat indicator is the one piece of chrome the shell gained. A staff
   * member holds no institutional seat, so they must not see it — and a
   * designation string that happens to read "Principal" or "Class Tutor" must
   * never produce it either. Entering the seat is the only thing that does.
   */
  it('shows no institutional seat indicator', async () => {
    renderApp();
    await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(screen.queryByText(/Head of Department/)).toBeNull();
    expect(screen.queryByText(/Dean — Academic Affairs/)).toBeNull();
    expect(screen.queryByText(/All departments/)).toBeNull();
  });

  it('keeps the Home menu it always had', async () => {
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: /home navigation/i });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent.trim())).toEqual([
      'New',
      'Projects',
      'Artifacts',
    ]);
  });
});
