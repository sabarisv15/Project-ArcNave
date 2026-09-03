import { getAccessToken, getCollegeCode } from '@/lib/authStorage';
import { api, refreshOnce } from './client';

const BASE_URL = '/api/v1';

/**
 * Reads a `text/event-stream` GET response (`GET /notifications/stream`,
 * P4 5.4) and calls `onEvent({ type: 'notification', notification })` per
 * row changed/added, or `onEvent({ type: 'stream_end' })` when the server
 * signals a reconnect. GET variant of `ai.js`'s `streamRequest` — a native
 * `EventSource` can't set the `Authorization: Bearer` header this route's
 * tenant/RBAC resolution requires, so this is a `fetch` reader with the
 * same line-parsing loop, not `EventSource`.
 */
async function streamNotifications(onEvent, { signal, isRetry = false } = {}) {
  const token = getAccessToken();
  const collegeCode = getCollegeCode();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (collegeCode) headers['X-College-Code'] = collegeCode;

  const res = await fetch(`${BASE_URL}/notifications/stream`, { headers, signal });

  if (res.status === 401 && !isRetry && token) {
    await refreshOnce();
    return streamNotifications(onEvent, { signal, isRetry: true });
  }
  if (!res.ok || !res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';

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
          if (currentEvent === 'notification') onEvent({ type: 'notification', notification: data });
          else if (currentEvent === 'stream_end') onEvent({ type: 'stream_end' });
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  }
}

/**
 * Keeps one stream connected for as long as `signal` isn't aborted,
 * reconnecting on a clean `stream_end` (the server's own safety-net cap)
 * or a dropped connection — the same self-healing behavior a native
 * `EventSource` gives for free, reimplemented here because this route
 * needs a header `EventSource` cannot set.
 */
export async function watchNotifications(onEvent, { signal } = {}) {
  while (!signal?.aborted) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await streamNotifications(onEvent, { signal });
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') return;
    }
    if (signal?.aborted) return;
  }
}

export const notificationsApi = {
  /** GET /notifications — most recent first, existing route. */
  list: ({ limit = 20 } = {}) => api.get(`/notifications?limit=${limit}`),
  watch: watchNotifications,
};
