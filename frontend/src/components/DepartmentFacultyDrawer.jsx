import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DrawerShell } from '@/components/ui/Drawer';
import { WorkflowTimeline } from './WorkflowTimeline';
import { CLASS_BY_ID } from '../lib/departmentData';
import { DEPT_REQUESTS, DEPT_REQUEST_KINDS } from '../lib/departmentApprovalsData';
import { DAYS, HOURS, LIVE_VERSION, WORKLOAD_STATES, periodsFor } from '../lib/departmentTimetableData';
import { FACULTY_LIFECYCLE_STATES, reassignmentPreflight } from '../lib/facultyLifecycle';
import { useInstitutionalLifecycle } from '@/features/institution';
import { cn } from '../lib/utils';

/**
 * One faculty member, from the department's side.
 *
 * Scope is deliberately narrow: **what this person teaches, and how much of
 * it.** There is no payroll, no leave administration and no HR record here —
 * none of that is what an HOD opens this for, and a drawer that offered them
 * would be describing a system this prototype does not have.
 *
 * The workload figures are counted from the live timetable at render time, not
 * carried on the record, so this drawer and the department grid cannot disagree
 * about how many periods someone holds.
 */

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'workload', label: 'Workload' },
  { key: 'classes', label: 'Classes' },
  { key: 'timeline', label: 'Timeline' },
];

