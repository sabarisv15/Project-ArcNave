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

async function send(to, body, { credentials } = {}) {
  const { authKey, senderId, route } = credentials || {};

  if (!authKey || !senderId) {
    return { channel: 'sms', status: 'stubbed', to, body };
  }

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
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.type === 'error') {
      return {
        channel: 'sms', status: 'failed', to, body, error: data.message || `MSG91 responded ${response.status}`,
      };
    }

    return {
      channel: 'sms', status: 'sent', to, body, providerId: data.request_id || null,
    };
  } catch (err) {
    return {
      channel: 'sms', status: 'failed', to, body, error: err.message,
    };
  }
}

module.exports = { send };
