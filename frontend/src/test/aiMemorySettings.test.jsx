import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/aiMemory', () => ({
  aiMemoryApi: {
    getConsent: vi.fn(),
    setConsent: vi.fn(),
    list: vi.fn(),
    remove: vi.fn(),
    listFacts: vi.fn(),
    removeFact: vi.fn(),
  },
}));

import { aiMemoryApi } from '@/api/aiMemory';
import { AiMemorySettingsView } from '../routes/AiMemorySettingsView';

function mockState({ consented = true, memories = [], facts = [] } = {}) {
  aiMemoryApi.getConsent.mockResolvedValue({ consented });
  aiMemoryApi.list.mockResolvedValue(memories);
  aiMemoryApi.listFacts.mockResolvedValue(facts);
}

describe('AiMemorySettingsView — general freeform facts', () => {
  it('lists remembered facts alongside the bounded preferences, with a running count against the cap', async () => {
    mockState({
      memories: [{ memory_type: 'communication_style', value: 'concise' }],
      facts: [{ id: 'f1', fact: 'I mostly handle the placement cell' }],
    });
    render(<AiMemorySettingsView />);

    expect(await screen.findByText('I mostly handle the placement cell')).toBeInTheDocument();
    expect(screen.getByText('Remembered facts (1/30)')).toBeInTheDocument();
  });

  it('forgetting a fact calls removeFact and drops it from the list', async () => {
    const user = userEvent.setup();
    mockState({ facts: [{ id: 'f1', fact: 'I prefer answers in Tanglish' }] });
    aiMemoryApi.removeFact.mockResolvedValue(undefined);
    render(<AiMemorySettingsView />);

    await screen.findByText('I prefer answers in Tanglish');
    await user.click(screen.getByRole('button', { name: 'Forget "I prefer answers in Tanglish"' }));

    expect(aiMemoryApi.removeFact).toHaveBeenCalledWith('f1');
    expect(screen.queryByText('I prefer answers in Tanglish')).not.toBeInTheDocument();
  });

  // Regression: the "turn off shows a confirmation" guard previously only
  // checked memories.length — a user with ONLY remembered facts and no
  // bounded preferences would have had them silently wiped with no
  // confirmation at all once general facts existed.
  it('shows the delete-everything confirmation on toggle-off even when only facts (no bounded preferences) exist', async () => {
    const user = userEvent.setup();
    mockState({ consented: true, memories: [], facts: [{ id: 'f1', fact: 'I mostly handle the placement cell' }] });
    render(<AiMemorySettingsView />);

    await screen.findByText('I mostly handle the placement cell');
    await user.click(screen.getByRole('checkbox'));

    expect(await screen.findByText('Turn off AI Memory?')).toBeInTheDocument();
    // Appears twice once the dialog opens: once in the settings page's own
    // "Remembered facts" list (nothing has actually been deleted yet) and
    // once in the confirmation dialog's own consequences list.
    expect(screen.getAllByText('I mostly handle the placement cell').length).toBe(2);
    expect(aiMemoryApi.setConsent).not.toHaveBeenCalled();
  });

  it('confirming the dialog actually turns consent off', async () => {
    const user = userEvent.setup();
    mockState({ consented: true, facts: [{ id: 'f1', fact: 'I mostly handle the placement cell' }] });
    aiMemoryApi.setConsent.mockResolvedValue({ consented: false });
    render(<AiMemorySettingsView />);

    await screen.findByText('I mostly handle the placement cell');
    await user.click(screen.getByRole('checkbox'));
    await screen.findByText('Turn off AI Memory?');
    await user.click(screen.getByRole('button', { name: 'Turn off and delete' }));

    expect(aiMemoryApi.setConsent).toHaveBeenCalledWith(false);
  });

  it('turning consent on with nothing remembered needs no confirmation', async () => {
    const user = userEvent.setup();
    mockState({ consented: false, memories: [], facts: [] });
    aiMemoryApi.setConsent.mockResolvedValue({ consented: true });
    render(<AiMemorySettingsView />);

    await screen.findAllByText('Nothing remembered yet.');
    await user.click(screen.getByRole('checkbox'));

    expect(aiMemoryApi.setConsent).toHaveBeenCalledWith(true);
    expect(screen.queryByText('Turn off AI Memory?')).not.toBeInTheDocument();
  });
});
