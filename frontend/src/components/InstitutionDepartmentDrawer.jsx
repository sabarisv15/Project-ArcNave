import { useState } from 'react';
import { DrawerShell } from './AttendanceActionDrawer';
import { WorkflowTimeline } from './WorkflowTimeline';
import { DEPT_ATTENTION_STATES } from '../lib/institutionSignals';
import { DEPT_ATTENTION_THRESHOLD, classesOfDepartment } from '../lib/institutionData';
import { INST_REQUEST_KINDS, requestsOfDepartment } from '../lib/institutionApprovalsData';
import { timetableStateOf } from '../lib/institutionTimetableData';
import { cn } from '../lib/utils';

/**
 * One department, from the institution's side.
 *
 * **Not a copy of the HOD dashboard with a different heading.** What a Principal
 * opens a department for is comparison and decision: is it healthy, who leads
 * it, what is it waiting on, and what has this office already decided about it.
 * Running its day — reallocating a period, chasing one student's attendance — is
 * the head of department's job, and this drawer offers none of it.
 *
 * Read-only for the same reason the L3 student drawer is: a decision taken from
 * here would be recorded against the wrong seat. Where a decision is the answer,
 * the drawer points at Approvals rather than inlining an action.
 */

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'classes', label: 'Classes' },
  { key: 'decisions', label: 'Decisions' },
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

function ProfileTab({ d }) {
  const timetable = timetableStateOf(d.id);
  const belowThreshold = d.attendance < DEPT_ATTENTION_THRESHOLD;

  return (
    <dl className="m-0">
      <Row
        label="Head of department"
        value={
          d.hod ? (
            d.hod.name
          ) : (
            // Stated, not blank: the gap is the finding.
            <span className="text-danger font-[500]">Not recorded</span>
          )
        }
        hint={d.hod ? d.hod.designation : 'Escalations from this department reach the Principal directly'}
      />
      <Row label="Status" value={<Pill tone={DEPT_ATTENTION_STATES[d.attention].tone}>{DEPT_ATTENTION_STATES[d.attention].label}</Pill>} />
      <Row
        label="Attendance"
        value={
          <span className={cn('tabular-nums', belowThreshold && 'text-danger font-[500]')}>{d.attendance}%</span>
        }
        hint={`Every student in the department, whole term · ${d.atRiskCount} of ${d.studentCount} below ${DEPT_ATTENTION_THRESHOLD}%`}
      />
      <Row label="Classes" value={<span className="tabular-nums">{d.classCount}</span>} />
      <Row label="Faculty" value={<span className="tabular-nums">{d.facultyCount}</span>} />
      <Row label="Students" value={<span className="tabular-nums">{d.studentCount}</span>} />
      <Row
        label="Live timetable"
        value={timetable?.live.label ?? '—'}
        hint={
          timetable?.pending
            ? `${timetable.live.effectiveFrom} · ${timetable.pending.label} is awaiting approval and does not replace it`
            : timetable?.live.effectiveFrom
        }
      />
      {d.imbalance && (
        <Row
          label="Workload"
          value={<Pill tone={DEPT_ATTENTION_STATES.workload_imbalance.tone}>Imbalance</Pill>}
          hint={`${d.imbalance.overloaded.name} holds ${d.imbalance.overloaded.periods} periods a week while ${d.imbalance.spare.name} holds none`}
        />
      )}
      <p className="m-0 mt-[10px] text-[11.5px] text-ink-faint">
        Class-level and faculty-level decisions belong to the head of department · this seat endorses what they escalate.
      </p>
    </dl>
  );
}

/**
 * The department's classes, with the one figure that matters at this altitude.
 * Not a class-management list — there is no tutor column, no roster and no
 * action, because none of those is a Principal's to touch.
 */
function ClassesTab({ d }) {
  const classes = classesOfDepartment(d.id);

  if (classes.length === 0) {
    return <p className="m-0 text-[13px] text-ink-muted">No classes are running in this department yet.</p>;
  }

  return (
    <ul className="m-0 p-0 list-none">
      {classes.map((c) => (
        <li
          key={c.id}
          className="grid grid-cols-[1fr_auto] gap-x-[12px] items-baseline py-[8px] border-t border-line-light first:border-t-0"
        >
          <span className="min-w-0">
            <span className="block text-[13px] text-ink truncate">{c.code}</span>
            <span className="block mt-[1px] text-[11.5px] text-ink-faint truncate">
              Semester {c.semester} · {c.studentCount} students
            </span>
          </span>
          <span
            className={cn(
              'flex-none text-[12.5px] tabular-nums',
              c.attendance < DEPT_ATTENTION_THRESHOLD ? 'text-danger font-[500]' : 'text-ink-muted'
            )}
          >
            {c.attendance}%
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What this office has been asked about this department, and what it decided.
 * Not an activity log: what belongs here is what reached the Principal.
 */
function DecisionsTab({ d }) {
  const requests = requestsOfDepartment(d.id);

  if (requests.length === 0) {
    return (
      <p className="m-0 text-[13px] text-ink-muted">
        Nothing from this department has reached the Principal.
        <span className="block mt-[3px] text-[12px] text-ink-faint">
          Endorsed revisions, escalations and allocation changes would be listed here.
        </span>
      </p>
    );
  }

  return (
    <ol className="m-0 p-0 list-none">
      {requests.map((r) => (
        <li key={r.id} className="py-[9px] border-t border-line-light first:border-t-0">
          <div className="text-[13px] text-ink">
            {INST_REQUEST_KINDS[r.kind].label}
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

export function InstitutionDepartmentDrawer({ department, onClose }) {
  const [tab, setTab] = useState('profile');

  return (
    <DrawerShell
      open={!!department}
      onOpenChange={(o) => !o && onClose()}
      title={department?.name ?? ''}
      contextLine={
        department
          ? `${department.classCount} classes · ${department.facultyCount} faculty · ${department.studentCount} students`
          : ''
      }
      description="Department record"
    >
      {department && (
        <>
          <div
            role="tablist"
            aria-label="Department details"
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
                    : 'text-ink-muted font-[500] hover:text-ink hover:bg-tint2'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] py-[14px]">
            {tab === 'profile' && <ProfileTab d={department} />}
            {tab === 'classes' && <ClassesTab d={department} />}
            {tab === 'decisions' && <DecisionsTab d={department} />}
          </div>
        </>
      )}
    </DrawerShell>
  );
}
