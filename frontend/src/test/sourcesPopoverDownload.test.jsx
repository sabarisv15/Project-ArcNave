import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  downloadFile: vi.fn(() => Promise.resolve()),
}));

import { downloadFile } from '../api/client';
import { SourcesTrigger } from '../components/SourcesPopover';

// Regression: an attachment/document source (`kind: 'uploaded'`) fell
// back to SourcesPopover's KIND.record entry (no href, not previewable),
// which rendered as a plain non-interactive <li> — real files the user
// sent or ArcNave generated showed up in Sources but could not actually
// be opened or downloaded from there. window.open(href) was never a fix
// either: the real /documents/:id/download endpoint requires a Bearer
// token window.open can't send.
describe('Sources — uploaded/generated file download', () => {
  it('an uploaded-kind source with a documentId is clickable and triggers a real authenticated download', async () => {
    const user = userEvent.setup();
    const sources = [
      {
        id: 'attachment-doc-1',
        title: 'arrears.pdf',
        kind: 'uploaded',
        documentId: 'doc-1',
        origin: 'Attached to this message',
      },
    ];
    render(<SourcesTrigger sources={sources} />);

    await user.click(screen.getByRole('button', { name: /Sources for this response/ }));
    const row = await screen.findByRole('button', { name: /Download arrears\.pdf/ });
    await user.click(row);

    expect(downloadFile).toHaveBeenCalledWith('/documents/doc-1/download', 'arrears.pdf');
  });

  it('a tool-evidence source (no document, no href) renders as a plain, non-interactive row', async () => {
    const user = userEvent.setup();
    const sources = [
      {
        id: 'src-students_roster-t1',
        title: 'students_roster',
        kind: 'tool',
        origin: '5 record(s) · retrieved t1',
      },
    ];
    render(<SourcesTrigger sources={sources} />);

    await user.click(screen.getByRole('button', { name: /Sources for this response/ }));
    expect(await screen.findByText('students_roster')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /students_roster/ })).not.toBeInTheDocument();
  });
});
