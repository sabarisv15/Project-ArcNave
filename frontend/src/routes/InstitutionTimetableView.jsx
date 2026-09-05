import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { DEPARTMENT_BY_ID } from '../lib/institutionData';
import {
  DEPTS_WITH_PENDING,
  EXCEPTION_LABELS,
  INSTITUTION_EXCEPTIONS,
  TIMETABLE_STATES,
  TOTAL_CONFLICTS,
  exceptionDepartments,
} from '../lib/institutionTimetableData';
import { ENDORSEMENT_STATES, endorsementChainLabel } from '../lib/endorsementChain';
import { InstitutionScopeHeader } from '../components/InstitutionScopeHeader';
import { FinalApprovalDrawer } from '../components/FinalApprovalDrawer';
import { NoDepartments, NoExceptions } from '../components/InstitutionalState';
import { PANE, STICKY_HEAD, TABLE_HEAD, StickyTableShell } from '../components/WorkspaceLayout';
import { useInstitutionalLifecycle } from '@/features/institution';
import { cn } from '../lib/utils';

/**
 * Institution → Timetable.
 *
 * **Not a grid.** L3 renders one department's week cell by cell because an HOD
 * moves individual periods; a Principal never does. What this page shows is the
 * *state* of academic operations across all six departments — what each one is
 * running, what it is waiting on, and what is unresolved — plus the exceptions
 * that belong to no single department and so can only be settled here.
 *
 * The rule the page is built around: **a pending revision never replaces the
 * live timetable.** Live and Revision are separate columns for exactly that
 * reason. A department with a revision in review is still running the grid it
 * was running, and approving that revision moves it toward being locked rather
 * than making it live on the spot.
 *
 * **The chain column is the other half of the page.** A revision's state says
 * where it is and therefore who owes it a decision — and this seat's decision is
 * the *final* one, available only once the steps this institution configured
 * have happened. Every state is shown, including the ones this office cannot
 * act on, because "nothing is waiting on me here" is an answer a governance
 * screen has to be able to give.
 */

const VIEWS = [
  { key: 'departments', label: 'By department' },
  { key: 'exceptions', label: 'Exceptions' },
];

/*
 * Tight tier: Department · Live · Waiting · Chevron collapses to Department ·
 * Status. Effective-from and conflict counts demote, and each demoted cell
 * carries its own `hidden md:block` wrapper, because a hidden child still
 * occupies a grid track and would push the sticky header out of alignment with
 * its rows.
 */
const GRID =
  'grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_38px] md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,150px)_66px_38px] gap-x-[12px] items-center px-[16px]';

function DepartmentStates({ onOpen }) {
  const { endorsementStateOf } = useInstitutionalLifecycle();

  return (
    <StickyTableShell minWidth={340}>
      <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
        <span>Department</span>
        <span>Live timetable</span>
        <span className="hidden md:block">Revision</span>
        <span className="hidden md:block">Chain state</span>
        <span className="hidden md:block">Conflicts</span>
        <span className="sr-only">Open</span>
      </div>

      {TIMETABLE_STATES.map((s) => {
        const dept = DEPARTMENT_BY_ID[s.departmentId];
        const state = endorsementStateOf(s.departmentId);
        const definition = ENDORSEMENT_STATES[state] ?? ENDORSEMENT_STATES.not_submitted;
        return (
          <button
            key={s.departmentId}
            type="button"
            onClick={() => onOpen(s)}
            aria-label={`${dept?.name ?? s.departmentId} — open timetable decision`}
            className={cn(
              GRID,
              'w-full h-[50px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
            )}
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink truncate" title={dept?.name}>
                {dept?.name ?? '—'}
              </span>
              <span className="block text-[11px] text-ink-faint truncate">{dept?.short}</span>
            </span>

            <span className="min-w-0">
              <span className="block text-[12.5px] text-ink-muted truncate" title={s.live.label}>
                {s.live.label}
              </span>
              <span className="block text-[11px] text-ink-faint truncate">{s.live.effectiveFrom}</span>
            </span>

            {/*
              Stated as a revision, never as a version the department is
              following. This column is the whole reason the page has two: a
              revision in flight has changed nothing yet.
            */}
            <span className="hidden md:block min-w-0">
              {s.revision ? (
                <>
                  <span className="block text-[12.5px] text-ink-muted truncate" title={s.revision.label}>
                    {s.revision.label}
                  </span>
                  <span className="block text-[11px] text-ink-faint truncate">Live timetable unchanged</span>
                </>
              ) : (
                <span className="text-[12.5px] text-ink-faint">Nothing submitted</span>
              )}
            </span>

            {/*
              Where it is on the chain — which is also who owes it a decision.
              Rendered for every department, including the ones this office
              cannot act on, because that is the answer for most of them.
            */}
            <span className="hidden md:block min-w-0">
              <span
                className={cn(
                  'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500] max-w-full truncate',
                  definition.tone,
                )}
                title={definition.hint}
              >
                {definition.label}
              </span>
            </span>

            <span className="hidden md:block text-[12.5px] tabular-nums">
              {s.conflictCount === 0 ? (
                <span className="text-ink-faint">—</span>
              ) : (
                <span className="text-pending font-[500]">{s.conflictCount}</span>
              )}
            </span>

            <span className="flex justify-end text-ink-faint">
              <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
            </span>
          </button>
        );
      })}

      {TIMETABLE_STATES.length === 0 && <NoDepartments />}
    </StickyTableShell>
  );
}

