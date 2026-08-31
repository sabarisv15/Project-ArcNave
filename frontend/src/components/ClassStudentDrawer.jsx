import { useState } from 'react';
import { DrawerShell } from './AttendanceActionDrawer';
import { ATTENDANCE_THRESHOLD, classLabel } from '../lib/classTutorData';
import { DocumentsPendingBadge, StudentOriginBadge } from './StudentOriginBadge';
import { cn } from '../lib/utils';

/**
 * One student, from the Class Tutor's side.
 *
 * Tabs rather than one long scroll: a tutor opens this for one of four
 * distinct reasons — check standing, read the flag history, settle fee status,
 * or see what has happened to this record — and stacking all four costs a
 * scroll on every visit for the sake of the one time someone wants them all.
 *
 * Where a field has no recorded value it says so. Nothing here derives a
 * status, a trend or a recommendation from data that was never entered.
 */

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'flags', label: 'Flags' },
  { key: 'finance', label: 'Finance' },
  { key: 'timeline', label: 'Timeline' },
];

const FEE_STATES = {
  paid: { label: 'Paid', tone: 'text-success bg-success-soft' },
  pending: { label: 'Correction pending', tone: 'text-pending bg-pending-soft' },
  unpaid: { label: 'Not paid', tone: 'text-danger bg-danger-soft' },
};

function Row({ label, value, hint }) {
  return (
    <div className="grid grid-cols-[128px_1fr] gap-x-[12px] items-baseline py-[7px] border-t border-line-light first:border-t-0">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="m-0 text-[13px] text-ink">
        {value}
        {hint && <span className="block mt-[1px] text-[11.5px] text-ink-faint">{hint}</span>}
      </dd>
    </div>
  );
}

function Pill({ children, tone }) {
  return (
    <span className={cn('inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]', tone)}>
      {children}
    </span>
  );
}

function ProfileTab({ s }) {
  const atRisk = s.attendance < ATTENDANCE_THRESHOLD;
  return (
    <dl className="m-0">
      <Row label="Register number" value={s.reg} />
      <Row label="Roll number" value={s.roll} />
      <Row label="Class" value={classLabel()} />
      {/*
        How they arrived, and whether anything is outstanding — two separate
        facts. A promoted student was placed here by a confirmed promotion
        review, which is why this drawer offers no onboarding action for
        anybody: there is nothing to onboard for a student already enrolled.
      */}
      <Row
        label="Joined this class"
        value={<StudentOriginBadge origin={s.origin} className="text-[12.5px] text-ink" />}
        hint={s.origin === 'promoted' ? 'Placed by a confirmed promotion review — no onboarding is needed' : undefined}
      />
      {s.documentsPending && (
        <Row
          label="Documents"
          value={<DocumentsPendingBadge />}
          hint="Enrolment is active; documents are a follow-up, not a hold"
        />
      )}
      <Row
        label="Attendance"
        value={<span className={cn('tabular-nums', atRisk && 'text-danger font-[500]')}>{s.attendance}%</span>}
        hint={
          atRisk
            ? `Below the ${ATTENDANCE_THRESHOLD}% eligibility threshold`
            : `Meets the ${ATTENDANCE_THRESHOLD}% threshold`
        }
      />
      <Row
        label="Academic"
        value={
          s.hasPending
            ? 'Results pending'
            : s.backlogCount === 0
              ? `CGPA ${s.cgpa}`
              : `${s.backlogCount} backlog${s.backlogCount > 1 ? 's' : ''}`
        }
      />
      <Row label="Student phone" value={s.phone} />
      <Row label="Guardian phone" value={s.guardianPhone} />
    </dl>
  );
}

