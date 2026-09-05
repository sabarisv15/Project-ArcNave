import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DrawerShell } from '@/components/ui/Drawer';
import { WorkflowTimeline } from './WorkflowTimeline';
import { ATTENDANCE_THRESHOLD, studentsOfClass } from '../lib/departmentData';
import { ATTENTION_STATES, facultyName } from '../lib/departmentSignals';
import { DEPT_REQUESTS, DEPT_REQUEST_KINDS } from '../lib/departmentApprovalsData';
import {
  CONFLICT_LABELS,
  DAYS,
  HOURS,
  HOUR_SLOTS,
  cellsOfClass,
  conflictsOfClass,
} from '../lib/departmentTimetableData';
import { EmptyRoster } from './InstitutionalState';
import { SeatStateBadge } from './SeatStateBadge';
import { FACULTY_BY_ID } from '../lib/departmentData';
import { TIMETABLE_STATE_LABELS } from '../lib/timetableState';
import { cn } from '../lib/utils';

/**
 * One class, from the department's side.
 *
 * **Informational, not operational.** An HOD opens this to understand why a
 * class is on the attention list — who runs it, how its cohort is doing, what is
 * stuck in its timetable, what has been escalated out of it. It is deliberately
 * not the Class Tutor workspace at department scope: there is no attendance
 * marking, no register, no per-student action, because none of those belongs to
 * this seat. Where the answer is "the tutor owns this", the drawer says so
 * rather than offering a control that would be wrong to use.
 *
 * Tabs rather than one long scroll, for the same reason `ClassStudentDrawer`
 * uses them: the five questions are distinct, and stacking them costs a scroll
 * on every visit for the sake of the one time someone wants them all.
 */

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'seat', label: 'Class tutor' },
  { key: 'students', label: 'Students' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'timetable', label: 'Timetable' },
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

