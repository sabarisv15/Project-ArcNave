import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronRight } from 'lucide-react';
import { CLASS_ROSTER, CLASS_TOTAL, OWNED_CLASS, STUDENT_BY_ID } from '../lib/classTutorData';
import { ClassScopeHeader } from '../components/ClassScopeHeader';
import { ScholarshipDecisionPanel } from '../components/ScholarshipDecisionPanel';
import { NoAssignedClass, NoResults } from '../components/InstitutionalState';
import { SearchPopoverField } from '../components/ToolbarIcons';
import { PANE, STICKY_HEAD, TABLE_HEAD, StickyTableShell } from '../components/WorkspaceLayout';
import { cn } from '../lib/utils';

/**
 * Curriculum → Finance & scholarships, for the Class Tutor seat.
 *
 * The seat's finance authority is narrow and this screen is deliberately just
 * as narrow: **whether the fee is settled**, and **who is eligible for a
 * scholarship**. There are no amounts, no fee schedule, no instalments and no
 * payment surface anywhere on it — those belong to accounts, not to a tutor,
 * and putting a number here would imply an authority this seat does not have.
 *
 * "Paid" and "Paid, no receipt" are shown as different states rather than one,
 * because they are: a first status marked without a receipt behind it is the
 * thing a later correction usually exists to fix.
 */

const TABS = [
  { key: 'fees', label: 'Fee status' },
  { key: 'scholarships', label: 'Scholarships' },
];

const FEE_TONE = {
  paid: 'text-success bg-success-soft',
  pending: 'text-pending bg-pending-soft',
  unpaid: 'text-danger bg-danger-soft',
};
const FEE_LABEL = { paid: 'Paid', pending: 'Correction pending', unpaid: 'Not paid' };

const FEE_GRID = 'grid grid-cols-[56px_1.7fr_150px_1fr] gap-x-[12px] items-center px-[16px]';
const SCH_GRID = 'grid grid-cols-[56px_1.7fr_170px_1fr_44px] gap-x-[12px] items-center px-[16px]';

/** Only ever built from what the record holds — never a guess about a student's circumstances. */
function advisoryFor(student) {
  // A deliberate gap: roughly one student in five has no advisory at all, so the
  // "no advisory" path is a state that actually gets seen in review rather than
  // a branch nobody exercises.
  if (Number(student.roll) % 5 === 0) return null;
  return {
    points: [
      `Attendance ${student.attendance}% against the 75% threshold`,
      student.backlogCount === 0
        ? 'No active backlogs on record'
        : `${student.backlogCount} active backlog${student.backlogCount > 1 ? 's' : ''} on record`,
      student.feeTier === 'paid' ? 'Fee settled for the current term' : 'Fee not settled for the current term',
    ],
  };
}

function Summary({ label, value }) {
  return (
    <div className="flex-1 min-w-[132px] bg-paper border border-line rounded-[14px] px-[13px] py-[10px]">
      <div className={TABLE_HEAD}>{label}</div>
      <div className="mt-[4px] text-[17px] font-[600] text-ink tabular-nums">{value}</div>
    </div>
  );
}

