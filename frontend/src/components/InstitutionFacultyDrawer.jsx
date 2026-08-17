import { DrawerShell } from './AttendanceActionDrawer';
import { WORKLOAD_STATES } from '../lib/departmentTimetableData';
import { departmentLabel, hodOf } from '../lib/institutionData';
import { cn } from '../lib/utils';

/**
 * One faculty member, from the institution's side.
 *
 * Deliberately **thinner than the L3 faculty drawer**, and not a fork of it. That
 * drawer has four tabs because an HOD reallocates real periods: it renders the
 * week's grid, the per-day distribution and the department's own allocation
 * decisions. A Principal does none of that — what this seat needs to know is who
 * this person is, which department carries them, what band their load falls in,
 * and who their head of department is, because that is who the question goes to.
 *
 * So there are no tabs. A drawer with one tab is a drawer with a redundant
 * control, and inventing the other three would mean inventing per-period data
 * this seat does not model.
 *
 * Read-only: moving a person between departments is an approval with a diff and
 * a timeline, and it lives in Approvals.
 */

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

export function InstitutionFacultyDrawer({ row, onClose }) {
  const faculty = row?.faculty;
  const head = faculty ? hodOf(faculty.departmentId) : null;

  return (
    <DrawerShell
      open={!!row}
      onOpenChange={(o) => !o && onClose()}
      title={faculty?.name ?? ''}
      contextLine={faculty ? `${faculty.employeeId} · ${departmentLabel(faculty.departmentId)}` : ''}
      description="Faculty record"
    >
      {row && (
        <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] py-[14px]">
          <dl className="m-0">
            <Row label="Employee ID" value={faculty.employeeId} />
            <Row label="Designation" value={faculty.designation} />
            <Row label="Department" value={departmentLabel(faculty.departmentId)} />
            <Row
              label="Head of department"
              value={head ? head.name : <span className="text-danger font-[500]">Not recorded</span>}
              hint={head ? undefined : 'This department has no recorded approver'}
            />
            <Row label="Email" value={faculty.email} />
            <Row
              label="Weekly periods"
              value={<span className="tabular-nums">{faculty.periods}</span>}
              hint="Counted from the department's live timetable"
            />
            <Row
              label="Workload"
              value={
                <span
                  className={cn(
                    'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                    WORKLOAD_STATES[row.state].tone
                  )}
                >
                  {WORKLOAD_STATES[row.state].label}
                </span>
              }
              hint={
                faculty.availability === 'unavailable'
                  ? faculty.unavailableNote
                  : row.state === 'unassigned'
                    ? 'Available capacity — reallocation between departments is a Principal decision'
                    : undefined
              }
            />
          </dl>

          <p className="m-0 mt-[12px] text-[11.5px] text-ink-faint">
            Allocation within a department belongs to its head · only moves between departments reach this seat, through
            Approvals.
          </p>
        </div>
      )}
    </DrawerShell>
  );
}
