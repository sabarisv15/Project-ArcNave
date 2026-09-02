import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * Two of these flows cross a server boundary: sending the first message
 * creates a conversation (`POST /conversations`) before Home may navigate
 * to it, and choosing an artifact type creates the artifact
 * (`POST /artifacts`) before the editor may open. Both call sites await
 * the real API and navigate only on success, so with no backend behind
 * jsdom the promise rejects and the flow correctly stops where it is —
 * which is why these two were the last red tests in the suite.
 *
 * The flow under test is the client one — draft becomes docked chat, type
 * choice becomes an editor — not the HTTP call, so the API modules are
 * mocked at the module level (the pattern delegatedAbsentRoute.test.jsx
 * already uses) and everything underneath stays live. `@/api/ai` is
 * mocked for the same reason: the AI turn fires immediately after the
 * message is sent, and a real fetch there is a network call this test
 * never wants.
 *
 * Auth is NOT mocked here: renderApp supplies a ready, authenticated
 * AuthContext value already. Stubbing the useAuth module instead would
 * also have to re-export AuthContext, which that helper imports.
 */
vi.mock('@/api/conversations', () => ({
  conversationsApi: {
    create: vi.fn(async ({ title } = {}) => ({ id: 'c1', title })),
    list: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    addMessage: vi.fn(async () => ({ id: 'm1' })),
    editMessage: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
  },
}));

vi.mock('@/api/artifacts', () => ({
  artifactsApi: {
    create: vi.fn(async ({ title, content } = {}) => ({ id: 'a1', title, content, status: 'Draft' })),
    get: vi.fn(async () => ({ id: 'a1', title: 'Untitled notice', content: '# Untitled notice\n\n' })),
    list: vi.fn(async () => []),
    listVersions: vi.fn(async () => []),
    update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
    publish: vi.fn(async () => ({ status: 'Published' })),
    export: vi.fn(async () => ({})),
  },
}));

vi.mock('@/api/projects', () => ({
  projectsApi: {
    list: vi.fn(async () => []),
    get: vi.fn(async () => ({})),
    create: vi.fn(async ({ title } = {}) => ({ id: 'p1', title })),
    update: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
    setPinned: vi.fn(async () => ({})),
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

import { renderApp as renderAppShared } from './renderApp';

function renderApp(route = '/', options) {
  return renderAppShared(route, options);
}

describe('ArcNave workspace flows', () => {
  it('moves the composer to a docked chat and adds the conversation to Recents', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const textarea = await screen.findByLabelText('Message ArcNave');
    await user.type(textarea, 'Create an attendance summary for second-year CSE students');
    await user.click(screen.getByRole('button', { name: /send message/i }));
    // Longer than the 1000ms default: the docked chat only mounts after
    // the conversation POST resolves AND the router navigates, and the AI
    // turn fires in the same tick. At the default timeout this assertion
    // raced that sequence and passed or failed run to run.
    expect(await screen.findByPlaceholderText('Reply to ArcNave…', {}, { timeout: 5000 })).toBeInTheDocument();
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