function FlagsTab({ s }) {
  if (!s.flag) {
    return (
      <p className="m-0 text-[13px] text-ink-muted">
        No flag has been raised for this student.
        <span className="block mt-[3px] text-[12px] text-ink-faint">
          Flags are raised by the Class Tutor and stay on the record once cleared.
        </span>
      </p>
    );
  }

  const cleared = s.flag.status === 'cleared';
  return (
    <div>
      <div className="flex items-center gap-[8px]">
        <span className="text-[13px] font-[500] text-ink">{s.flag.kind}</span>
        <Pill tone={cleared ? 'text-ink-muted bg-tint2' : 'text-pending bg-pending-soft'}>
          {cleared ? 'Cleared' : 'Active'}
        </Pill>
      </div>
      <p className="m-0 mt-[6px] text-[13px] text-ink">{s.flag.note}</p>
      {/*
        Who raised it, in what position, and when. A flag is a judgement about a
        person; a record of one that cannot say who made it is not a record.
      */}
      <p className="m-0 mt-[6px] text-[11.5px] text-ink-faint">Raised by You · Class Tutor · {s.flag.raisedAt}</p>
    </div>
  );
}

function FinanceTab({ s }) {
  const state = FEE_STATES[s.feeTier];
  return (
    <dl className="m-0">
      <Row
        label="Fee status"
        value={<Pill tone={state.tone}>{state.label}</Pill>}
        // A "paid" with no receipt behind it is a different, weaker claim than
        // one with a receipt, and the difference is exactly what a first-status
        // marking exists to record.
        hint={
          s.feeTier === 'paid'
            ? s.feeReceipt
              ? 'Receipt on record'
              : 'No receipt attached — status is unverified'
            : s.feeTier === 'pending'
              ? 'A correction is awaiting your decision'
              : 'No payment recorded'
        }
      />
      <Row label="Marked by" value={s.feeTier === 'unpaid' ? '—' : 'You · Class Tutor'} />
      <Row label="Scholarship" value="Not assessed" hint="Recorded from Finance & scholarships." />
      <p className="m-0 mt-[10px] text-[11.5px] text-ink-faint">
        Amounts, fee schedules and payments are not handled here — only whether the fee is settled.
      </p>
    </dl>
  );
}

function TimelineTab({ s }) {
  const entries = [
    { at: 'Today, 11:20', what: 'Marked present · Operating Systems', by: 'Meera Krishnan · Subject Faculty' },
    { at: 'Today, 09:15', what: 'Marked present · Database Systems', by: 'You · Class Tutor' },
    s.flag && { at: s.flag.raisedAt, what: `Flag raised · ${s.flag.kind}`, by: 'You · Class Tutor' },
    { at: '02 Jul 2026', what: 'Enrolled in III B.Sc CS — A', by: 'Office Desk · Admissions' },
  ].filter(Boolean);

  return (
    <ol className="m-0 p-0 list-none">
      {entries.map((e) => (
        <li key={`${e.at}-${e.what}`} className="py-[8px] border-t border-line-light first:border-t-0">
          <div className="text-[13px] text-ink">{e.what}</div>
          <div className="mt-[2px] text-[11.5px] text-ink-faint">
            {e.at} · {e.by}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ClassStudentDrawer({ student, onClose }) {
  const [tab, setTab] = useState('profile');

  return (
    <DrawerShell
      open={!!student}
      onOpenChange={(o) => !o && onClose()}
      title={student?.name ?? ''}
      contextLine={student ? `${student.reg} · Roll ${student.roll} · ${classLabel()}` : ''}
      description="Student record"
    >
      {student && (
        <>
          <div
            role="tablist"
            aria-label="Student details"
            className="flex-none flex items-center gap-[4px] px-[18px] pt-[10px] pb-[8px] border-b border-line"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex-none h-[27px] px-[10px] border-0 rounded-[8px] bg-transparent font-sans text-[12.5px] cursor-pointer transition-colors duration-200',
                  tab === t.key
                    ? 'bg-accent-soft text-accent font-[600]'
                    : 'text-ink-muted font-[500] hover:text-ink hover:bg-tint2',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] py-[14px]">
            {tab === 'profile' && <ProfileTab s={student} />}
            {tab === 'flags' && <FlagsTab s={student} />}
            {tab === 'finance' && <FinanceTab s={student} />}
            {tab === 'timeline' && <TimelineTab s={student} />}
          </div>
        </>
      )}
    </DrawerShell>
  );
}