export function ClassFinanceView() {
  const [tab, setTab] = useState('fees');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [decisions, setDecisions] = useState({});

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return CLASS_ROSTER;
    return CLASS_ROSTER.filter((s) => [s.name, s.roll, s.reg].join(' ').toLowerCase().includes(term));
  }, [query]);

  const counts = useMemo(
    () => ({
      paid: CLASS_ROSTER.filter((s) => s.feeTier === 'paid').length,
      unpaid: CLASS_ROSTER.filter((s) => s.feeTier === 'unpaid').length,
      pending: CLASS_ROSTER.filter((s) => s.feeTier === 'pending').length,
      noReceipt: CLASS_ROSTER.filter((s) => s.feeTier === 'paid' && !s.feeReceipt).length,
    }),
    []
  );

  function record(studentId, { eligible, reason }) {
    setDecisions((prev) => ({
      ...prev,
      [studentId]: { eligible, reason, by: 'You', position: 'Class Tutor', at: new Date() },
    }));
    setOpenId(null);
    toast.success(eligible ? 'Recorded as eligible' : 'Recorded as not eligible');
  }

  if (!OWNED_CLASS) {
    return (
      <div className={PANE}>
        <ClassScopeHeader cls={null} />
        <StickyTableShell>
          <NoAssignedClass />
        </StickyTableShell>
      </div>
    );
  }

  return (
    <div className={PANE}>
      <ClassScopeHeader />

      <div className="flex-none flex items-center gap-[8px] mb-[12px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Finance &amp; scholarships</h1>
        <div role="tablist" aria-label="Finance views" className="flex items-center gap-[4px] ml-[4px]">
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
                  : 'text-ink-muted font-[500] hover:text-ink hover:bg-tint2'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <SearchPopoverField
          value={query}
          onChange={setQuery}
          placeholder="Search name, roll, register no…"
          ariaLabel="Search students"
        />
      </div>

      {tab === 'fees' && (
        <>
          <div className="flex-none flex flex-wrap gap-[8px] mb-[10px]">
            <Summary label="Paid" value={`${counts.paid} / ${CLASS_TOTAL}`} />
            <Summary label="Not paid" value={counts.unpaid} />
            <Summary label="Correction pending" value={counts.pending} />
            {/* Surfaced as its own figure because it is the one a tutor can act on today. */}
            <Summary label="Paid, no receipt" value={counts.noReceipt} />
          </div>

          <StickyTableShell minWidth={720}>
            <div className={cn(FEE_GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
              <span>Roll</span>
              <span>Student</span>
              <span>Fee status</span>
              <span>Recorded</span>
            </div>

            {rows.map((s) => (
              <div key={s.id} className={cn(FEE_GRID, 'h-[46px] border-t border-line-light')}>
                <span className="text-[12.5px] text-ink-muted tabular-nums">{s.roll}</span>
                <span className="min-w-0 flex items-baseline gap-[8px]">
                  <span className="text-[13px] text-ink truncate">{s.name}</span>
                  <span className="flex-none text-[11px] text-ink-faint tabular-nums">{s.reg}</span>
                </span>
                <span>
                  <span
                    className={cn(
                      'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                      FEE_TONE[s.feeTier]
                    )}
                  >
                    {FEE_LABEL[s.feeTier]}
                  </span>
                </span>
                <span className="text-[12px] text-ink-faint truncate">
                  {s.feeTier === 'unpaid'
                    ? 'Not recorded'
                    : s.feeTier === 'pending'
                      ? 'Awaiting your decision in Approvals'
                      : s.feeReceipt
                        ? 'You · Class Tutor · receipt on record'
                        : 'You · Class Tutor · no receipt attached'}
                </span>
              </div>
            ))}

            {rows.length === 0 && <NoResults what="students" />}
          </StickyTableShell>

          <p className="flex-none m-0 mt-[8px] text-[11.5px] text-ink-faint">
            Amounts, fee schedules and payments are not handled by this seat — only whether the fee is settled.
          </p>
        </>
      )}

      {tab === 'scholarships' && (
        <StickyTableShell minWidth={760}>
          <div className={cn(SCH_GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
            <span>Roll</span>
            <span>Student</span>
            <span>Decision</span>
            <span>Recorded by</span>
            <span className="sr-only">Open</span>
          </div>

          {rows.map((s) => {
            const d = decisions[s.id];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setOpenId(s.id)}
                aria-label={`Scholarship eligibility for ${s.name}`}
                className={cn(
                  SCH_GRID,
                  'w-full h-[46px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2'
                )}
              >
                <span className="text-[12.5px] text-ink-muted tabular-nums">{s.roll}</span>
                <span className="min-w-0 flex items-baseline gap-[8px]">
                  <span className="text-[13px] text-ink truncate">{s.name}</span>
                  <span className="flex-none text-[11px] text-ink-faint tabular-nums">{s.reg}</span>
                </span>
                <span>
                  {d ? (
                    <span
                      className={cn(
                        'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                        d.eligible ? 'text-success bg-success-soft' : 'text-ink-muted bg-tint2'
                      )}
                    >
                      {d.eligible ? 'Eligible' : 'Not eligible'}
                    </span>
                  ) : (
                    <span className="text-[12px] text-ink-faint">Not assessed</span>
                  )}
                </span>
                <span className="text-[12px] text-ink-faint truncate">
                  {d ? `${d.by} · ${d.position}` : '—'}
                </span>
                <span className="flex justify-end text-ink-faint">
                  <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
                </span>
              </button>
            );
          })}

          {rows.length === 0 && <NoResults what="students" />}
        </StickyTableShell>
      )}

      <ScholarshipDecisionPanel
        student={openId ? STUDENT_BY_ID[openId] : null}
        advisory={openId ? advisoryFor(STUDENT_BY_ID[openId]) : null}
        decision={openId ? decisions[openId] : null}
        onClose={() => setOpenId(null)}
        onRecord={record}
      />
    </div>
  );
}
