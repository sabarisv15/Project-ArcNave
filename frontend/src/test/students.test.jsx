import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { WorkspaceProvider } from '../store/WorkspaceProvider';
import { ComposerProvider } from '../store/ComposerProvider';
import { CLASS_BY_ID, SCOPE_TOTAL, STAFF_CLASSES, defaultScope } from '../lib/studentsData';

function renderApp(route = '/curriculum/students') {
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

describe('Students — staff teaching scope', () => {
  it('opens on the live class and counts only that class', async () => {
    renderApp();
    const live = CLASS_BY_ID[defaultScope()];
    expect(live.when).toBe('live');
    const tab = await screen.findByRole('tab', { name: new RegExp(live.code.replace(/[-—]/g, '.'), 'i') });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(
      await screen.findByText(`${live.studentIds.length} students in ${live.code}`)
    ).toBeInTheDocument();
  });

  it('switches scope in one click and re-counts', async () => {
    const user = userEvent.setup();
    renderApp();
    const other = STAFF_CLASSES.find((c) => c.when === 'next');
    await user.click(await screen.findByRole('tab', { name: new RegExp(other.subject, 'i') }));
    expect(
      await screen.findByText(`${other.studentIds.length} students in ${other.code}`)
    ).toBeInTheDocument();
  });

  it('shows the class column and the full staff scope in All my students', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('tab', { name: /all my students/i }));
    expect(
      await screen.findByText(`${SCOPE_TOTAL} students across ${STAFF_CLASSES.length} assigned classes`)
    ).toBeInTheDocument();
    expect(screen.getByText('Class & subject')).toBeInTheDocument();
  });

  it('keeps the sidebar count on the unique staff scope', async () => {
    renderApp();
    const nav = await screen.findByRole('navigation', { name: /curriculum navigation/i });
    expect(within(nav).getByText(String(SCOPE_TOTAL))).toBeInTheDocument();
  });

  it('has no Add student action', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Students' });
    expect(screen.queryByRole('button', { name: /add student/i })).not.toBeInTheDocument();
  });

  it('shows the selection hint once and never again after it is seen', async () => {
    const user = userEvent.setup();
    localStorage.removeItem('arcnave.students.notifyHintSeen');
    const first = renderApp();
    expect(await screen.findByText('Select students to notify')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /dismiss hint/i }));
    expect(screen.queryByText('Select students to notify')).not.toBeInTheDocument();
    first.unmount();

    renderApp();
    await screen.findByRole('heading', { name: 'Students' });
    expect(screen.queryByText('Select students to notify')).not.toBeInTheDocument();
  });

  it('reveals bulk actions only once rows are selected', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole('heading', { name: 'Students' });
    expect(screen.queryByRole('region', { name: /bulk actions/i })).not.toBeInTheDocument();
    const [firstRow] = screen.getAllByRole('checkbox', { name: /^Select (?!all)/i });
    await user.click(firstRow);
    expect(screen.getByRole('region', { name: /bulk actions/i })).toBeInTheDocument();
  });

  it('offers one navigation cluster with Back disabled at the entry route', async () => {
    renderApp();
    expect(await screen.findByRole('button', { name: 'Go back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Go forward' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /(Collapse|Expand) sidebar/ })).toHaveLength(1);
  });
});
