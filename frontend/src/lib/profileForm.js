import { z } from 'zod';
import { isRangeOrdered, parseDOB, formatDOB } from './profileData';

/**
 * The profile form's shape and rules, kept out of the drawer so they can be
 * tested on their own and so the "which fields belong to which section"
 * mapping has one home.
 *
 * Dates live in the form as the DD/MM/YYYY text the user actually sees, and
 * are converted to ISO only on save — a native `<input type="date">` renders
 * in the browser's locale, which is exactly how a DD/MM institution ends up
 * reading dates as MM/DD.
 */

export const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

const institutionSchema = z.object({
  id: z.string(),
  institutionName: z.string().trim().min(1, 'Institution name is required.'),
  designationHeld: z.string().trim().optional().default(''),
  from: z.string().default(''),
  to: z.string().default(''),
});

export const profileSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required.'),
    lastName: z.string().trim().min(1, 'Last name is required.'),
    email: z.string().trim().min(1, 'Email is required.').email('Enter a valid email address.'),
    dateOfBirth: z.string().trim().min(1, 'Date of birth is required.'),
    gender: z.string().min(1, 'Select a gender.'),
    designation: z.string().min(1, 'Select a designation.'),
    designationOther: z.string().trim().optional().default(''),
    appointmentType: z.string().trim().optional().default(''),
    hasDoctorate: z.boolean().default(false),
    ugQualification: z.string().optional().default(''),
    ugQualificationOther: z.string().trim().optional().default(''),
    ugSpecialization: z.string().trim().optional().default(''),
    pgQualification: z.string().optional().default(''),
    pgQualificationOther: z.string().trim().optional().default(''),
    pgSpecialization: z.string().trim().optional().default(''),
    totalExperienceYears: z.string().trim().optional().default(''),
    previousInstitutions: z.array(institutionSchema).default([]),
  })
  .superRefine((v, ctx) => {
    const dob = parseDOB(v.dateOfBirth);
    if (v.dateOfBirth && !dob) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Use DD/MM/YYYY.' });
    } else if (dob && dob > TODAY_ISO()) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Date of birth cannot be in the future.' });
    }
    if (v.designation === 'Other' && !v.designationOther.trim()) {
      ctx.addIssue({ code: 'custom', path: ['designationOther'], message: 'Specify the designation.' });
    }
    if (v.ugQualification === 'Other' && !v.ugQualificationOther.trim()) {
      ctx.addIssue({ code: 'custom', path: ['ugQualificationOther'], message: 'Specify the UG qualification.' });
    }
    if (v.pgQualification === 'Other' && !v.pgQualificationOther.trim()) {
      ctx.addIssue({ code: 'custom', path: ['pgQualificationOther'], message: 'Specify the PG qualification.' });
    }
    if (v.totalExperienceYears !== '') {
      const n = Number(v.totalExperienceYears);
      if (Number.isNaN(n)) {
        ctx.addIssue({ code: 'custom', path: ['totalExperienceYears'], message: 'Enter a number, for example 7.5.' });
      } else if (n < 0) {
        ctx.addIssue({ code: 'custom', path: ['totalExperienceYears'], message: 'Experience cannot be negative.' });
      } else if (n > 60) {
        ctx.addIssue({ code: 'custom', path: ['totalExperienceYears'], message: 'Enter 60 years or less.' });
      }
    }
    v.previousInstitutions.forEach((entry, i) => {
      if (!isRangeOrdered(entry.from, entry.to)) {
        ctx.addIssue({
          code: 'custom',
          path: ['previousInstitutions', i, 'to'],
          message: '“To” cannot be before “From”.',
        });
      }
    });
  });

/**
 * Which fields each editable section owns. Saving a section validates only
 * these, so an incomplete field in a section the user isn't touching can never
 * block the one they are.
 */
export const SECTION_FIELDS = {
  identity: [
    'firstName',
    'lastName',
    'email',
    'dateOfBirth',
    'gender',
    'designation',
    'designationOther',
    'appointmentType',
  ],
  education: [
    'hasDoctorate',
    'ugQualification',
    'ugQualificationOther',
    'ugSpecialization',
    'pgQualification',
    'pgQualificationOther',
    'pgSpecialization',
    'totalExperienceYears',
  ],
  previous: ['previousInstitutions'],
};

export function toFormValues(p) {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    dateOfBirth: formatDOB(p.dateOfBirth),
    gender: p.gender,
    designation: p.designation,
    designationOther: p.designationOther ?? '',
    appointmentType: p.appointmentType ?? '',
    hasDoctorate: Boolean(p.hasDoctorate),
    ugQualification: p.ugQualification ?? '',
    ugQualificationOther: p.ugQualificationOther ?? '',
    ugSpecialization: p.ugSpecialization ?? '',
    pgQualification: p.pgQualification ?? '',
    pgQualificationOther: p.pgQualificationOther ?? '',
    pgSpecialization: p.pgSpecialization ?? '',
    totalExperienceYears:
      p.totalExperienceYears === '' || p.totalExperienceYears == null ? '' : String(p.totalExperienceYears),
    previousInstitutions: (p.previousInstitutions ?? []).map((e) => ({ ...e })),
  };
}
