import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatMessage } from '../components/ChatMessage';

const MESSAGE = {
  id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', role: 'user', text: 'original question', createdAt: new Date().toISOString(),
};

// Regression: editing a message previously only ever mutated local React
// state (WorkspaceProvider.editMessage's own old comment said so
// explicitly) — no network call, nothing server-side ever truncated or
// regenerated. This is now a real, awaited PATCH that can fail, so the
// editor needs a pending/failure state it never needed before.
describe('MessageEditor — real rewind save', () => {
  it('opens with the existing text and calls onEdit with the new draft on Save', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn(() => Promise.resolve(true));
    render(<ChatMessage message={MESSAGE} onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: 'Edit message' }));
    const textarea = screen.getByLabelText('Edit your message');
    expect(textarea).toHaveValue('original question');

    await user.clear(textarea);
    await user.type(textarea, 'revised question');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onEdit).toHaveBeenCalledWith(MESSAGE.id, 'revised question');
  });

  it('shows a pending state while the save is in flight, and closes the editor once it resolves true', async () => {
    const user = userEvent.setup();
    let resolveSave;
    const onEdit = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    render(<ChatMessage message={MESSAGE} onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: 'Edit message' }));
    await user.type(screen.getByLabelText('Edit your message'), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('button', { name: 'Regenerating…' })).toBeDisabled();
    resolveSave(true);

    expect(await screen.findByRole('button', { name: 'Edit message' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit your message')).not.toBeInTheDocument();
  });

  it('keeps the editor open with the draft intact when the save fails (onEdit resolves false)', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn(() => Promise.resolve(false));
    render(<ChatMessage message={MESSAGE} onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: 'Edit message' }));
    await user.type(screen.getByLabelText('Edit your message'), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const textarea = await screen.findByLabelText('Edit your message');
    expect(textarea).toHaveValue('original question!');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
