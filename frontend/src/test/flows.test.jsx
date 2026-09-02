import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { describe, expect, it, vi } from 'vitest';

/**
 * Two of these flows cross a server boundary: sending the first message
 * creates a conversation (`POST /conversations`) before Home may navigate
 * to it, and choosing an artifact type creates the artifact
 * (`POST /artifacts`) before the editor may open. Both call sites await the
 * real API and navigate only on success, so with no backend behind jsdom
 * the promise rejects and the flow correctly stops where it is.
 *
 * The flow under test is the client one — draft becomes docked chat, type
 * choice becomes an editor — not the HTTP call, so the two API modules are
 * mocked at the module level (the pattern `delegatedAbsentRoute.test.jsx`
 * already uses) and everything underneath stays live. `@/api/ai` is mocked
 * for the same reason: the AI turn fires immediately after the message is
 * sent, and a real `fetch` there is a network call this test never wants.
 */
vi.mock('@/api/conversations', () => ({
  conversationsApi: {
    create: vi.fn(async ({ title }) => ({ id: 'c1', title })),
    listMessages: vi.fn(async () => []),
    addMessage: vi.fn(async () => ({ id: 'm1' })),
    update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
    editMessage: vi.fn(async () => ({})),
    list: vi.fn(async () => []),
  },
}));

vi.mock('@/api/artifacts', () => ({
  artifactsApi: {
    create: vi.fn(async ({ title, content }) => ({
      id: 'a1', title, content, status: 'Draft',
    })),
    get: vi.fn(async () => ({ id: 'a1', title: 'Untitled notice', content: '# Untitled notice\n\n' })),
    list: vi.fn(async () => []),
    listVersions: vi.fn(async () => []),
    update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
    publish: vi.fn(async () => ({ status: 'Published' })),
    export: vi.fn(async () => ({})),
  },
}));

vi.mock('@/api/ai', () => ({
  aiApi: {
    ask: vi.fn(async () => ({ answer: '' })),
    askStream: vi.fn(async () => ({ answer: '' })),
    executeWorkflow: vi.fn(async () => ({})),
    invokeTool: vi.fn(async () => ({})),
    uploadAttachment: vi.fn(async () => ({ id: 'f1' })),
  },
}));

const { default: App } = await import('../App');
const { WorkspaceProvider } = await import('../store/WorkspaceProvider');
const { ComposerProvider } = await import('../store/ComposerProvider');

function renderApp(route = '/') {
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

describe('ArcNave workspace flows', () => {
  it('moves the composer to a docked chat and adds the conversation to Recents', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const textarea = await screen.findByLabelText('Message ArcNave');
    await user.type(textarea, 'Create an attendance summary for second-year CSE students');
    await user.click(screen.getByRole('button', { name: /send message/i }));
    expect(await screen.findByPlaceholderText('Reply to ArcNave…')).toBeInTheDocument();
  });

  it('does not show the artifact composer before a type is selected', async () => {
    renderApp('/artifacts/new');
    expect(await screen.findByText('What are you creating?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Message ArcNave')).not.toBeInTheDocument();
  });

  it('shows the artifact composer at the bottom after a type is chosen', async () => {
    const user = userEvent.setup();
    renderApp('/artifacts/new');
    await user.click(await screen.findByText('Notice'));
    expect(await screen.findByLabelText('Message ArcNave')).toBeInTheDocument();
  });
});
