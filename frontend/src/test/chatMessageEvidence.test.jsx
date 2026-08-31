import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ChatMessage } from '../components/ChatMessage';

const BASE_MESSAGE = {
  id: 'm1',
  role: 'ai',
  generating: false,
  body: 'There are 5 arrears.',
  createdAt: new Date().toISOString(),
};

// Regression: aiService.buildEvidenceTrail/verifyNumericClaims (backend)
// have computed this data for every tool-grounded answer since P0.4, and
// WorkspaceProvider.jsx has stored it on every message since then — but
// no component ever rendered either field, so the reader had no visible
// reasoning/provenance for a reply, and no warning when the AI's own
// stated number didn't match what was actually retrieved.
describe('ChatMessage evidence trail', () => {
  it('renders nothing when there is no evidence trail', () => {
    render(<ChatMessage message={BASE_MESSAGE} />);
    expect(screen.queryByText(/Based on/)).not.toBeInTheDocument();
  });

  it('shows a collapsed "Based on N source(s)" toggle, and expands to the real trail lines on click', async () => {
    const user = userEvent.setup();
    const trail =
      '- students_roster — 5 record(s) — retrieved 2026-08-22T10:00:00Z\n- attendance_summary — retrieved 2026-08-22T10:00:01Z';
    render(<ChatMessage message={{ ...BASE_MESSAGE, evidenceTrail: trail }} />);

    const toggle = screen.getByRole('button', { name: /Based on 2 sources/ });
    expect(screen.queryByText(/students_roster/)).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText(/students_roster — 5 record\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/attendance_summary/)).toBeInTheDocument();
  });

  it('uses singular "source" for exactly one', () => {
    render(<ChatMessage message={{ ...BASE_MESSAGE, evidenceTrail: '- get_college_profile — retrieved now' }} />);
    expect(screen.getByRole('button', { name: /Based on 1 source\b/ })).toBeInTheDocument();
  });
});

describe('ChatMessage verification notice', () => {
  it('shows nothing for a PASS verification', () => {
    render(<ChatMessage message={{ ...BASE_MESSAGE, verification: { status: 'PASS' } }} />);
    expect(screen.queryByText(/doesn't match/)).not.toBeInTheDocument();
  });

  it('shows nothing for INSUFFICIENT_EVIDENCE', () => {
    render(<ChatMessage message={{ ...BASE_MESSAGE, verification: { status: 'INSUFFICIENT_EVIDENCE' } }} />);
    expect(screen.queryByText(/doesn't match/)).not.toBeInTheDocument();
  });

  it("warns when the reply's own numbers conflict with the retrieved data", () => {
    render(
      <ChatMessage
        message={{
          ...BASE_MESSAGE,
          verification: { status: 'CONFLICT', claimedNumbers: [9], knownCounts: [5] },
        }}
      />,
    );
    expect(screen.getByText(/doesn't match the data ArcNave actually retrieved/)).toBeInTheDocument();
  });
});
