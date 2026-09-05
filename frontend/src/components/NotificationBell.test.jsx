import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthContext } from '@/hooks/useAuth';
import { buildAuthValue } from '@/test/renderApp';
import { notificationsApi } from '@/api/notifications';
import { NotificationBell } from './NotificationBell';

vi.mock('@/api/notifications', () => ({
  notificationsApi: {
    list: vi.fn(),
    watch: vi.fn(),
  },
}));

function renderBell(role) {
  return render(
    <AuthContext.Provider value={buildAuthValue({ user: { userId: 'u1', collegeId: 'c1', role } })}>
      <NotificationBell />
    </AuthContext.Provider>,
  );
}

const NOTIFICATION = {
  id: 'n1',
  channel: 'email',
  to_address: 'x@example.com',
  subject: 'Fee due reminder',
  body: 'Fees are due next week.',
  status: 'Dispatched',
  origin: 'human',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

describe('NotificationBell (P4 5.4)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    notificationsApi.list.mockReset().mockResolvedValue([NOTIFICATION]);
    notificationsApi.watch.mockReset().mockImplementation(() => new Promise(() => {}));
  });

  it('renders nothing for a role without notifications.read', async () => {
    const { container } = renderBell('teaching_staff');
    await waitFor(() => expect(notificationsApi.list).not.toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the trigger and list for a role with notifications.read', async () => {
    renderBell('principal');
    expect(screen.getByRole('button', { name: /Notifications/ })).toBeInTheDocument();
    await waitFor(() => expect(notificationsApi.list).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(await screen.findByText('Fee due reminder')).toBeInTheDocument();
    expect(screen.getByText('Dispatched')).toBeInTheDocument();
  });

  it('shows an empty state when there are no notifications', async () => {
    notificationsApi.list.mockResolvedValue([]);
    renderBell('hod');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();
  });

  it('shows an unread badge for a live SSE notification, and clears it on open', async () => {
    let emit;
    notificationsApi.list.mockResolvedValue([]);
    notificationsApi.watch.mockImplementation((onEvent) => {
      emit = onEvent;
      return new Promise(() => {});
    });

    renderBell('principal');
    await waitFor(() => expect(notificationsApi.watch).toHaveBeenCalled());

    act(() => {
      emit({ type: 'notification', notification: NOTIFICATION });
    });

    expect(await screen.findByText('1')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(await screen.findByText('Fee due reminder')).toBeInTheDocument();
    // Badge is session-local "changed since last opened" — opening clears it.
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });
});
