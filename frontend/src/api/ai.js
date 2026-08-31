import { getAccessToken, getCollegeCode } from '@/lib/authStorage';
import { api, ApiError, refreshOnce } from './client';

const BASE_URL = '/api/v1';

/**
 * Reads a text/event-stream response body (POST /ai/ask/stream, P0.5) and
 * calls `onEvent` once per SSE event — `{ type: 'delta', delta }` as each
 * answer chunk arrives, `{ type: 'step', step }` right before a tool call
 * (single-tool or a workflow plan's step) actually runs
 * (`{phase, toolName, stepIndex, totalSteps}`, aiService.js's own real
 * progress, not a synthetic guess), then `{ type: 'done', result }` once
 * with the exact same JSON shape POST /ai/ask itself returns (toolUsed,
 * evidence, plan, pendingConfirmation, ...). Auth/401-refresh mirrors client.js's own
 * request() (same single-flight refreshOnce), duplicated rather than
 * reused because a streaming fetch can't go through request()'s
 * res.json()-only response handling.
 */
async function streamRequest(path, body, onEvent, { isRetry = false } = {}) {
  const token = getAccessToken();
  const collegeCode = getCollegeCode();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (collegeCode) headers['X-College-Code'] = collegeCode;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 401 && !isRetry && token) {
    try {
      await refreshOnce();
      return streamRequest(path, body, onEvent, { isRetry: true });
    } catch {
      throw new ApiError(401, 'Session expired');
    }
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data && data.detail, data);
  }
  if (!res.body) {
    // Environment without streaming-body fetch support — fail loudly
    // rather than silently returning nothing, so a caller notices and
    // falls back to the non-streaming aiApi.ask() instead.
    throw new ApiError(0, 'This browser does not support streaming responses');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';
  let result = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trimEnd();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.startsWith('event:')) {
        currentEvent = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        const payload = line.slice('data:'.length).trim();
        if (payload) {
          const data = JSON.parse(payload);
          if (currentEvent === 'delta') {
            onEvent({ type: 'delta', delta: data.delta });
          } else if (currentEvent === 'step') {
            onEvent({ type: 'step', step: data });
          } else if (currentEvent === 'done') {
            result = data;
            onEvent({ type: 'done', result: data });
          } else if (currentEvent === 'error') {
            throw new ApiError(502, data.detail);
          }
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  }
  return result;
}

export const aiApi = {
  /** POST /ai/ask — single JSON response, no streaming. */
  ask: (body) => api.post('/ai/ask', body),
  /** POST /ai/ask/stream (P0.5) — see streamRequest's own comment. */
  askStream: (body, onEvent) => streamRequest('/ai/ask/stream', body, onEvent),
  /** POST /ai/workflow/execute (P0.3) — replays a plan the user already confirmed. */
  executeWorkflow: (body) => api.post('/ai/workflow/execute', body),
  /** POST /ai/tools/:name/invoke — a single confirmed tool call (L3/bulk-guard confirmation). */
  invokeTool: (name, body) => api.post(`/ai/tools/${encodeURIComponent(name)}/invoke`, body),
  /**
   * POST /documents/chat-attachments — the real upload behind the composer's
   * image attachments (useComposerAttachments.js's own real runUpload).
   * Routed through DocumentService on the backend (RS-ASM-005), not a
   * separate chat-only storage path. Returns { id, mime_type, size_bytes } —
   * `id` is what later gets sent as an `attachment_ids` entry to
   * /ai/ask(/stream), never the composer's own local `att-...` id.
   */
  uploadAttachment: ({ fileBase64, fileName, mimeType }) =>
    api.post('/documents/chat-attachments', {
      file_base64: fileBase64,
      file_name: fileName,
      mime_type: mimeType,
    }),
};
