'use strict';

// Staff phone OTP verification (RS-STF-014, ADL-030) — same mechanism
// as phoneVerificationService.js (WhatsApp send, 6-digit hashed code,
// single-use, attempt-capped), targeting staff.phone/phone_verified
// instead of students.phone/parent_phone. Self-only: there is no
// tutor/hod/principal "verify someone else's phone" case here, unlike
// the student version — a staff member only ever verifies their own
// number, so this file is simpler by exactly that one dimension.
//
// Business logic only — staffRepository/staffPhoneOtpRepository do
// query mechanics, notificationService owns the actual send (CLAUDE.md
// rule 1).

const crypto = require('crypto');
const config = require('../config');
const staffRepository = require('../repositories/staffRepository');
const staffPhoneOtpRepository = require('../repositories/staffPhoneOtpRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const notificationService = require('./notificationService');

class StaffPhoneVerificationValidationError extends Error {}
class StaffPhoneVerificationNotFoundError extends Error {}
class StaffPhoneVerificationNoPhoneOnFileError extends Error {}
class StaffPhoneVerificationNotRequestedError extends Error {}
class StaffPhoneVerificationMaxAttemptsExceededError extends Error {}
class StaffPhoneVerificationCodeMismatchError extends Error {}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function requestOtp(client, { userId }) {
  const staff = await staffRepository.findByUserId(client, userId);
  if (staff === null) {
    throw new StaffPhoneVerificationNotFoundError(`no staff profile exists for user ${JSON.stringify(userId)}`);
  }
  if (!staff.phone) {
    throw new StaffPhoneVerificationNoPhoneOnFileError(`staff ${JSON.stringify(staff.id)} has no phone on file`);
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + config.otp.expireMinutes * 60 * 1000);

  await staffPhoneOtpRepository.create(client, {
    collegeId: staff.college_id,
    staffId: staff.id,
    phone: staff.phone,
    codeHash: hashCode(code),
    expiresAt,
  });

  const sendResult = await notificationService.sendViaChannel(client, {
    collegeId: staff.college_id,
    channel: 'whatsapp',
    to: staff.phone,
    body: `Your ARCNAVE verification code is ${code}. It expires in ${config.otp.expireMinutes} minutes.`,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: staff.college_id,
    userId,
    action: 'staff_phone_otp_requested',
    entity: 'staff',
    entityId: staff.id,
    metadata: { deliveryStatus: sendResult.status },
  });

  return { expiresAt, deliveryStatus: sendResult.status };
}

async function verifyOtp(client, { userId }, code) {
  if (!code) {
    throw new StaffPhoneVerificationValidationError('code is required');
  }

  const staff = await staffRepository.findByUserId(client, userId);
  if (staff === null) {
    throw new StaffPhoneVerificationNotFoundError(`no staff profile exists for user ${JSON.stringify(userId)}`);
  }

  const otpRow = await staffPhoneOtpRepository.findLatestActive(client, staff.id);
  if (otpRow === null) {
    throw new StaffPhoneVerificationNotRequestedError(`no live OTP found for staff ${JSON.stringify(staff.id)}`);
  }
  if (otpRow.attempts >= config.otp.maxAttempts) {
    throw new StaffPhoneVerificationMaxAttemptsExceededError(`OTP ${JSON.stringify(otpRow.id)} has exceeded the maximum number of attempts`);
  }
  if (hashCode(code) !== otpRow.code_hash) {
    await staffPhoneOtpRepository.incrementAttempts(client, otpRow.id);
    throw new StaffPhoneVerificationCodeMismatchError('code does not match');
  }

  await staffPhoneOtpRepository.markConsumed(client, otpRow.id);
  const updated = await staffRepository.update(client, staff.id, { phoneVerified: true });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: staff.college_id,
    userId,
    action: 'staff_phone_otp_verified',
    entity: 'staff',
    entityId: staff.id,
    metadata: null,
  });

  return updated;
}

module.exports = {
  StaffPhoneVerificationValidationError,
  StaffPhoneVerificationNotFoundError,
  StaffPhoneVerificationNoPhoneOnFileError,
  StaffPhoneVerificationNotRequestedError,
  StaffPhoneVerificationMaxAttemptsExceededError,
  StaffPhoneVerificationCodeMismatchError,
  requestOtp,
  verifyOtp,
};