function Row({ label, value, hint }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-x-[12px] items-baseline py-[7px] border-t border-line-light first:border-t-0">
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

function ProfileTab({ row, preflight }) {
  const { faculty, state } = row;
  const lifecycle = FACULTY_LIFECYCLE_STATES[faculty.lifecycle];

  return (
    <div>
      <dl className="m-0">
        <Row label="Employee ID" value={faculty.employeeId} />
        <Row label="Designation" value={faculty.designation} />
        <Row label="Email" value={faculty.email} />
        <Row label="Phone" value={faculty.phone} />
        {/*
          Attachment to the department, stated separately from availability. An
          invited faculty member and one on duty leave are both "not teaching
          this week" and need entirely different follow-up.
        */}
        <Row
          label="Attachment"
          value={<Pill tone={lifecycle?.tone}>{lifecycle?.label ?? '—'}</Pill>}
          hint={faculty.lifecycleNote || lifecycle?.hint}
        />
        <Row
          label="Availability"
          value={<Pill tone={WORKLOAD_STATES[state].tone}>{WORKLOAD_STATES[state].label}</Pill>}
          hint={
            faculty.availability === 'unavailable'
              ? faculty.unavailableNote
              : 'Available for allocation and substitution'
          }
        />
      </dl>

      {/*
        The preflight, not a veto. An HOD may well need to deactivate somebody
        who has left mid-term; the right answer is to say which class this would
        leave uncovered, not to refuse — and to say it here rather than let it be
        discovered a week later by a class with nobody to correct its register.
      */}
      {preflight?.message && (
        <div className="mt-[12px] flex items-start gap-[7px] px-[11px] py-[8px] border border-line rounded-[12px] bg-pending-soft">
          <AlertTriangle size={13} strokeWidth={1.9} className="mt-[1px] flex-none text-pending" aria-hidden="true" />
          <p className="m-0 text-[12px] text-pending">{preflight.message}</p>
        </div>
      )}

      <p className="m-0 mt-[10px] text-[11.5px] text-ink-faint">
        Leave, payroll and employment records are not handled here — only teaching allocation.
      </p>
    </div>
  );
}

/**
 * Workload as the week actually looks.
 *
 * The number alone hides the thing that matters — twenty periods spread evenly
 * is a heavy week, twenty periods stacked on two days is an unworkable one — so
 * the per-day counts sit beside the total. Both are counted from the same live
 * grid the Timetable page renders.
 */
function WorkloadTab({ row }) {
  const { faculty, periods, state, classIds } = row;
  const cells = periodsFor(faculty.id);
  const perDay = DAYS.map((day) => ({ day, count: cells.filter((c) => c.day === day).length }));
  const busiest = Math.max(1, ...perDay.map((d) => d.count));

  return (
    <div>
      <dl className="m-0 mb-[12px]">
        <Row
          label="Weekly periods"
          value={<span className="tabular-nums">{periods}</span>}
          hint={`Counted from ${LIVE_VERSION.label.toLowerCase()}, the live timetable`}
        />
        <Row label="Classes taught" value={classIds.length} />
        <Row label="Workload" value={<Pill tone={WORKLOAD_STATES[state].tone}>{WORKLOAD_STATES[state].label}</Pill>} />
      </dl>

      {periods === 0 ? (
        <p className="m-0 text-[13px] text-ink-muted">
          No periods are allocated to this faculty member in the live timetable.
          <span className="block mt-[3px] text-[12px] text-ink-faint">
            Available capacity for reallocation or substitution.
          </span>
        </p>
      ) : (
        <>
          <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted mb-[7px]">
            Periods by day
          </div>
          <div className="flex items-end gap-[10px]">
            {perDay.map((d) => (
              <div key={d.day} className="flex-1 min-w-0">
                <div className="relative h-[42px] bg-tint2 rounded-[6px] overflow-hidden">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute left-0 right-0 bottom-0 rounded-[6px]',
                      state === 'high' ? 'bg-pending/50' : 'bg-accent/60',
                    )}
                    style={{ height: `${Math.round((d.count / busiest) * 100)}%` }}
                  />
                </div>
                <div className="mt-[5px] text-[11.5px] text-ink-muted truncate">{d.day}</div>
                <div className="text-[12px] font-[500] text-ink tabular-nums">{d.count}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {faculty.availability === 'unavailable' && (
        <p className="m-0 mt-[12px] text-[11.5px] text-pending">
          {faculty.unavailableNote} — these periods still need cover.
        </p>
      )}
    </div>
  );
}

function ClassesTab({ row }) {
  const { faculty, classIds } = row;
  const cells = periodsFor(faculty.id);

  if (classIds.length === 0) {
    return (
      <p className="m-0 text-[13px] text-ink-muted">
        This faculty member is not assigned to any class in the live timetable.
      </p>
    );
  }

  return (
    <ul className="m-0 p-0 list-none">
      {classIds.map((classId) => {
        const cls = CLASS_BY_ID[classId];
        const own = cells.filter((c) => c.classId === classId);
        const subjects = [...new Set(own.map((c) => c.subject))];
        return (
          <li
            key={classId}
            className="grid grid-cols-[1fr_auto] gap-x-[12px] items-baseline py-[8px] border-t border-line-light first:border-t-0"
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink truncate">{cls?.code ?? classId}</span>
              <span className="block mt-[1px] text-[11.5px] text-ink-faint truncate">{subjects.join(' · ')}</span>
            </span>
            <span className="flex-none text-[12px] text-ink-muted tabular-nums">
              {own.length} period{own.length === 1 ? '' : 's'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Allocation decisions involving this person — raised by them or about them.
 * Not an activity log: what belongs here is what the department decided.
 */
function TimelineTab({ row }) {
  const { faculty } = row;
  const requests = DEPT_REQUESTS.filter(
    (r) =>
      r.requester.name === faculty.name || r.changes.some((c) => `${c.label} ${c.from} ${c.to}`.includes(faculty.name)),
  );

  if (requests.length === 0) {
    return (
      <p className="m-0 text-[13px] text-ink-muted">
        No allocation decisions involve this faculty member.
        <span className="block mt-[3px] text-[12px] text-ink-faint">
          Substitute, allocation and revision requests would be listed here.
        </span>
      </p>
    );
  }

  return (
    <ol className="m-0 p-0 list-none">
      {requests.map((r) => (
        <li key={r.id} className="py-[9px] border-t border-line-light first:border-t-0">
          <div className="text-[13px] text-ink">
            {DEPT_REQUEST_KINDS[r.kind].label}
            <span className="text-ink-faint"> · {r.subject}</span>
          </div>
          <div className="mt-[2px] mb-[6px] text-[11.5px] text-ink-faint">
            {r.requester.name} · {r.requester.position}
          </div>
          <WorkflowTimeline steps={r.timeline} />
        </li>
      ))}
    </ol>
  );
}

export function DepartmentFacultyDrawer({ row, onClose }) {
  const [tab, setTab] = useState('profile');
  const { seats } = useInstitutionalLifecycle();

  /*
   * Run against the **composed** seats, not the baseline: a seat reassigned a
   * minute ago in the seat drawer is the state this warning has to reflect.
   */
  const preflight = row
    ? reassignmentPreflight(row.faculty.id, seats, { classLabel: (id) => CLASS_BY_ID[id]?.code ?? id })
    : null;

  return (
    <DrawerShell
      open={!!row}
      onOpenChange={(o) => !o && onClose()}
      title={row?.faculty.name ?? ''}
      contextLine={row ? `${row.faculty.employeeId} · ${row.faculty.designation} · ${row.periods} periods a week` : ''}
      description="Faculty record"
    >
      {row && (
        <>
          <div
            role="tablist"
            aria-label="Faculty details"
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
            {tab === 'profile' && <ProfileTab row={row} preflight={preflight} />}
            {tab === 'workload' && <WorkloadTab row={row} />}
            {tab === 'classes' && <ClassesTab row={row} />}
            {tab === 'timeline' && <TimelineTab row={row} />}
          </div>
        </>
      )}
    </DrawerShell>
  );
}
