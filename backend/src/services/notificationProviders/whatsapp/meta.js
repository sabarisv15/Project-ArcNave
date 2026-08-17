'use strict';

// Meta WhatsApp Cloud API adapter. `credentials` is the decrypted,
// per-college college_notification_channels.config row for
// channel='whatsapp', provider='meta' — { accessToken, phoneNumberId }
// — resolved by NotificationService. No app-wide fallback (same
// reasoning msg91.js gives — this channel/provider pair has no
// pre-existing config.js entry to fall back to).
//
// `to` must already be in E.164 format (no leading '+', per Meta's
// API) — callers (phoneVerificationService.js, the Send Alert path)
// are responsible for normalizing before calling this, same as this
// codebase's existing Twilio adapter left the whatsapp: prefix to its
// own callers rather than guessing at normalization here.
//
// Plain text messages only — sends a "text" message type. Meta's
// 24-hour session window / template-message rules for first-contact
// messages are a real production concern this adapter does not
// enforce; a rejected send surfaces as a normal 'failed' result, not a
// special case, same best-effort philosophy every channel here follows.

const META_GRAPH_VERSION = 'v20.0';

async function send(to, body, { credentials } = {}) {
  const { accessToken, phoneNumberId } = credentials || {};

  if (!accessToken || !phoneNumberId) {
    return { channel: 'whatsapp', status: 'stubbed', to, body };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        }),
      },
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        channel: 'whatsapp', status: 'failed', to, body, error: data.error && data.error.message ? data.error.message : `Meta responded ${response.status}`,
      };
    }

    return {
      channel: 'whatsapp',
      status: 'sent',
      to,
      body,
      providerId: data.messages && data.messages[0] ? data.messages[0].id : null,
    };
  } catch (err) {
    return {
      channel: 'whatsapp', status: 'failed', to, body, error: err.message,
    };
  }
}

module.exports = { send };
