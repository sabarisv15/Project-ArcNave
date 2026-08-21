import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AIComposer } from '../components/AIComposer';
import * as Tooltip from '@radix-ui/react-tooltip';

function setup(props = {}) {
  const onSend = vi.fn();
  const onChange = vi.fn();
  const onMode = vi.fn();
  render(
    <Tooltip.Provider>
      <AIComposer
        value={props.value ?? ''}
        onChange={onChange}
        onSend={onSend}
        mode={props.mode ?? 'curriculum'}
        onMode={onMode}
        placeholder="Ask ArcNave anything about your campus…"
      />
    </Tooltip.Provider>
  );
  return { onSend, onChange, onMode };
}

describe('AIComposer', () => {
  it('keeps Send disabled until a real character is typed', () => {
    setup({ value: '   ' });
    expect(screen.getByRole('button', { name: /send message/i })).toBeDisabled();
  });

  it('enables Send once alphanumeric content exists', () => {
    setup({ value: 'Draft a notice' });
    expect(screen.getByRole('button', { name: /send message/i })).toBeEnabled();
  });

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    const user = userEvent.setup();
    const { onSend } = setup({ value: 'Summarise attendance' });
    const textarea = screen.getByLabelText('Message ArcNave');
    await user.click(textarea);
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('renders General and Curriculum with identical dimensions', () => {
    setup();
    const general = screen.getByRole('button', { name: 'General' });
    const curriculum = screen.getByRole('button', { name: 'Curriculum' });
    expect(general.className).toContain('w-[92px]');
    expect(curriculum.className).toContain('w-[92px]');
    expect(general.className).toContain('h-[28px]');
    expect(curriculum.className).toContain('h-[28px]');
  });
});
