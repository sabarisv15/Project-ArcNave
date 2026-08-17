/**
 * The signed-in staff member's own profile.
 *
 * Two clearly different kinds of data live in one record, and the difference is
 * structural, not cosmetic:
 *
 *  - **Institution-controlled** (`staffId`, `departmentId`/`departmentName`).
 *    The staff member can read these and nothing else. They are not rendered as
 *    disabled inputs — a disabled box invites a fight with the form — they are
 *    definition rows under one section-level explanation, and `saveProfile()`
 *    strips them from any payload so a hand-edited request can't move them
 *    either. Only a Principal/HOD/authorised administrator changes them, from
 *    their own screens.
 *  - **Staff-maintained** — identity, contact, education, experience and the
 *    previous-institution list.
 *
 * Mock-only: `PROFILE_RECORD` stands in for `GET/PATCH /staff/me`, and the OTP
 * challenge below stands in for the server's WhatsApp verification endpoint.
 * Keep the shapes when swapping in the real API. The important part to preserve
 * is *where the decisions are made*: the verified state of a mobile number is
 * decided here (the "server"), never by the form. The form only ever renders
 * what it is told.
 */

export const GENDERS = ['Male', 'Female', 'Other'];

export const DESIGNATIONS = [
  'Professor',
  'Associate Professor',
  'Assistant Professor',
  'Lecturer',
  'HOD',
  'Lab Assistant',
  'Librarian',
  'Physical Director',
  'Office Staff',
  'Other',
];

export const UG_QUALIFICATIONS = [
  'B.A.', 'B.Sc.', 'B.Com.', 'B.B.A.', 'B.C.A.', 'B.E.', 'B.Tech.', 'B.Ed.', 'B.Pharm.', 'B.Arch.', 'Other',
];

export const PG_QUALIFICATIONS = [
  'M.A.', 'M.Sc.', 'M.Com.', 'M.B.A.', 'M.C.A.', 'M.E.', 'M.Tech.', 'M.Ed.', 'M.Pharm.', 'Other',
];

/** India-first, but the dial code is data rather than a hardcoded prefix. */
export const DIAL_CODES = [
  { value: '+91', label: '+91 · India' },
  { value: '+971', label: '+971 · UAE' },
  { value: '+65', label: '+65 · Singapore' },
  { value: '+44', label: '+44 · UK' },
];

export const DEFAULT_DIAL_CODE = '+91';

/** The one staff-editable shape. `staffId`/`department*` are read-only members of it. */
export const PROFILE_RECORD = {
  staffId: 'ARC/CSE/2019/0142',
  departmentId: 'dept-cse',
  departmentName: 'Computer Science',

  firstName: 'Priya',
  lastName: 'Ramesh',
  email: 'priya.ramesh@arcnave.edu',
  dateOfBirth: '1987-04-12', // stored ISO, always displayed DD/MM/YYYY
  gender: 'Female',
  designation: 'Assistant Professor',
  designationOther: '',
  appointmentType: 'Permanent · Aided',

  mobileDialCode: '+91',
  mobileNumber: '9842211730',
  mobileVerifiedAt: '2026-06-02T09:14:00.000Z',

  hasDoctorate: false,
  ugQualification: 'B.E.',
  ugQualificationOther: '',
  ugSpecialization: 'Computer Science and Engineering',
  pgQualification: 'M.E.',
  pgQualificationOther: '',
  pgSpecialization: 'Software Engineering',
  totalExperienceYears: 7.5,

  previousInstitutions: [
    {
      id: 'pi-1',
      institutionName: 'Kongu Institute of Technology',
      designationHeld: 'Lecturer',
      from: '2013-06',
      to: '2016-05',
    },
    {
      id: 'pi-2',
      institutionName: 'SRM Arts and Science College',
      designationHeld: 'Assistant Professor',
      from: '2016-07',
      to: '2019-04',
    },
  ],
};

/** Fields the institution owns. Never sent, never editable, never a disabled input. */
export const INSTITUTIONAL_FIELDS = ['staffId', 'departmentId', 'departmentName'];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let stored = { ...PROFILE_RECORD, previousInstitutions: [...PROFILE_RECORD.previousInstitutions] };

export async function loadProfile() {
  await delay(120);
  return { ...stored, previousInstitutions: stored.previousInstitutions.map((e) => ({ ...e })) };
}

/**
 * Persists the staff-editable part of the profile. Institution-controlled
 * fields and the verified-mobile stamp are dropped rather than trusted: the
 * mobile number reaches the record only through `verifyMobileOtp`, so a saved
 * form can never quietly promote an unverified number.
 */
export async function saveProfile(patch) {
  await delay(260);
  const clean = { ...patch };
  for (const field of [...INSTITUTIONAL_FIELDS, 'mobileVerifiedAt']) delete clean[field];
  delete clean.mobileNumber;
  delete clean.mobileDialCode;
  stored = { ...stored, ...clean };
  return { savedAt: new Date().toISOString() };
}

/* ------------------------------------------------------------------ *
 * Mobile verification (WhatsApp OTP)
 * ------------------------------------------------------------------ */

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Prototype stand-in for a real delivered code. There is no WhatsApp gateway
 * here, so a fixed code is the only way the flow can be exercised — it is
 * compared inside this module and is never returned to the caller, written to
 * component state, or logged. Delete this constant, `OTP_PROTOTYPE_NOTE` and
 * the note's one render site when the real send endpoint is wired.
 */