function OverviewTab({ cls }) {
  const conflicts = conflictsOfClass(cls.id);
  const state = ATTENTION_STATES[cls.attention];

  return (
    <>
      <dl className="m-0">
        <Row label="Programme" value={cls.programme} />
        <Row label="Semester" value={`Semester ${cls.semester}`} />
        <Row
          label="Class tutor"
          value={cls.tutor ? cls.tutor.name : <span className="text-danger font-[500]">Not recorded</span>}
          hint={
            cls.tutor
              ? cls.tutor.designation
              : 'Attendance and class-level approvals have no owner until a tutor is assigned.'
          }
        />
        <Row
          label="Students"
          value={`${cls.enrolled ?? cls.studentCount} of ${cls.capacity}`}
          hint="Enrolled against the section's provisioned capacity"
        />
        <Row
          label="Attendance"
          value={
            <span className={cn('tabular-nums', cls.attendance < ATTENDANCE_THRESHOLD && 'text-danger font-[500]')}>
              {cls.attendance}%
            </span>
          }
          hint={
            cls.attendance < ATTENDANCE_THRESHOLD
              ? `Class average, whole term — below the ${ATTENDANCE_THRESHOLD}% threshold`
              : 'Class average, whole term'
          }
        />
        <Row label="Status" value={<Pill tone={state.tone}>{state.label}</Pill>} />
        <Row
          label="Pending with you"
          value={cls.pendingCount === 0 ? 'Nothing' : `${cls.pendingCount} decision${cls.pendingCount > 1 ? 's' : ''}`}
        />
      </dl>

      {conflicts.length > 0 && (
        <div className="mt-[12px] flex items-start gap-[7px] px-[11px] py-[8px] border border-line rounded-[12px] bg-pending-soft">
          <AlertTriangle size={13} strokeWidth={1.9} className="mt-[1px] flex-none text-pending" aria-hidden="true" />
          <div className="min-w-0">
            {conflicts.map((c) => (
              <p key={c.id} className="m-0 text-[12px] text-pending">
                {CONFLICT_LABELS[c.kind]} · {c.day} Hour {c.hour} — {c.detail}
              </p>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The class's Class Tutor seat, as a reading — the change itself happens
 * elsewhere.
 *
 * This tab answers "who runs this class and how did that come about". The one
 * control on it hands off to the seat drawer rather than editing anything in
 * place, which is the same rule stated from the other side: a class's tutor is
 * never changed through a class-details surface, and a tab that offered a
 * dropdown here would have made it one.
 */
function SeatTab({ cls, onManageSeat }) {
  const seat = cls.seat;
  if (!seat) {
    return <p className="m-0 text-[13px] text-ink-muted">This class has no seat record.</p>;
  }

  const holder = seat.state === 'active' ? (FACULTY_BY_ID[seat.holderId] ?? null) : null;

  return (
    <div>
      <dl className="m-0">
        <Row label="Seat state" value={<SeatStateBadge state={seat.state} />} />
        {seat.state === 'active' && (
          <Row
            label="Held by"
            value={holder?.name ?? '—'}
            hint={holder ? `${holder.designation} · since ${seat.since}` : null}
          />
        )}
        {seat.state === 'invite_pending' && (
          <Row
            label="Invitation out to"
            value={seat.invitedEmail ?? '—'}
            hint="Not coverage — the seat is not held until the invitation is accepted."
          />
        )}
        {seat.state === 'vacant' && (
          <Row
            label="Held by"
            value={<span className="text-danger font-[500]">Nobody</span>}
            hint="Attendance corrections and class-level approvals have no owner."
          />
        )}
        <Row
          label="Timetable"
          value={TIMETABLE_STATE_LABELS[cls.timetableState]}
          hint={
            cls.attendanceLive
              ? 'Attendance is live for this class.'
              : 'Attendance is locked until the timetable is approved — holding this seat does not unlock it.'
          }
        />
      </dl>

      <div className="mt-[12px]">
        <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">Reassignment history</div>
        {seat.history.length === 0 ? (
          <p className="m-0 mt-[5px] text-[13px] text-ink-muted">This seat has not been handed over.</p>
        ) : (
          <ol className="m-0 mt-[6px] p-0 list-none">
            {seat.history.map((h, i) => (
              <li key={`${h.holderId}-${i}`} className="py-[7px] border-t border-line-light first:border-t-0">
                <div className="text-[12.5px] text-ink">{FACULTY_BY_ID[h.holderId]?.name ?? h.holderId}</div>
                <div className="mt-[1px] text-[11.5px] text-ink-faint">
                  {h.from} → {h.to} · {h.reason}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {onManageSeat && (
        <button
          type="button"
          onClick={() => onManageSeat(cls.id)}
          className="mt-[12px] border-0 bg-transparent p-0 font-sans text-[12px] font-[500] text-accent cursor-pointer hover:underline"
        >
          Manage this seat
        </button>
      )}

      <p className="m-0 mt-[10px] text-[11.5px] text-ink-faint">
        A class tutor is assigned, invited or reassigned only through the seat — never through class details.
      </p>
    </div>
  );
}

/**
 * The class's roster, read-only and capped.
 *
 * The full list, filtering and the per-student record live on the department
 * Students page; repeating all of that inside a drawer would be a second
 * Students page that can drift from the first. What this tab answers is "who is
 * struggling in this class", so it leads with them.
 */
function StudentsTab({ cls, onOpenStudents }) {
  const roster = studentsOfClass(cls.id);
  if (roster.length === 0) return <EmptyRoster />;

  const atRisk = roster.filter((s) => s.attendance < ATTENDANCE_THRESHOLD).sort((a, b) => a.attendance - b.attendance);

  return (
    <div>
      <p className="m-0 mb-[8px] text-[12px] text-ink-muted">
        {roster.length} students · {atRisk.length} below the {ATTENDANCE_THRESHOLD}% threshold
      </p>

      {atRisk.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-muted">Every student in this class is above the threshold.</p>
      ) : (
        <ul className="m-0 p-0 list-none">
          {atRisk.slice(0, 8).map((s) => (
            <li
              key={s.id}
              className="grid grid-cols-[1fr_auto] gap-x-[12px] items-baseline py-[7px] border-t border-line-light first:border-t-0"
            >
              <span className="min-w-0 flex items-baseline gap-[8px]">
                <span className="text-[13px] text-ink truncate" title={s.name}>
                  {s.name}
                </span>
                <span className="flex-none text-[11px] text-ink-faint tabular-nums">{s.roll}</span>
              </span>
              <span className="flex-none text-[13px] font-[500] text-danger tabular-nums">{s.attendance}%</span>
            </li>
          ))}
        </ul>
      )}

      {atRisk.length > 8 && (
        <p className="m-0 mt-[8px] text-[11.5px] text-ink-faint">Showing the 8 lowest of {atRisk.length}.</p>
      )}

      <button
        type="button"
        onClick={() => onOpenStudents(cls.id)}
        className="mt-[10px] border-0 bg-transparent p-0 font-sans text-[12px] font-[500] text-accent cursor-pointer hover:underline"
      >
        Open this class in Students
      </button>
    </div>
  );
}

/**
 * Attendance, at the level this seat reads it.
 *
 * A distribution, not a register. An HOD does not mark attendance and cannot
 * correct it here — the band counts say how widely the shortfall is spread,
 * which is the difference between "two students need a warning" and "this class
 * has a problem".
 */
function AttendanceTab({ cls }) {
  const roster = studentsOfClass(cls.id);
  if (roster.length === 0) return <EmptyRoster />;

  const bands = [
    { label: 'Below 60%', tone: 'bg-danger/70', match: (a) => a < 60 },
    { label: '60–74%', tone: 'bg-danger/40', match: (a) => a >= 60 && a < 75 },
    { label: '75–89%', tone: 'bg-accent/50', match: (a) => a >= 75 && a < 90 },
    { label: '90% and above', tone: 'bg-accent/70', match: (a) => a >= 90 },
  ].map((b) => ({ ...b, count: roster.filter((s) => b.match(s.attendance)).length }));

  return (
    <div>
      <dl className="m-0 mb-[12px]">
        <Row
          label="Class average"
          value={
            <span className={cn('tabular-nums', cls.attendance < ATTENDANCE_THRESHOLD && 'text-danger font-[500]')}>
              {cls.attendance}%
            </span>
          }
          hint="Whole term, every enrolled student"
        />
        <Row
          label="Below threshold"
          value={`${roster.filter((s) => s.attendance < ATTENDANCE_THRESHOLD).length} of ${roster.length}`}
        />
      </dl>

      {/*
        Plain proportional bars, no chart library and no axis: at four bands a
        bar and its own number say everything a chart would, in a fraction of a
        drawer's vertical budget.
      */}
      <div className="space-y-[6px]">
        {bands.map((b) => (
          <div key={b.label} className="grid grid-cols-[104px_1fr_34px] gap-x-[10px] items-center">
            <span className="text-[11.5px] text-ink-muted">{b.label}</span>
            <span className="h-[8px] rounded-[4px] bg-tint2 overflow-hidden">
              <span
                aria-hidden="true"
                className={cn('block h-full rounded-[4px]', b.tone)}
                style={{ width: `${Math.round((b.count / roster.length) * 100)}%` }}
              />
            </span>
            <span className="text-[12px] text-ink tabular-nums text-right">{b.count}</span>
          </div>
        ))}
      </div>

      <p className="m-0 mt-[12px] text-[11.5px] text-ink-faint">
        Attendance is marked by subject faculty and corrected by the class tutor. This seat reviews it and decides
        escalations.
      </p>
    </div>
  );
}

const TT_GRID = 'grid grid-cols-[52px_repeat(5,minmax(0,1fr))] gap-x-[5px] items-stretch';

function TimetableTab({ cls }) {
  const cells = cellsOfClass(cls.id);
  const conflicts = conflictsOfClass(cls.id);
  const conflictAt = (day, hour) => conflicts.find((c) => c.day === day && c.hour === hour);
  const cellAt = (day, hour) => cells.find((c) => c.day === day && c.hour === hour);

  return (
    <div>
      <div className={cn(TT_GRID, 'mb-[4px] text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted')}>
        <span />
        {DAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      {HOURS.map((hour) => (
        <div key={hour} className={cn(TT_GRID, 'py-[3px]')}>
          <span className="flex items-center text-[11.5px] text-ink-muted tabular-nums">H{hour}</span>
          {DAYS.map((day) => {
            const cell = cellAt(day, hour);
            const clash = conflictAt(day, hour);
            return (
              <span
                key={day}
                title={cell ? `${cell.subject} · ${facultyName(cell.facultyId)} · ${cell.room}` : 'Free period'}
                className={cn(
                  'min-w-0 rounded-[7px] px-[5px] py-[4px] border',
                  clash ? 'bg-warning-soft border-warning/30' : 'bg-tint border-transparent',
                )}
              >
                {cell ? (
                  <>
                    <span className="block text-[10.5px] text-ink truncate">{cell.subject}</span>
                    <span
                      className={cn(
                        'block text-[10px] truncate',
                        cell.facultyId ? 'text-ink-faint' : 'text-danger font-[500]',
                      )}
                    >
                      {cell.facultyId ? facultyName(cell.facultyId) : 'Unassigned'}
                    </span>
                  </>
                ) : (
                  <span className="block text-[10.5px] text-ink-faint">—</span>
                )}
              </span>
            );
          })}
        </div>
      ))}

      <p className="m-0 mt-[10px] text-[11.5px] text-ink-faint">
        The live timetable, {HOUR_SLOTS[1].split(' – ')[0]}–{HOUR_SLOTS[5].split(' – ')[1]}. Highlighted slots carry a
        conflict.
      </p>
    </div>
  );
}

/**
 * What has happened to this class institutionally — the decisions raised out of
 * it and where each one got to. Not a student activity feed.
 */
function TimelineTab({ cls }) {
  const requests = DEPT_REQUESTS.filter((r) => r.classId === cls.id);

  if (requests.length === 0) {
    return (
      <p className="m-0 text-[13px] text-ink-muted">
        Nothing has been raised out of this class.
        <span className="block mt-[3px] text-[12px] text-ink-faint">
          Escalations, revisions and publication requests would be listed here.
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

export function DepartmentClassDrawer({ cls, onClose, onOpenStudents, onManageSeat }) {
  const [tab, setTab] = useState('overview');

  return (
    <DrawerShell
      open={!!cls}
      onOpenChange={(o) => !o && onClose()}
      title={cls?.code ?? ''}
      contextLine={cls ? `${cls.programme} · Semester ${cls.semester} · ${cls.studentCount} students` : ''}
      description="Class record"
    >
      {cls && (
        <>
          <div
            role="tablist"
            aria-label="Class details"
            className="flex-none flex items-center gap-[4px] px-[18px] pt-[10px] pb-[8px] border-b border-line overflow-x-auto scroll-quiet"
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
            {tab === 'overview' && <OverviewTab cls={cls} />}
            {tab === 'seat' && <SeatTab cls={cls} onManageSeat={onManageSeat} />}
            {tab === 'students' && <StudentsTab cls={cls} onOpenStudents={onOpenStudents} />}
            {tab === 'attendance' && <AttendanceTab cls={cls} />}
            {tab === 'timetable' && <TimetableTab cls={cls} />}
            {tab === 'timeline' && <TimelineTab cls={cls} />}
          </div>
        </>
      )}
    </DrawerShell>
  );
}
