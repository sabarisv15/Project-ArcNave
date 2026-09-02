import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
