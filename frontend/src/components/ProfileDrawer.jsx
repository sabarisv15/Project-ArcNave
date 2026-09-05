import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Avatar from '@radix-ui/react-avatar';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Camera, Lock, LogOut, X } from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspace } from '../store/WorkspaceProvider';
import { cn } from '../lib/utils';
import { AutosaveStatus, DraftRestoredNote } from './AutosaveStatus';
import { useAutosave, useRestoredDraft } from '../hooks/useAutosave';
import { draftKey } from '../lib/draftStore';
import { ME } from '../lib/substituteData';
import { CheckboxField, DateField, Field, FieldGrid, PROFILE_CONTROL, ProfileSelect, ReadRow } from './ProfileFields';
import { MobileVerification } from './MobileVerification';
import { SeatSwitcher } from './SeatSwitcher';
import { PreviousInstitutions, entryErrors } from './PreviousInstitutions';
import {
  DESIGNATIONS,
  GENDERS,
  PG_QUALIFICATIONS,
  PROFILE_RECORD,
  UG_QUALIFICATIONS,
  e164,
  formatDOB,
  parseDOB,
  profileCompletion,
  saveProfile,
} from '../lib/profileData';
import { SECTION_FIELDS, TODAY_ISO, profileSchema, toFormValues } from '../lib/profileForm';

/**
 * The profile, in one right-side drawer — and only there.
 *
 * Everything a staff member can see or change about themselves happens inside
 * this sheet: there is no profile route, no second drawer, and no full-screen
 * subsection, so opening the profile never costs the user the workspace they
 * were in. The AppShell and sidebar stay visible behind it, and closing puts
 * them back exactly as they were.
 *
 * Two boundaries shape the content, and neither is decorative:
 *
 *  1. **Institution-controlled vs. staff-maintained.** Staff ID and Department
 *     are definition rows under one section-level explanation — never disabled
 *     inputs, never a padlock per row — and `saveProfile()` strips them from
 *     any payload, so a hand-edited request can't move them either.
 *  2. **One section edits at a time.** Each editable section has its own small
 *     `Edit`; opening one closes another. That keeps the read view clean and
 *     makes it unambiguous which record is being changed.
 *
 * Edits autosave as a draft through the app's universal autosave contract, so
 * closing the drawer mid-edit — by button, backdrop or Escape — is
 * non-destructive: reopening restores the draft *and* the section it was left
 * in. Radix Dialog supplies the focus trap, the Escape/backdrop dismissal and
 * the focus return to the trigger.
 */

const PHOTO = 'https://i.pravatar.cc/240?img=47';

const SMALL_BTN =
  'h-[28px] px-[10px] rounded-[8px] font-sans text-[12px] font-[500] cursor-pointer transition-colors duration-200 disabled:opacity-45 disabled:cursor-not-allowed';

