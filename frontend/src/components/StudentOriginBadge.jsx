import { cn } from '../lib/utils';

/**
 * How a student arrived in this class.
 *
 * It exists because one rule depends on it: **a promoted student is already
 * placed and must never be offered an onboarding action.** They arrived because
 * a Head of Department confirmed a promotion, not because anyone admitted them,
 * and asking a Class Tutor to onboard them again would be asking for a
 * duplicate record for a student who is already enrolled.
 *
 * Promoted is the ordinary case and reads as the ordinary case — a plain,
 * unemphasised word. The three exceptional origins are the ones a tutor might
 * actually want to find, and they are distinguished from each other rather than
 * lumped into "new": a transfer-in and a bulk-imported row need different
 * follow-up.
 */

export const ORIGIN_LABELS = {
  promoted: 'Promoted',
  admitted: 'Admitted',
  imported: 'Imported',
  transferred: 'Transferred',
};

const ORIGIN_TONE = {
  promoted: 'text-ink-faint',
  admitted: 'text-ink-soft',
  imported: 'text-ink-soft',
  transferred: 'text-ink-soft',
};

export function StudentOriginBadge({ origin, className }) {
  const label = ORIGIN_LABELS[origin] ?? ORIGIN_LABELS.promoted;
  return <span className={cn('text-[11.5px]', ORIGIN_TONE[origin] ?? ORIGIN_TONE.promoted, className)}>{label}</span>;
}

/**
 * Documents have not been supplied yet.
 *
 * **Never a hold on enrolment.** An imported student is active in the roster
 * from the moment the import is confirmed; this is a follow-up task, and the
 * warning tone is as far as it goes — nothing about it blocks attendance,
 * assessment or anything else. It is deliberately a separate component from the
 * origin badge, because it is a separate fact: an admitted student who uploaded
 * their documents in the wizard does not carry it, and an imported one who has
 * since supplied them stops carrying it.
 */
export function DocumentsPendingBadge({ className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center h-[19px] px-[6px] rounded-[6px] text-[10.5px] font-[500] text-pending bg-pending-soft',
        className,
      )}
    >
      Documents pending
    </span>
  );
}