const PROTOTYPE_CODE = '123456';
export const OTP_PROTOTYPE_NOTE = `Prototype only — no WhatsApp message is sent. Enter ${PROTOTYPE_CODE} to complete verification.`;

/** One outstanding challenge at a time: issuing a new code invalidates the old one. */
let challenge = null;

function otpError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function e164(dialCode, number) {
  return `${dialCode}${String(number).replace(/\D/g, '')}`;
}

/** `+91 ····· 1730` — enough to recognise the number, not enough to disclose it. */
export function maskPhone(dialCode, number) {
  const digits = String(number).replace(/\D/g, '');
  if (digits.length < 4) return `${dialCode} ${'·'.repeat(digits.length)}`;
  return `${dialCode} ${'·'.repeat(Math.max(digits.length - 4, 0))} ${digits.slice(-4)}`;
}

/**
 * Sends a six-digit code over WhatsApp. Resending replaces the challenge, so
 * the previous code stops working immediately, and a fixed cooldown makes
 * hammering the endpoint pointless. The code itself never leaves this module.
 */
export async function sendMobileOtp(phone, now = Date.now()) {
  if (challenge && challenge.phone === phone) {
    const waited = now - challenge.issuedAt;
    if (waited < OTP_RESEND_COOLDOWN_MS) {
      throw Object.assign(otpError('cooldown', 'Please wait before requesting another code.'), {
        retryInMs: OTP_RESEND_COOLDOWN_MS - waited,
      });
    }
  }
  await delay(420);
  challenge = { phone, issuedAt: now, expiresAt: now + OTP_TTL_MS, attempts: 0 };
  return {
    channel: 'whatsapp',
    resendInMs: OTP_RESEND_COOLDOWN_MS,
    expiresInMs: OTP_TTL_MS,
  };
}

/**
 * The only way a number becomes verified. On success the record is updated
 * here — the caller receives a timestamp, not permission to set one itself.
 */
export async function verifyMobileOtp(phone, code, now = Date.now()) {
  await delay(380);
  if (!challenge || challenge.phone !== phone) {
    throw otpError('expired', 'That code is no longer valid. Request a new one.');
  }
  if (now > challenge.expiresAt) {
    challenge = null;
    throw otpError('expired', 'This code has expired. Request a new one.');
  }
  challenge.attempts += 1;
  if (challenge.attempts > OTP_MAX_ATTEMPTS) {
    challenge = null;
    throw otpError('locked', 'Too many attempts. Request a new code.');
  }
  if (String(code) !== PROTOTYPE_CODE) {
    throw otpError('invalid', 'The code is incorrect. Try again.');
  }
  challenge = null;

  const dialCode = DIAL_CODES.find((d) => phone.startsWith(d.value))?.value ?? DEFAULT_DIAL_CODE;
  const verifiedAt = new Date(now).toISOString();
  stored = {
    ...stored,
    mobileDialCode: dialCode,
    mobileNumber: phone.slice(dialCode.length),
    mobileVerifiedAt: verifiedAt,
  };
  return { verifiedAt };
}

/** Test/reset seam — also what a sign-out would call. */
export function resetOtpChallenge() {
  challenge = null;
}

/* ------------------------------------------------------------------ *
 * Formatting + derived values
 * ------------------------------------------------------------------ */

/** `1987-04-12` → `12/04/1987`. Returns '' for anything unparseable. */
export function formatDOB(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** `12/04/1987` → `1987-04-12`, or '' if the date isn't a real calendar date. */
export function parseDOB(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text).trim());
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
  if (d.getUTCFullYear() !== +yyyy || d.getUTCMonth() !== +mm - 1 || d.getUTCDate() !== +dd) return '';
  return `${yyyy}-${mm}-${dd}`;
}

/** `2013-06` → `06/2013`. One format everywhere a month/year is shown. */
export function formatMonth(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  return m ? `${m[2]}/${m[1]}` : '';
}

/** A previous-institution entry as one compact read-mode line. */
export function institutionSummary(entry) {
  const range = `${formatMonth(entry.from) || '—'}–${entry.to ? formatMonth(entry.to) : 'Present'}`;
  return [entry.institutionName, entry.designationHeld, range].filter(Boolean).join(' · ');
}

/**
 * How much of the *staff-maintained* profile is filled in. Institution-owned
 * fields are excluded on purpose — the staff member cannot act on them, so
 * counting them would show a number they can never move.
 */
export function profileCompletion(p) {
  const required = [
    p.firstName, p.lastName, p.email, p.dateOfBirth, p.gender,
    p.designation === 'Other' ? p.designationOther : p.designation,
    p.appointmentType,
    p.mobileNumber && p.mobileVerifiedAt ? 'verified' : '',
    p.ugQualification === 'Other' ? p.ugQualificationOther : p.ugQualification,
    p.ugSpecialization,
    p.pgQualification === 'Other' ? p.pgQualificationOther : p.pgQualification,
    p.pgSpecialization,
    p.totalExperienceYears === 0 || p.totalExperienceYears ? String(p.totalExperienceYears) : '',
  ];
  const filled = required.filter((v) => String(v ?? '').trim() !== '').length;
  return Math.round((filled / required.length) * 100);
}

/** A `from`/`to` pair is valid when `to` is empty (Present) or not before `from`. */
export function isRangeOrdered(from, to) {
  if (!from || !to) return true;
  return from <= to;
}