/** Compact section shell with its own inline Edit / Save · Cancel rail. */
function Section({ title, note, editing, onEdit, onSave, onCancel, saving, status, children, readOnly, plain }) {
  return (
    <section aria-label={title} className="border border-line rounded-[14px] bg-paper overflow-hidden">
      <header className="flex items-center justify-between gap-[10px] px-[13px] py-[9px] border-b border-line bg-mist">
        <div className="min-w-0">
          <h3 className="m-0 text-[13px] font-[600] tracking-[-.005em] text-ink">{title}</h3>
          {note && <p className="m-0 mt-[1px] text-[12px] font-[400] text-ink-faint">{note}</p>}
        </div>
        {/*
          `plain` — a section whose body is already its own control, so it has
          neither an Edit affordance nor a "View only" lock. Without it such a
          section would offer an Edit button that has nothing to edit.
        */}
        {plain ? null : readOnly ? (
          <span className="flex-none inline-flex items-center gap-[5px] text-[12px] font-[400] text-ink-faint">
            <Lock size={12} strokeWidth={1.9} aria-hidden="true" />
            View only
          </span>
        ) : editing ? (
          <div className="flex-none flex items-center gap-[7px]">
            <AutosaveStatus status={status} onRetry={onSave} />
            <button
              type="button"
              onClick={onCancel}
              className={cn(SMALL_BTN, 'border border-line bg-paper text-ink-muted hover:bg-tint2 hover:text-ink')}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className={cn(SMALL_BTN, 'border-0 bg-accent text-white hover:bg-accent-hover')}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${title.toLowerCase()}`}
            className={cn(
              SMALL_BTN,
              'flex-none border border-line bg-paper text-ink-muted hover:bg-tint2 hover:text-ink',
            )}
          >
            Edit
          </button>
        )}
      </header>
      <div className="px-[13px] py-[12px]">{children}</div>
    </section>
  );
}

export function ProfileDrawer() {
  const { profileDrawerOpen, setProfileDrawerOpen } = useWorkspace();
  const fileRef = useRef(null);
  const [pressed, setPressed] = useState(false);
  const timer = useRef(null);

  const [profile, setProfile] = useState(PROFILE_RECORD);
  const [editing, setEditing] = useState(null); // section id | null
  const [saving, setSaving] = useState(false);
  const [usedDraft, setUsedDraft] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  // Mobile is deliberately outside the form: its value is only ever promoted by
  // a successful server verification, so no form submit can carry it.
  const [mobile, setMobile] = useState({ dialCode: profile.mobileDialCode, number: profile.mobileNumber });
  const [verified, setVerified] = useState({
    phone: e164(profile.mobileDialCode, profile.mobileNumber),
    at: profile.mobileVerifiedAt,
  });

  const {
    control,
    register,
    reset,
    watch,
    trigger,
    getValues,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: toFormValues(PROFILE_RECORD),
    mode: 'onBlur',
  });

  const values = watch();

  const key = draftKey(ME.id, 'profile', 'me');
  const restored = useRestoredDraft(key, profileDrawerOpen);
  const autosave = useAutosave({
    value: { values, section: editing },
    storageKey: key,
    // The session mirror *is* the draft: there is no server-side draft for an
    // in-progress profile edit, so clearing it on save would throw away exactly
    // what reopening the drawer is meant to restore.
    keepLocalDraft: true,
    enabled: Boolean(editing),
    onSave: () => {},
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  // Recover an interrupted edit when the drawer reopens, once per open, and
  // resume the section it was left in.
  const seeded = useRef(false);
  useEffect(() => {
    if (!profileDrawerOpen) {
      seeded.current = false;
      return;
    }
    if (seeded.current || !restored?.value?.values) return;
    seeded.current = true;
    reset(restored.value.values, { keepDefaultValues: true });
    setEditing(restored.value.section ?? 'identity');
    setUsedDraft(true);
  }, [profileDrawerOpen, restored, reset]);

  const press = useCallback(() => {
    setPressed(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPressed(false), 520);
  }, []);
  const release = useCallback(() => {
    clearTimeout(timer.current);
    setPressed(false);
  }, []);

  const pickPhoto = () => fileRef.current?.click();

  const completion = profileCompletion({
    ...profile,
    ...values,
    dateOfBirth: parseDOB(values.dateOfBirth) || profile.dateOfBirth,
    mobileNumber: mobile.number,
    mobileVerifiedAt: verified.phone === e164(mobile.dialCode, mobile.number) ? verified.at : '',
  });

  const startEdit = (section) => {
    setUsedDraft(false);
    setEditing(section);
  };

  const cancelEdit = () => {
    autosave.markClean(); // the explicit "throw this away"
    reset(toFormValues(profile));
    setMobile({ dialCode: profile.mobileDialCode, number: profile.mobileNumber });
    setUsedDraft(false);
    setEditing(null);
  };

  /** Validates only the section being edited, so an unrelated field can't block it. */
  const saveSection = async (section) => {
    const ok = await trigger(SECTION_FIELDS[section]);
    if (!ok) return;
    if (section === 'previous' && values.previousInstitutions.some((e) => Object.keys(entryErrors(e)).length)) return;

    setSaving(true);
    try {
      const formValues = getValues();
      const payload = {
        ...formValues,
        dateOfBirth: parseDOB(formValues.dateOfBirth),
        totalExperienceYears: formValues.totalExperienceYears === '' ? '' : Number(formValues.totalExperienceYears),
      };
      await saveProfile(payload);
      setProfile((p) => ({ ...p, ...payload }));
      autosave.markClean(); // a real save took the draft
      setUsedDraft(false);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const onVerified = (at) => {
    const phone = e164(mobile.dialCode, mobile.number);
    setVerified({ phone, at });
    setProfile((p) => ({ ...p, mobileDialCode: mobile.dialCode, mobileNumber: mobile.number, mobileVerifiedAt: at }));
  };

  // Closing by any route flushes the pending autosave and deliberately keeps
  // the local draft, so reopening restores the work in progress.
  const onOpenChange = (open) => {
    if (!open) autosave.flush();
    setProfileDrawerOpen(open);
  };

  const editProps = (section) => ({
    editing: editing === section,
    onEdit: () => startEdit(section),
    onCancel: cancelEdit,
    onSave: () => saveSection(section),
    saving,
    status: autosave.status,
  });

  return (
    <Dialog.Root open={profileDrawerOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-overlay/20 animate-fadeUp" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-[121] w-full sm:w-[520px] flex flex-col bg-raised border-l border-line-strong rounded-l-[20px] shadow-dialog outline-none overflow-hidden data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 data-[state=open]:fade-in duration-200 ease-out motion-reduce:animate-none">
          {/*
            Two bands: a compact identity header carrying the drawer's two
            controls, and the scrolling profile content that runs to the bottom
            edge. The scroller carries `min-h-0` so it can actually shrink
            inside the flex column — without it a long previous-institutions
            list or an open OTP panel clips instead of scrolling.
          */}
          {/* Compact identity header — a row, not a banner. */}
          <div className="shrink-0 flex items-center gap-[11px] px-[16px] py-[12px] border-b border-line bg-paper">
            <div className="relative flex-none w-[40px] h-[40px]">
              <button
                type="button"
                aria-label="Preview profile photo"
                onPointerDown={press}
                onPointerUp={release}
                onPointerLeave={release}
                className="w-[40px] h-[40px] p-0 border-0 bg-transparent rounded-full cursor-pointer block"
              >
                <Avatar.Root
                  className={cn(
                    'w-[40px] h-[40px] rounded-full border-[2px] border-paper overflow-hidden block shadow-avatar transition-transform duration-200 ease-[cubic-bezier(.2,.9,.28,1.2)] motion-reduce:transform-none',
                    pressed ? 'scale-[1.06]' : 'scale-100',
                  )}
                >
                  <Avatar.Image src={PHOTO} alt="" className="w-full h-full object-cover" />
                  {/* Same amber avatar tone as the rail's profile row. */}
                  <Avatar.Fallback className="w-full h-full grid place-items-center bg-warm-soft text-warm text-[14px] font-[500]">
                    {profile.firstName[0]}
                    {profile.lastName[0]}
                  </Avatar.Fallback>
                </Avatar.Root>
              </button>
              <button
                type="button"
                aria-label="Edit profile photo"
                title="Edit profile photo"
                onClick={pickPhoto}
                className="absolute -right-[3px] -bottom-[3px] w-[19px] h-[19px] grid place-items-center border-[2px] border-paper bg-accent text-white rounded-full cursor-pointer transition-colors duration-200 hover:bg-accent-hover"
              >
                <Camera size={9} strokeWidth={2.2} />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) toast('Photo selected. Upload is not available in this preview');
                  e.target.value = '';
                }}
              />
            </div>

            <div className="min-w-0 flex-1">
              <Dialog.Title className="m-0 text-[15px] font-[600] tracking-[-.008em] text-ink truncate">
                {profile.firstName} {profile.lastName}
              </Dialog.Title>
              <p className="m-0 text-[12px] font-[400] text-ink-faint truncate">
                {profile.staffId} · {profile.departmentName} · {completion}% complete
              </p>
            </div>

            {/*
              Sign out lives in the header, beside Close, as an icon the width
              of a control rather than a sticky footer band across the bottom
              of the sheet: it is one action, taken rarely, and a whole
              reserved row of drawer height was the most prominent thing in a
              drawer that is about the profile. Quiet neutral by default —
              signing out is not destructive enough to earn a red button — with
              the restrained red kept for hover and keyboard focus, and the
              same confirmation dialog behind it.
            */}
            <button
              type="button"
              aria-label="Sign out"
              title="Sign out"
              onClick={() => setSignOutOpen(true)}
              className="flex-none w-[30px] h-[30px] grid place-items-center border-0 bg-transparent rounded-[9px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-danger-soft hover:text-danger focus-visible:bg-danger-soft focus-visible:text-danger"
            >
              <LogOut size={16} strokeWidth={1.85} aria-hidden="true" />
            </button>

            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close profile"
                title="Close"
                className="flex-none w-[30px] h-[30px] grid place-items-center border-0 bg-transparent rounded-[9px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent"
              >
                <X size={17} strokeWidth={1.9} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Your ArcNave profile: institutional details, identity and contact, education and experience, and previous
            institutions.
          </Dialog.Description>

          {/*
            A plain block scroller with `space-y`, deliberately *not* a flex
            column. As a flex column the sections inherited `flex-shrink: 1`, so
            a long previous-institutions list compressed the section instead of
            growing it — and because each section clips its own corners with
            `overflow-hidden`, the surplus entries were silently cut off while
            the scroller still reported no overflow to scroll.
          */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-quiet px-[16px] pt-[14px] pb-[calc(20px+env(safe-area-inset-bottom))] space-y-[11px]">
            {usedDraft && (
              <div className="flex items-center gap-[6px] text-[12px] text-ink-faint">
                <DraftRestoredNote show />
                <span>— your unsaved changes were recovered.</span>
              </div>
            )}

            <Section title="Institutional details" note="Managed by the institution" readOnly>
              <FieldGrid>
                <ReadRow label="Staff ID" value={profile.staffId} />
                <ReadRow label="Department" value={profile.departmentName} />
              </FieldGrid>
              <p className="m-0 mt-[10px] text-[12px] font-[400] text-ink-faint">
                To change these, contact your HOD, the Principal or an authorised administrator.
              </p>
            </Section>

            {/*
              Its own section rather than a row inside "Institutional details"
              above: that block is explicitly View only, and an interactive
              control sitting inside a locked section would contradict the one
              thing that section exists to say.
            */}
            <Section title="Workspace view" note="Preview role-specific workspace" plain>
              <SeatSwitcher />
            </Section>

            <Section title="Identity and contact" {...editProps('identity')}>
              {editing === 'identity' ? (
                <FieldGrid>
                  <Field label="First name" required error={errors.firstName?.message}>
                    {(id) => (
                      <input
                        id={id}
                        autoComplete="given-name"
                        className={PROFILE_CONTROL}
                        {...register('firstName', { onChange: autosave.schedule })}
                      />
                    )}
                  </Field>
                  <Field label="Last name" required error={errors.lastName?.message}>
                    {(id) => (
                      <input
                        id={id}
                        autoComplete="family-name"
                        className={PROFILE_CONTROL}
                        {...register('lastName', { onChange: autosave.schedule })}
                      />
                    )}
                  </Field>
                  <Field label="Email" required error={errors.email?.message}>
                    {(id) => (
                      <input
                        id={id}
                        type="email"
                        autoComplete="email"
                        className={PROFILE_CONTROL}
                        {...register('email', { onChange: autosave.schedule })}
                      />
                    )}
                  </Field>
                  <Field label="Date of birth" required error={errors.dateOfBirth?.message}>
                    {(id) => (
                      <Controller
                        control={control}
                        name="dateOfBirth"
                        render={({ field }) => (
                          <DateField
                            id={id}
                            ariaLabel="Date of birth, DD/MM/YYYY"
                            max={TODAY_ISO()}
                            value={field.value}
                            onChange={(v) => {
                              field.onChange(v);
                              autosave.schedule();
                            }}
                          />
                        )}
                      />
                    )}
                  </Field>
                  <Field label="Gender" required error={errors.gender?.message}>
                    {(id) => (
                      <Controller
                        control={control}
                        name="gender"
                        render={({ field }) => (
                          <ProfileSelect
                            id={id}
                            ariaLabel="Gender"
                            value={field.value}
                            options={GENDERS}
                            onChange={(v) => {
                              field.onChange(v);
                              autosave.schedule();
                            }}
                          />
                        )}
                      />
                    )}
                  </Field>
                  <Field label="Designation" required error={errors.designation?.message}>
                    {(id) => (
                      <Controller
                        control={control}
                        name="designation"
                        render={({ field }) => (
                          <ProfileSelect
                            id={id}
                            ariaLabel="Designation"
                            value={field.value}
                            options={DESIGNATIONS}
                            onChange={(v) => {
                              field.onChange(v);
                              autosave.schedule();
                            }}
                          />
                        )}
                      />
                    )}
                  </Field>
                  {values.designation === 'Other' && (
                    <Field label="Specify designation" required error={errors.designationOther?.message}>
                      {(id) => (
                        <input
                          id={id}
                          className={PROFILE_CONTROL}
                          placeholder="Your designation"
                          {...register('designationOther', { onChange: autosave.schedule })}
                        />
                      )}
                    </Field>
                  )}
                  <Field label="Appointment type" error={errors.appointmentType?.message}>
                    {(id) => (
                      <input
                        id={id}
                        className={PROFILE_CONTROL}
                        placeholder="e.g. Permanent, Guest, Contract"
                        {...register('appointmentType', { onChange: autosave.schedule })}
                      />
                    )}
                  </Field>

                  <MobileVerification
                    editing
                    dialCode={mobile.dialCode}
                    number={mobile.number}
                    verifiedPhone={verified.phone}
                    verifiedAt={verified.at}
                    onChange={setMobile}
                    onVerified={onVerified}
                  />
                </FieldGrid>
              ) : (
                <FieldGrid>
                  <ReadRow label="First name" value={profile.firstName} />
                  <ReadRow label="Last name" value={profile.lastName} />
                  <ReadRow label="Email" value={profile.email} />
                  <ReadRow label="Date of birth" value={formatDOB(profile.dateOfBirth)} />
                  <ReadRow label="Gender" value={profile.gender} />
                  <ReadRow
                    label="Designation"
                    value={profile.designation === 'Other' ? profile.designationOther : profile.designation}
                  />
                  <ReadRow label="Appointment type" value={profile.appointmentType} />
                  <MobileVerification
                    editing={false}
                    dialCode={mobile.dialCode}
                    number={mobile.number}
                    verifiedPhone={verified.phone}
                    verifiedAt={verified.at}
                    onChange={setMobile}
                    onVerified={onVerified}
                  />
                </FieldGrid>
              )}
            </Section>

            <Section title="Education and experience" {...editProps('education')}>
              {editing === 'education' ? (
                <div className="flex flex-col gap-[12px]">
                  <Controller
                    control={control}
                    name="hasDoctorate"
                    render={({ field }) => (
                      <CheckboxField
                        checked={field.value}
                        onChange={(v) => {
                          field.onChange(v);
                          autosave.schedule();
                        }}
                        label="Doctorate completed"
                      />
                    )}
                  />
                  <FieldGrid>
                    <Field label="UG qualification" error={errors.ugQualification?.message}>
                      {(id) => (
                        <Controller
                          control={control}
                          name="ugQualification"
                          render={({ field }) => (
                            <ProfileSelect
                              id={id}
                              ariaLabel="UG qualification"
                              value={field.value}
                              options={UG_QUALIFICATIONS}
                              onChange={(v) => {
                                field.onChange(v);
                                autosave.schedule();
                              }}
                            />
                          )}
                        />
                      )}
                    </Field>
                    {values.ugQualification === 'Other' && (
                      <Field label="Specify UG qualification" required error={errors.ugQualificationOther?.message}>
                        {(id) => (
                          <input
                            id={id}
                            className={PROFILE_CONTROL}
                            {...register('ugQualificationOther', { onChange: autosave.schedule })}
                          />
                        )}
                      </Field>
                    )}
                    <Field label="UG specialization" error={errors.ugSpecialization?.message}>
                      {(id) => (
                        <input
                          id={id}
                          className={PROFILE_CONTROL}
                          placeholder="e.g. Computer Science"
                          {...register('ugSpecialization', { onChange: autosave.schedule })}
                        />
                      )}
                    </Field>
                    <Field label="PG qualification" error={errors.pgQualification?.message}>
                      {(id) => (
                        <Controller
                          control={control}
                          name="pgQualification"
                          render={({ field }) => (
                            <ProfileSelect
                              id={id}
                              ariaLabel="PG qualification"
                              value={field.value}
                              options={PG_QUALIFICATIONS}
                              onChange={(v) => {
                                field.onChange(v);
                                autosave.schedule();
                              }}
                            />
                          )}
                        />
                      )}
                    </Field>
                    {values.pgQualification === 'Other' && (
                      <Field label="Specify PG qualification" required error={errors.pgQualificationOther?.message}>
                        {(id) => (
                          <input
                            id={id}
                            className={PROFILE_CONTROL}
                            {...register('pgQualificationOther', { onChange: autosave.schedule })}
                          />
                        )}
                      </Field>
                    )}
                    <Field label="PG specialization" error={errors.pgSpecialization?.message}>
                      {(id) => (
                        <input
                          id={id}
                          className={PROFILE_CONTROL}
                          placeholder="e.g. Software Engineering"
                          {...register('pgSpecialization', { onChange: autosave.schedule })}
                        />
                      )}
                    </Field>
                    <Field label="Total years of experience" error={errors.totalExperienceYears?.message}>
                      {(id) => (
                        <input
                          id={id}
                          type="number"
                          min="0"
                          max="60"
                          step="0.5"
                          placeholder="e.g. 7.5"
                          className={PROFILE_CONTROL}
                          {...register('totalExperienceYears', { onChange: autosave.schedule })}
                        />
                      )}
                    </Field>
                  </FieldGrid>
                </div>
              ) : (
                <FieldGrid>
                  <ReadRow label="Doctorate" value={profile.hasDoctorate ? 'Completed' : 'Not completed'} />
                  <ReadRow
                    label="UG qualification"
                    value={[
                      profile.ugQualification === 'Other' ? profile.ugQualificationOther : profile.ugQualification,
                      profile.ugSpecialization,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                  <ReadRow
                    label="PG qualification"
                    value={[
                      profile.pgQualification === 'Other' ? profile.pgQualificationOther : profile.pgQualification,
                      profile.pgSpecialization,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                  <ReadRow
                    label="Total experience"
                    value={profile.totalExperienceYears === '' ? '' : `${profile.totalExperienceYears} years`}
                  />
                </FieldGrid>
              )}
            </Section>

            <Section
              title="Previous institutions"
              note={editing === 'previous' ? 'Add every institution you worked at before this one.' : undefined}
              {...editProps('previous')}
            >
              <Controller
                control={control}
                name="previousInstitutions"
                render={({ field }) => (
                  <PreviousInstitutions
                    editing={editing === 'previous'}
                    entries={editing === 'previous' ? field.value : profile.previousInstitutions}
                    onChange={(next) => {
                      field.onChange(next);
                      autosave.schedule();
                    }}
                  />
                )}
              />
            </Section>
          </div>

          <AlertDialog.Root open={signOutOpen} onOpenChange={setSignOutOpen}>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="fixed inset-0 z-[130] bg-overlay/20 animate-fadeUp" />
              <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[131] w-[min(380px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-line bg-paper p-[18px] shadow-dialog outline-none data-[state=open]:animate-fadeUp motion-reduce:animate-none">
                <AlertDialog.Title className="m-0 text-[15px] font-[600] text-ink">
                  Sign out of ArcNave?
                </AlertDialog.Title>
                <AlertDialog.Description className="mt-[5px] text-[13px] font-[400] text-ink-muted">
                  Unsaved profile changes are kept as a draft and will be waiting when you sign back in.
                </AlertDialog.Description>
                <div className="mt-[16px] flex justify-end gap-[8px]">
                  <AlertDialog.Cancel asChild>
                    <button
                      type="button"
                      className="h-[34px] px-[14px] rounded-[9px] border border-line bg-paper font-sans text-[13px] font-[500] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink"
                    >
                      Stay signed in
                    </button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <button
                      type="button"
                      onClick={() => {
                        autosave.flush(); // the draft outlives the session, so land it first
                        setSignOutOpen(false);
                        // There is no authentication layer in this prototype; this is
                        // the one line to replace with the real sign-out call.
                        toast('Signed out. Authentication is not wired up in this preview.');
                      }}
                      className="h-[34px] px-[14px] rounded-[9px] border-0 bg-danger font-sans text-[13px] font-[500] text-white cursor-pointer transition-colors duration-200 hover:bg-danger-hover"
                    >
                      Sign out
                    </button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
