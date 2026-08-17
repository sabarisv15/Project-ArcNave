import { useEffect, useRef, useState } from 'react';
import { AlertCircle, BadgeCheck, ShieldAlert } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  DIAL_CODES,
  OTP_LENGTH,
  OTP_PROTOTYPE_NOTE,
  e164,
  maskPhone,
  sendMobileOtp,
  verifyMobileOtp,
} from '../lib/profileData';
import { Field, PROFILE_CONTROL, ProfileSelect } from './ProfileFields';

/**
 * Mobile number + its verified state.
 *
 * The rule this component exists to enforce: a number is verified because the
 * server said so, never because the form thinks so. `verifiedPhone` is the
 * number the server has on record; the moment the typed number differs from
 * it, the badge is gone and the field reads "Verification required" — there is
 * no local flag that could drift out of step with it, because there is no
 * local flag at all.
 *
 * Verification happens inline, in this panel. It never navigates away and
 * never opens over the form, so the rest of the profile keeps its values (and
 * its autosaved draft) while the code is being entered.
 */

const BADGE = 'inline-flex items-center gap-[5px] h-[22px] px-[8px] rounded-full text-[12px] font-[500]';

function VerifiedBadge({ verifiedAt }) {
  const when = verifiedAt ? new Date(verifiedAt) : null;
  return (
    <span
      className={cn(BADGE, 'border border-line bg-tint text-ink-muted')}
      title={when ? `Verified on ${when.toLocaleDateString('en-GB')}` : 'Verified'}
    >
      <BadgeCheck size={13} strokeWidth={2} className="text-accent" aria-hidden="true" />
      Verified
    </span>
  );
}

function UnverifiedBadge() {
  return (
    <span className={cn(BADGE, 'border border-line bg-tint text-ink-muted')}>
      <ShieldAlert size={13} strokeWidth={2} className="text-ink-faint" aria-hidden="true" />
      Verification required
    </span>
  );
}

const QUIET_BTN =
  'h-[36px] px-[13px] rounded-[9px] font-sans text-[13px] font-[500] cursor-pointer transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-45';

