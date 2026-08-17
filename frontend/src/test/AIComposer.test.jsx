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
        mode={props.mode ?? 'ask'}
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

  it('renders Ask and Act with identical dimensions', () => {
    setup();
    const ask = screen.getByRole('button', { name: 'Ask' });
    const act = screen.getByRole('button', { name: 'Act' });
    expect(ask.className).toContain('w-[60px]');
    expect(act.className).toContain('w-[60px]');
    expect(ask.className).toContain('h-[28px]');
    expect(act.className).toContain('h-[28px]');
  });
});
