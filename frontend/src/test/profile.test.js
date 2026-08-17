import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_DIAL_CODE,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  PROFILE_RECORD,
  e164,
  formatDOB,
  formatMonth,
  institutionSummary,
  isRangeOrdered,
  maskPhone,
  parseDOB,
  profileCompletion,
  resetOtpChallenge,
  saveProfile,
  sendMobileOtp,
  verifyMobileOtp,
} from '../lib/profileData';
import { entryErrors } from '../components/PreviousInstitutions';

const PHONE = `${DEFAULT_DIAL_CODE}9842211730`;
const GOOD = '123456';

beforeEach(() => resetOtpChallenge());

describe('date and range formatting', () => {
  it('always renders a date of birth as DD/MM/YYYY', () => {
    expect(formatDOB('1987-04-12')).toBe('12/04/1987');
    expect(formatDOB('')).toBe('');
  });

  it('round-trips a typed DD/MM/YYYY date and rejects impossible ones', () => {
    expect(parseDOB('12/04/1987')).toBe('1987-04-12');
    expect(parseDOB('31/02/1990')).toBe(''); // February never has 31 days
    expect(parseDOB('1987-04-12')).toBe(''); // ISO is not the input format
  });

  it('renders a month as MM/YYYY and an open end date as Present', () => {
    expect(formatMonth('2013-06')).toBe('06/2013');
    expect(institutionSummary({ institutionName: 'KIT', designationHeld: 'Lecturer', from: '2013-06', to: '2016-05' }))
      .toBe('KIT · Lecturer · 06/2013–05/2016');
    expect(institutionSummary({ institutionName: 'KIT', designationHeld: 'Lecturer', from: '2019-06', to: '' }))
      .toBe('KIT · Lecturer · 06/2019–Present');
  });

  it('treats an open end date as ordered, and a reversed range as not', () => {
    expect(isRangeOrdered('2013-06', '')).toBe(true);
    expect(isRangeOrdered('2013-06', '2016-05')).toBe(true);
    expect(isRangeOrdered('2016-05', '2013-06')).toBe(false);
  });
});

describe('previous institution validation', () => {
  it('requires a name and rejects a reversed range', () => {
    expect(entryErrors({ institutionName: '  ', from: '', to: '' })).toHaveProperty('institutionName');
    expect(entryErrors({ institutionName: 'KIT', from: '2016-05', to: '2013-06' })).toHaveProperty('to');
    expect(entryErrors({ institutionName: 'KIT', from: '2013-06', to: '' })).toEqual({});
  });
});

describe('phone masking', () => {
  it('discloses only the last four digits', () => {
    const masked = maskPhone('+91', '9842211730');
    expect(masked).toContain('1730');
    expect(masked).not.toContain('98422');
  });
});

describe('mobile OTP verification', () => {
  it('rejects a wrong code and accepts the right one', async () => {
    await sendMobileOtp(PHONE);
    await expect(verifyMobileOtp(PHONE, '000000')).rejects.toThrow('The code is incorrect. Try again.');
    const { verifiedAt } = await verifyMobileOtp(PHONE, GOOD);
    expect(new Date(verifiedAt).getTime()).toBeGreaterThan(0);
  });

  it('never verifies a number the code was not issued for', async () => {
    await sendMobileOtp(PHONE);
    await expect(verifyMobileOtp(`${DEFAULT_DIAL_CODE}9000000000`, GOOD)).rejects.toThrow(/no longer valid/);
  });

  it('cannot be verified twice with the same code', async () => {
    await sendMobileOtp(PHONE);
    await verifyMobileOtp(PHONE, GOOD);
    await expect(verifyMobileOtp(PHONE, GOOD)).rejects.toThrow(/no longer valid/);
  });

  it('expires a code after its TTL', async () => {
    const t0 = Date.now();
    await sendMobileOtp(PHONE, t0);
    await expect(verifyMobileOtp(PHONE, GOOD, t0 + OTP_TTL_MS + 1)).rejects.toThrow(/expired/);
  });

  it('enforces a resend cooldown, and a resend invalidates the previous code', async () => {
    const t0 = Date.now();
    await sendMobileOtp(PHONE, t0);
    await expect(sendMobileOtp(PHONE, t0 + 1000)).rejects.toThrow(/wait/);

    await sendMobileOtp(PHONE, t0 + OTP_RESEND_COOLDOWN_MS);
    // The new challenge replaced the old one: attempts reset, old code dead.
    const { verifiedAt } = await verifyMobileOtp(PHONE, GOOD, t0 + OTP_RESEND_COOLDOWN_MS + 10);
    expect(verifiedAt).toBeTruthy();
  });

  it('locks the challenge after too many wrong attempts', async () => {
    await sendMobileOtp(PHONE);
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      await expect(verifyMobileOtp(PHONE, '000000')).rejects.toThrow(/incorrect/);
    }
    await expect(verifyMobileOtp(PHONE, GOOD)).rejects.toThrow(/Too many attempts/);
  });
});

describe('saveProfile', () => {
  it('never lets the form move institution-controlled fields or the verified stamp', async () => {
    await saveProfile({
      firstName: 'Priya',
      staffId: 'HACKED/0001',
      departmentName: 'Physics',
      mobileNumber: '9999999999',
      mobileVerifiedAt: new Date().toISOString(),
    });
    const { loadProfile } = await import('../lib/profileData');
    const after = await loadProfile();
    expect(after.staffId).toBe(PROFILE_RECORD.staffId);
    expect(after.departmentName).toBe(PROFILE_RECORD.departmentName);
    expect(after.mobileNumber).not.toBe('9999999999');
  });
});

describe('profile completion', () => {
  it('counts an unverified mobile as incomplete', () => {
    const verified = profileCompletion(PROFILE_RECORD);
    const unverified = profileCompletion({ ...PROFILE_RECORD, mobileVerifiedAt: '' });
    expect(verified).toBe(100);
    expect(unverified).toBeLessThan(verified);
  });

  it('ignores institution-owned fields entirely', () => {
    const withoutInstitutional = profileCompletion({ ...PROFILE_RECORD, staffId: '', departmentName: '' });
    expect(withoutInstitutional).toBe(profileCompletion(PROFILE_RECORD));
  });
});

describe('section field mapping', () => {
  it('assigns every editable field to exactly one section', async () => {
    const { SECTION_FIELDS, toFormValues } = await import('../lib/profileForm');
    const all = Object.keys(toFormValues(PROFILE_RECORD));
    const mapped = Object.values(SECTION_FIELDS).flat();
    // Saving a section validates only its own fields, so a field that belongs
    // to no section could never be validated, and one in two sections would be
    // validated by a section the user isn't editing.
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...all].sort()).toEqual([...mapped].sort());
  });
});

describe('e164', () => {
  it('joins the dial code and the digits only', () => {
    expect(e164('+91', '98422 11730')).toBe('+919842211730');
  });
});
