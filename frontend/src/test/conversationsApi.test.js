import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  api: { post: vi.fn(() => Promise.resolve({ id: 'm1' })) },
}));

// eslint-disable-next-line import/first
import { api } from '../api/client';
// eslint-disable-next-line import/first
import { conversationsApi } from '../api/conversations';

// Regression: sendMessage (WorkspaceProvider.jsx) previously only ever
// persisted {role, content} for the user's own turn — the uploaded
// attachments' metadata was computed right there but never reached this
// API call, so a reload silently dropped which file(s) had been sent.
// This proves the wire shape actually carries `attachments` through to
// the request body under its real key name.
describe('conversationsApi.addMessage', () => {
  it('sends attachments through to the request body', async () => {
    const attachments = [{
      id: 'doc-1', serverId: 'doc-1', name: 'arrears.pdf', type: 'application/pdf', size: 2048,
    }];
    await conversationsApi.addMessage('conv1', { role: 'user', content: 'see attached', attachments });

    expect(api.post).toHaveBeenCalledWith('/conversations/conv1/messages', expect.objectContaining({
      role: 'user', content: 'see attached', attachments,
    }));
  });

  it('sends undefined (not an empty array) when there are no attachments', async () => {
    await conversationsApi.addMessage('conv1', { role: 'user', content: 'no attachment' });

    expect(api.post).toHaveBeenCalledWith('/conversations/conv1/messages', expect.objectContaining({
      role: 'user', content: 'no attachment', attachments: undefined,
    }));
  });

  it('sends inputTokens/outputTokens through as input_tokens/output_tokens (P1.6)', async () => {
    await conversationsApi.addMessage('conv1', {
      role: 'assistant', content: 'answer', inputTokens: 120, outputTokens: 45,
    });

    expect(api.post).toHaveBeenCalledWith('/conversations/conv1/messages', expect.objectContaining({
      role: 'assistant', content: 'answer', input_tokens: 120, output_tokens: 45,
    }));
  });
});
