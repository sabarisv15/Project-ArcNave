import { Check, CheckCheck, CircleDot, Clock, Lock, LockKeyholeOpen, Repeat, UserRound } from 'lucide-react';
import { cn } from '../lib/utils';
import { PHASE_LABELS } from '../lib/attendanceData';

// Labels live in `attendanceData.js` (PHASE_LABELS) so history search and
// filtering match exactly what the badge renders; only icon/tone are visual.
const PHASE_META = {
  not_approved: { Icon: Lock, tone: 'text-ink-faint bg-tint2' },
  upcoming: { Icon: Clock, tone: 'text-ink-muted bg-tint2' },
  open: { Icon: CircleDot, tone: 'text-accent bg-accent-soft' },
  marking_missed: { Icon: LockKeyholeOpen, tone: 'text-danger bg-danger-soft' },
  locked_before_window: { Icon: Clock, tone: 'text-ink-soft bg-tint2' },
  locked_ready: { Icon: Lock, tone: 'text-accent bg-accent-soft' },
  submitted: { Icon: CheckCheck, tone: 'text-success bg-success-soft' },
  submission_expired: { Icon: LockKeyholeOpen, tone: 'text-danger bg-danger-soft' },
};

/** Icon + text state indicator — never colour alone (accessibility rule §9). */
export function PhaseBadge({ phase, className }) {
  const meta = PHASE_META[phase];
  if (!meta) return null;
  const { Icon, tone } = meta;
  const label = PHASE_LABELS[phase];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] h-[24px] px-[9px] rounded-[8px] text-[11.5px] font-[500]',
        tone,
        className,
      )}
    >
      <Icon size={12.5} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Short state labels for dense rows, where the full `PHASE_LABELS` sentence
 * ("Timetable not yet approved") would dominate the line. Meaning is carried
 * by the word plus a tone dot — never by colour alone.
 */
const COMPACT_PHASE = {
  not_approved: { label: 'Not approved', tone: 'bg-ink-disabled', text: 'text-ink-faint' },
  upcoming: { label: 'Upcoming', tone: 'bg-ink-disabled', text: 'text-ink-muted' },
  open: { label: 'Open', tone: 'bg-accent', text: 'text-accent' },
  marking_missed: { label: 'Closed', tone: 'bg-danger', text: 'text-danger' },
  locked_before_window: { label: 'Locked', tone: 'bg-ink-ghost', text: 'text-ink-soft' },
  locked_ready: { label: 'Ready to submit', tone: 'bg-accent', text: 'text-accent' },
  submitted: { label: 'Submitted', tone: 'bg-success', text: 'text-success' },
  submission_expired: { label: 'Closed', tone: 'bg-danger', text: 'text-danger' },
};

/**
 * One-line state for a compact schedule row: `Open · 18m`, `Draft · 4m`,
 * `Ready to submit`. `detail` carries the live marking countdown; a draft is
 * an open period that already has saved entries, so it reads as Draft rather
 * than Open.
 */
export function CompactPhase({ phase, detail, isDraft, needsAck }) {
  const meta = COMPACT_PHASE[phase];
  if (!meta) return null;
  if (needsAck) {
    return (
      <span className="inline-flex items-center gap-[6px] text-[12px] font-[500] text-pending">
        <span className="w-[6px] h-[6px] rounded-full bg-pending" aria-hidden="true" />
        Needs acknowledgement
      </span>
    );
  }
  const label = isDraft && phase === 'open' ? 'Draft' : meta.label;
  return (
    <span className={cn('inline-flex items-center gap-[6px] text-[12px]', meta.text)}>
      <span className={cn('flex-none w-[6px] h-[6px] rounded-full', meta.tone)} aria-hidden="true" />
      <span className="font-[600] whitespace-nowrap">{label}</span>
      {detail && (
        <>
          <span className="text-ink-faint" aria-hidden="true">
            ·
          </span>
          <span className="text-ink-muted tabular-nums whitespace-nowrap">{detail}</span>
        </>
      )}
    </span>
  );
}

export function OwnershipBadge({ ownership, className }) {
  if (ownership === 'substitute') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-[5px] h-[24px] px-[9px] rounded-[8px] text-[11.5px] font-[500] text-pending bg-pending-soft',
          className,
        )}
      >
        <Repeat size={12.5} strokeWidth={2} aria-hidden="true" />
        Substitute
      </span>
    );
  }
  if (ownership === 'other') return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] h-[24px] px-[9px] rounded-[8px] text-[11.5px] font-[500] text-ink-muted bg-tint2',
        className,
      )}
    >
      <UserRound size={12.5} strokeWidth={2} aria-hidden="true" />
      My class
    </span>
  );
}

/** The percentage-calculation-impact line — kept literal per §6, never called "finalized". */
export function CalculationImpactLine({ phase, className }) {
  if (phase === 'submitted') {
    return (
      <span className={cn('inline-flex items-center gap-[5px] text-[11.5px] font-[500] text-success', className)}>
        <Check size={12} strokeWidth={2.2} aria-hidden="true" />
        Submitted · Included in attendance percentage
      </span>
    );
  }
  if (phase === 'locked_before_window' || phase === 'locked_ready') {
    return (
      <span className={cn('text-[11.5px] text-ink-faint', className)}>
        Visible to class · Not yet included in attendance percentage
      </span>
    );
  }
  return null;
}
