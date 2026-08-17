'use strict';

// Student/parent phone OTP verification (item 1 of this session's
// task) — sends via WhatsApp (notificationService.sendViaChannel,
// channel='whatsapp'), never SMS. Verify/expiry/single-use logic below
// is what the task calls out as unchanged from a conventional OTP flow
// — only the send mechanism is WhatsApp-specific.
//
// A verified OTP only guarantees the number was reachable ON WHATSAPP
// at verification time — a later delivery failure for some OTHER
// message sent to the same number is expected and unrelated (this
// session's own task framing), not something this service tracks or
// re-checks.
//
// Business logic only — studentRepository/studentPhoneOtpRepository do
// query mechanics, notificationService owns the actual send (CLAUDE.md
// rule 1: every AI/business action calls a Business Service, never a
// repository or a provider adapter directly).
//
// requestOtp/verifyOtp use the same shared read-access rule as
// GET /students(/:id) and Finance's per-student endpoints (this
// session's own task): the tutor OR any faculty-allocated teacher of
// the student's class, the hod of their department, or the principal
// of their college — enforced via studentService.assertCanViewStudent,
// not reimplemented here.

const crypto = require('crypto');
const config = require('../config');
const studentRepository = require('../repositories/studentRepository');
const studentPhoneOtpRepository = require('../repositories/studentPhoneOtpRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const notificationService = require('./notificationService');
const studentService = require('./studentService');

// The only two students columns an OTP can ever target — phone/
// phone_verified is the student's own number, parent_phone/
// parent_phone_verified is the parent's. Anything else is rejected
// before any repository call, same "guard first" shape every other
// service in this codebase uses.
const VALID_TARGETS = ['phone', 'parent_phone'];

class PhoneVerificationValidationError extends Error {}

// requestOtp/verifyOtp given a studentId with no matching row.
class PhoneVerificationStudentNotFoundError extends Error {}

// requestOtp called for a target column that is currently empty on the
// student row (nothing to send an OTP to) — e.g. parent_phone was
// never entered.
class PhoneVerificationNoPhoneOnFileError extends Error {}

// verifyOtp called with no live (unconsumed, unexpired) OTP row for
// this student+target — never requested, already consumed, or expired
// naturally (not via attempts) since requestOtp was last called.
class PhoneVerificationNotRequestedError extends Error {}

// verifyOtp called against a row that has already hit
// config.otp.maxAttempts mismatched codes — locked out; the caller
// must request a fresh OTP (requestOtp always works regardless of a
// prior row's attempt count).
class PhoneVerificationMaxAttemptsExceededError extends Error {}

// verifyOtp given a code that does not match the live row's hash —
// attempts is incremented before this throws, so a caller retrying
// with a corrected code is still counted against the same cap.
class PhoneVerificationCodeMismatchError extends Error {}

function assertValidTarget(target) {
  if (!VALID_TARGETS.includes(target)) {
    throw new PhoneVerificationValidationError(`target ${JSON.stringify(target)} is not a known value`);
  }
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Generates a fresh 6-digit code, stores its hash with a
// config.otp.expireMinutes expiry, and sends it via WhatsApp to
// whichever phone the target column currently holds. A prior unconsumed
// OTP for the same student+target is simply superseded (never deleted
// or explicitly invalidated) — verifyOtp always matches the most
// recently created row, so the old one just stops being reachable.
async function requestOtp(client, studentId, target, { actorUserId, actorRole } = {}) {
  assertValidTarget(target);

  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new PhoneVerificationStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  // Same shared read-access boundary as reads/Finance (this session's
  // own task) — reused directly from studentService rather than
  // reimplemented; a StudentNotAuthorizedError from this call is
  // exactly what routes/students.js's error mapping already handles
  // for the other student routes.
  await studentService.assertCanViewStudent(client, student, { actorUserId, actorRole });

  const phone = student[target];
  if (!phone) {
    throw new PhoneVerificationNoPhoneOnFileError(`student ${JSON.stringify(studentId)} has no ${target} on file`);
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + config.otp.expireMinutes * 60 * 1000);

  await studentPhoneOtpRepository.create(client, {
    collegeId: student.college_id,
    studentId,
    target,
    phone,
    codeHash: hashCode(code),
    expiresAt,
  });

  const sendResult = await notificationService.sendViaChannel(client, {
    collegeId: student.college_id,
    channel: 'whatsapp',
    to: phone,
    body: `Your ARCNAVE verification code is ${code}. It expires in ${config.otp.expireMinutes} minutes.`,
  });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: student.college_id,
    userId: actorUserId || null,
    action: 'student_phone_otp_requested',
    entity: 'students',
    entityId: studentId,
    metadata: { target, deliveryStatus: sendResult.status },
  });

  return { expiresAt, deliveryStatus: sendResult.status };
}

// Matches the given code against the most recent live OTP row for
// this student+target, marks it consumed on success (single-use — see
// studentPhoneOtpRepository.findLatestActive, which never matches an
// already-consumed row again), and flips the corresponding
// students.phone_verified/parent_phone_verified column to true.
async function verifyOtp(client, studentId, target, code, { actorUserId, actorRole } = {}) {
  assertValidTarget(target);
  if (!code) {
    throw new PhoneVerificationValidationError('code is required');
  }

  const student = await studentRepository.findById(client, studentId);
  if (student === null) {
    throw new PhoneVerificationStudentNotFoundError(`student ${JSON.stringify(studentId)} does not exist`);
  }
  await studentService.assertCanViewStudent(client, student, { actorUserId, actorRole });

  const otpRow = await studentPhoneOtpRepository.findLatestActive(client, studentId, target);
  if (otpRow === null) {
    throw new PhoneVerificationNotRequestedError(`no live OTP found for student ${JSON.stringify(studentId)}, target ${JSON.stringify(target)}`);
  }

  if (otpRow.attempts >= config.otp.maxAttempts) {
    throw new PhoneVerificationMaxAttemptsExceededError(`OTP ${JSON.stringify(otpRow.id)} has exceeded the maximum number of attempts`);
  }

  if (hashCode(code) !== otpRow.code_hash) {
    await studentPhoneOtpRepository.incrementAttempts(client, otpRow.id);
    throw new PhoneVerificationCodeMismatchError('code does not match');
  }

  await studentPhoneOtpRepository.markConsumed(client, otpRow.id);

  const verifiedField = target === 'phone' ? 'phoneVerified' : 'parentPhoneVerified';
  const updatedStudent = await studentRepository.update(client, studentId, { [verifiedField]: true });

  await auditLogRepository.createAuditLogEntry(client, {
    collegeId: student.college_id,
    userId: actorUserId || null,
    action: 'student_phone_otp_verified',
    entity: 'students',
    entityId: studentId,
    metadata: { target },
  });

  return updatedStudent;
}

module.exports = {
  PhoneVerificationValidationError,
  PhoneVerificationStudentNotFoundError,
  PhoneVerificationNoPhoneOnFileError,
  PhoneVerificationNotRequestedError,
  PhoneVerificationMaxAttemptsExceededError,
  PhoneVerificationCodeMismatchError,
  requestOtp,
  verifyOtp,
};
