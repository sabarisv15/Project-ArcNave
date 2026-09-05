'use strict';

// MSG91 SMS adapter. `credentials` is the decrypted, per-college
// college_notification_channels.config row for channel='sms',
// provider='msg91' — { authKey, senderId, route } — resolved by
// NotificationService, never read from process.env directly here (no
// global MSG91 credentials exist in config.js; unlike smtp.js, this
// channel has no app-wide fallback because it was never wired up
// before this session — see item 2/3/4 of this session's task).
// Missing authKey means the channel row hasn't actually been
// configured yet (enabled=true with an empty config) — stubbed, same
// "log, don't crash" treatment every other unconfigured-provider path
// in this codebase already gets.
//
// Uses Node's built-in fetch (Node 20, per Dockerfile) rather than
// adding an HTTP client dependency — same reasoning meta.js gives for
// the WhatsApp Cloud API, which is a plain REST call, not an SDK.

const MSG91_SEND_URL = 'https://api.msg91.com/api/v5/flow';

// A small REST POST, same shape/scale as weatherService's own outbound
// call (8s) and webRetrievalService's (10s) — this sits in that band
// rather than borrowing the provider adapters' 30s, which is sized for
// LLM generation, not a send-and-acknowledge. Without any timeout at
// all, Node's fetch waits indefinitely: a hung MSG91 endpoint pinned
// the calling request (and, on a request-path send, the TenantConnection
// it holds open) forever.
const FETCH_TIMEOUT_MS = 10_000;

async function send(to, body, { credentials } = {}) {
  const { authKey, senderId, route } = credentials || {};

  if (!authKey || !senderId) {
    return { channel: 'sms', status: 'stubbed', to, body };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(MSG91_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: authKey,
      },
      body: JSON.stringify({
        sender: senderId,
        route: route || '4',
        mobiles: to,
        message: body,
      }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.type === 'error') {
      return {
        channel: 'sms',
        status: 'failed',
        to,
        body,
        error: data.message || `MSG91 responded ${response.status}`,
      };
    }

    return {
      channel: 'sms',
      status: 'sent',
      to,
      body,
      providerId: data.request_id || null,
    };
  } catch (err) {
    return {
      channel: 'sms',
      status: 'failed',
      to,
      body,
      // An abort is reported as a timeout rather than fetch's own opaque
      // "This operation was aborted" — the distinction matters when
      // reading a failed notification row back later.
      error: err.name === 'AbortError' ? `MSG91 request timed out after ${FETCH_TIMEOUT_MS}ms` : err.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { send };
