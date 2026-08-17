'use strict';

// SMTP email adapter — the nodemailer logic that used to live directly
// in notificationService.js's own getTransporter/sendEmail, moved here
// unchanged (no behavior change) so notificationService.js has no
// vendor-specific code of its own (item 2 of this session's task).
// `credentials` (host/port/secure/user/password/fromAddress), when
// supplied, is a per-college override resolved from
// college_notification_channels.config by NotificationService; when
// omitted, falls back to the app-wide config.smtp — the exact global
// default this file's logic always used before per-college config
// existed.
//
// Built fresh per call, not cached: nodemailer.createTransport is a
// cheap, synchronous object construction (the real network connection
// only happens lazily inside sendMail itself), so config changes
// between calls are always picked up.

const nodemailer = require('nodemailer');
const config = require('../../../config');

function getTransporter(smtpConfig) {
  if (!smtpConfig.host) {
    return null;
  }
  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: smtpConfig.user ? { user: smtpConfig.user, pass: smtpConfig.password } : undefined,
  });
}

async function send(to, body, { subject, credentials } = {}) {
  const smtpConfig = credentials || config.smtp;

  const transporter = getTransporter(smtpConfig);
  if (transporter === null) {
    return { channel: 'email', status: 'stubbed', to, subject };
  }

  try {
    await transporter.sendMail({
      from: smtpConfig.fromAddress, to, subject, text: body,
    });
    return { channel: 'email', status: 'sent', to, subject };
  } catch (err) {
    return {
      channel: 'email', status: 'failed', to, subject, error: err.message,
    };
  }
}

module.exports = { send };