export function MobileVerification({
  editing,
  dialCode,
  number,
  verifiedPhone,
  verifiedAt,
  onChange,
  onVerified,
}) {
  const [phase, setPhase] = useState('idle'); // idle | sending | code | verifying
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const codeRef = useRef(null);

  const current = e164(dialCode, number);
  const digits = String(number).replace(/\D/g, '');
  const isVerified = Boolean(verifiedAt) && current === verifiedPhone;
  const canSend = digits.length >= 10 && !offline;

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Resend cooldown, ticked down locally; the server enforces the real one.
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Editing the number invalidates any challenge in flight — an old code must
  // never be verifiable against a new number.
  const changeNumber = (next) => {
    onChange({ dialCode, number: next.replace(/\D/g, '').slice(0, 12) });
    if (phase !== 'idle') {
      setPhase('idle');
      setCode('');
      setError('');
      setNotice('');
    }
  };

  const send = async ({ resend = false } = {}) => {
    setError('');
    setPhase('sending');
    try {
      const res = await sendMobileOtp(current);
      setPhase('code');
      setCode('');
      setResendIn(Math.round(res.resendInMs / 1000));
      setNotice(`${resend ? 'New code' : 'Code'} sent on WhatsApp to ${maskPhone(dialCode, number)}.`);
      requestAnimationFrame(() => codeRef.current?.focus());
    } catch (err) {
      setPhase(resend ? 'code' : 'idle');
      if (err.code === 'cooldown') setResendIn(Math.ceil((err.retryInMs ?? 0) / 1000));
      setError(err.message);
    }
  };

  const verify = async () => {
    setError('');
    setPhase('verifying');
    try {
      const { verifiedAt: at } = await verifyMobileOtp(current, code);
      setPhase('idle');
      setCode('');
      setNotice('');
      onVerified(at);
    } catch (err) {
      setPhase('code');
      setError(err.message);
      requestAnimationFrame(() => codeRef.current?.select());
    }
  };

  if (!editing) {
    return (
      <div>
        <div className="text-[12px] font-[400] text-ink-faint">Mobile number</div>
        <div className="mt-[2px] flex flex-wrap items-center gap-[8px]">
          <span className="text-[13.5px] font-[500] text-ink">
            {digits ? `${dialCode} ${digits}` : <span className="text-ink-faint font-[400]">Not provided</span>}
          </span>
          {digits ? (isVerified ? <VerifiedBadge verifiedAt={verifiedAt} /> : <UnverifiedBadge />) : null}
        </div>
      </div>
    );
  }

  const busy = phase === 'sending' || phase === 'verifying';

  return (
    <div className="sm:col-span-2">
      <div className="flex flex-wrap items-end gap-[10px]">
        <div className="w-[132px]">
          <Field label="Country code">
            {(id) => (
              <ProfileSelect
                id={id}
                ariaLabel="Country dialling code"
                value={dialCode}
                onChange={(v) => onChange({ dialCode: v, number })}
                options={DIAL_CODES}
              />
            )}
          </Field>
        </div>
        <div className="flex-1 min-w-[180px]">
          <Field label="Mobile number" required>
            {(id) => (
              <input
                id={id}
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="10-digit mobile number"
                value={number}
                onChange={(e) => changeNumber(e.target.value)}
                className={PROFILE_CONTROL}
              />
            )}
          </Field>
        </div>
        <div className="pb-[1px]">
          {isVerified ? (
            <VerifiedBadge verifiedAt={verifiedAt} />
          ) : (
            <button
              type="button"
              onClick={() => send()}
              disabled={!canSend || busy}
              className={cn(QUIET_BTN, 'border-0 bg-accent text-white hover:bg-accent-hover')}
            >
              {phase === 'sending' ? 'Sending…' : phase === 'code' ? 'Code sent' : 'Send code'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-[6px] flex flex-wrap items-center gap-[8px]">
        {!isVerified && <UnverifiedBadge />}
        {!isVerified && (
          <span className="text-[12px] font-[400] text-ink-faint">
            A six-digit code is sent on WhatsApp. The number is saved only once it is verified.
          </span>
        )}
        {offline && (
          <span className="text-[12px] font-[400] text-danger" role="status">
            You’re offline — reconnect to send a code.
          </span>
        )}
      </div>

      {(phase === 'code' || phase === 'verifying') && (
        <div className="mt-[10px] border border-line rounded-[12px] bg-tint p-[13px]">
          <div className="flex flex-wrap items-end gap-[10px]">
            <div>
              <label htmlFor="otp-code" className="block text-[12px] font-[500] text-ink-muted mb-[5px]">
                Enter the {OTP_LENGTH}-digit code
              </label>
              <input
                id="otp-code"
                ref={codeRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={OTP_LENGTH}
                aria-describedby="otp-feedback"
                aria-invalid={error ? 'true' : undefined}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH));
                  if (error) setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && code.length === OTP_LENGTH) {
                    e.preventDefault();
                    verify();
                  }
                }}
                className={cn(
                  PROFILE_CONTROL,
                  'w-[150px] tracking-[.34em] text-center font-[500]',
                  error && 'border-danger'
                )}
              />
            </div>
            <button
              type="button"
              onClick={verify}
              disabled={code.length !== OTP_LENGTH || phase === 'verifying'}
              className={cn(QUIET_BTN, 'border-0 bg-accent text-white hover:bg-accent-hover')}
            >
              {phase === 'verifying' ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => send({ resend: true })}
              disabled={resendIn > 0 || phase === 'verifying'}
              className={cn(QUIET_BTN, 'border border-line bg-paper text-ink-muted hover:bg-tint2 hover:text-ink')}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
          </div>

          <div id="otp-feedback" className="mt-[8px] min-h-[16px]" aria-live="polite">
            {error ? (
              <span className="inline-flex items-center gap-[5px] text-[12px] font-[400] text-danger" role="alert">
                <AlertCircle size={12} strokeWidth={2.2} aria-hidden="true" />
                {error}
              </span>
            ) : (
              notice && <span className="text-[12px] font-[400] text-ink-faint">{notice}</span>
            )}
          </div>

          <p className="m-0 mt-[6px] text-[12px] font-[400] text-ink-faint">{OTP_PROTOTYPE_NOTE}</p>
        </div>
      )}

      {error && phase !== 'code' && phase !== 'verifying' && (
        <p className="m-0 mt-[6px] text-[12px] font-[400] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
