import { useState } from 'react';
import { DrawerShell } from '@/components/ui/Drawer';
import { ATTENDANCE_THRESHOLD, CLASS_BY_ID, tutorOf } from '../lib/departmentData';
import { StudentOriginBadge } from './StudentOriginBadge';
import { PROMOTION_OUTCOMES } from '../lib/promotionData';
import { useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';
import { cn } from '../lib/utils';

/**
 * One student, from the department's side.
 *
 * The same four-tab shape as the Class Tutor's student drawer, because it
 * answers the same four questions and learning a second layout for the same
 * record would be a cost with no return. What differs is **class context**: at
 * department scope a student is meaningless without the class they belong to, so
 * the class and its tutor are stated on the context line and again in the
 * profile, and the finance and flag tabs name who owns each decision.
 *
 * Read-only, deliberately. Raising a flag, settling a fee and correcting
 * attendance all belong to the class tutor; offering them here would let an HOD
 * take an action the record would then attribute to the wrong seat. Where that
 * is the answer, the drawer says so rather than hiding the section.
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

function ProfileTab({ s, review }) {
  const cls = CLASS_BY_ID[s.classId];
  const tutor = tutorOf(s.classId);
  const atRisk = s.attendance < ATTENDANCE_THRESHOLD;

  return (
    <dl className="m-0">
      {/*
        How this student arrived in the class they are in. It matters because one
        rule depends on it: a promoted student is already placed and must never
        be offered an onboarding action. The id is stated beside it because that
        is the fact a semester transition does *not* change — the same record,
        before and after.
      */}
      <Row
        label="Joined"
        value={<StudentOriginBadge origin={s.origin} className="text-[13px]" />}
        hint={
          review
            ? review.sectionChanged
              ? `${PROMOTION_OUTCOMES[review.outcome].resultLabel} · section ${review.fromSection} → ${review.toSection} · id ${s.id}`
              : `${PROMOTION_OUTCOMES[review.outcome].resultLabel} · id ${s.id}`
            : `Student id ${s.id} · unchanged by any semester transition`
        }
      />
      <Row label="Register number" value={s.reg} />
      <Row label="Roll number" value={s.roll} />
      {/*
        Class context is not optional at department scope. A roll number means
        nothing across six classes, and "roll 04" appears six times in this
        department — the class is what makes the row identify a person.
      */}
      <Row
        label="Class"
        value={cls?.code ?? '—'}
        hint={tutor ? `Class tutor · ${tutor.name}` : 'No class tutor recorded'}
      />
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
        value={s.backlogCount === 0 ? `CGPA ${s.cgpa}` : `${s.backlogCount} backlog${s.backlogCount > 1 ? 's' : ''}`}
      />
    </dl>
  );
}

function FlagsTab({ s }) {
  const tutor = tutorOf(s.classId);

  if (!s.flag) {
    return (
      <p className="m-0 text-[13px] text-ink-muted">
        No flag has been raised for this student.
        <span className="block mt-[3px] text-[12px] text-ink-faint">
          Flags are raised by the class tutor and stay on the record once cleared.
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
      <p className="m-0 mt-[6px] text-[11.5px] text-ink-faint">
        Raised by {tutor ? `${tutor.name} · Class Tutor` : 'the class tutor'} · {s.flag.raisedAt}
      </p>
      <p className="m-0 mt-[10px] text-[11.5px] text-ink-faint">
        Flags are raised and cleared by the class tutor. This seat reviews them.
      </p>
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
        // A "paid" with no receipt behind it is a weaker claim than one with a
        // receipt, and the difference is exactly what a first marking records.
        hint={
          s.feeTier === 'paid'
            ? s.feeReceipt
              ? 'Receipt on record'
              : 'No receipt attached — status is unverified'
            : s.feeTier === 'pending'
              ? 'A correction is awaiting the class tutor’s decision'
              : 'No payment recorded'
        }
      />
      <p className="m-0 mt-[10px] text-[11.5px] text-ink-faint">
        Amounts, schedules and payments are not handled here — only whether the fee is settled, and fee decisions belong
        to the class tutor.
      </p>
    </dl>
  );
}

function TimelineTab({ s }) {
  const cls = CLASS_BY_ID[s.classId];
  const tutor = tutorOf(s.classId);

  const entries = [
    s.attendance < ATTENDANCE_THRESHOLD && {
      at: 'This term',
      what: `Attendance at ${s.attendance}% — below the ${ATTENDANCE_THRESHOLD}% threshold`,
      by: 'Attendance monitor',
    },
    s.flag && {
      at: s.flag.raisedAt,
      what: `Flag raised · ${s.flag.kind}`,
      by: tutor ? `${tutor.name} · Class Tutor` : 'Class tutor',
    },
    { at: '02 Jul 2026', what: `Enrolled in ${cls?.code ?? 'the department'}`, by: 'Office Desk · Admissions' },
  ].filter(Boolean);

  return (
    <>
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

      {/*
        The rule the whole semester transition rests on, stated where somebody
        might otherwise go looking for an edit control: a closed semester's
        attendance, assessments and documents stay on the record and cannot be
        changed — by this seat or any other.
      */}
      <p className="m-0 mt-[10px] text-[11.5px] text-ink-faint">
        Attendance, assessments and documents from previous semesters stay on this student's record as read-only
        history.
      </p>
    </>
  );
}

export function DepartmentStudentDrawer({ student, onClose }) {
  const [tab, setTab] = useState('profile');
  const { reviewOf } = useInstitutionalLifecycle();
  const cls = student ? CLASS_BY_ID[student.classId] : null;
  // Present only for somebody placed by a decision taken in this session; a
  // seeded promoted student has no review record and does not need one.
  const review = student ? reviewOf(student.id) : null;

  return (
    <DrawerShell
      open={!!student}
      onOpenChange={(o) => !o && onClose()}
      title={student?.name ?? ''}
      contextLine={student ? `${student.reg} · Roll ${student.roll} · ${cls?.code ?? '—'}` : ''}
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
            {tab === 'profile' && <ProfileTab s={student} review={review} />}
            {tab === 'flags' && <FlagsTab s={student} />}
            {tab === 'finance' && <FinanceTab s={student} />}
            {tab === 'timeline' && <TimelineTab s={student} />}
          </div>
        </>
      )}
    </DrawerShell>
  );
}