/**
 * The exceptions that belong to no department.
 *
 * Each names the departments it touches, because "which departments does this
 * hold up" is the first thing this seat needs and a count would not answer it.
 */
function Exceptions() {
  if (INSTITUTION_EXCEPTIONS.length === 0) {
    return (
      <StickyTableShell>
        <NoExceptions />
      </StickyTableShell>
    );
  }

  return (
    <StickyTableShell minWidth={340}>
      <ul className="m-0 p-0 list-none">
        {INSTITUTION_EXCEPTIONS.map((e) => {
          const depts = exceptionDepartments(e);
          return (
            <li key={e.id} className="px-[16px] py-[12px] border-t border-line-light first:border-t-0">
              <div className="flex items-start gap-[10px]">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-ink">
                    <span className="text-pending font-[500]">{EXCEPTION_LABELS[e.kind]}</span>
                    <span className="text-ink-faint"> · {e.title}</span>
                  </span>
                  <span className="block mt-[3px] text-[12px] text-ink-muted">{e.detail}</span>
                  <span className="block mt-[5px] text-[11.5px] text-ink-faint truncate">
                    {depts.length === TIMETABLE_STATES.length
                      ? 'All departments'
                      : depts.map((d) => d.name).join(' · ')}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </StickyTableShell>
  );
}

export function InstitutionTimetableView() {
  const [view, setView] = useState('departments');
  const [openId, setOpenId] = useState('');

  const openRow = openId ? (TIMETABLE_STATES.find((s) => s.departmentId === openId) ?? null) : null;

  return (
    <div className={PANE}>
      <InstitutionScopeHeader />

      <div className="flex-none flex items-center gap-[8px] flex-wrap mb-[12px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Timetable</h1>
        <span className="text-[11.5px] text-ink-faint tabular-nums" aria-live="polite">
          {DEPTS_WITH_PENDING.length} in review · {TOTAL_CONFLICTS} unresolved
        </span>

        <div role="tablist" aria-label="Timetable views" className="flex items-center gap-[4px] ml-[4px]">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={cn(
                'flex-none h-[27px] px-[10px] border-0 rounded-[8px] bg-transparent font-sans text-[12.5px] cursor-pointer transition-colors duration-200',
                view === v.key
                  ? 'bg-accent-soft text-accent font-[600]'
                  : 'text-ink-muted font-[500] hover:text-ink hover:bg-tint2',
              )}
            >
              {v.label}
              {v.key === 'exceptions' && INSTITUTION_EXCEPTIONS.length > 0 && (
                <span className="ml-[5px] text-[11px] tabular-nums text-ink-faint">
                  {INSTITUTION_EXCEPTIONS.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {view === 'departments' ? <DepartmentStates onOpen={(s) => setOpenId(s.departmentId)} /> : <Exceptions />}

      <p className="flex-none m-0 mt-[8px] text-[11.5px] text-ink-faint">
        A revision in review never replaces a department's live timetable · approving one makes it ready to lock ·{' '}
        {endorsementChainLabel()}.
      </p>

      <FinalApprovalDrawer
        row={openRow}
        department={openRow ? DEPARTMENT_BY_ID[openRow.departmentId] : null}
        onClose={() => setOpenId('')}
      />
    </div>
  );
}
