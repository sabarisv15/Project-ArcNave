import { DrawerShell } from '@/components/ui/Drawer';
import { ATTENDANCE_THRESHOLD, classLabel, departmentLabel, hodOf } from '../lib/institutionData';
import { cn } from '../lib/utils';

/**
 * One student, from the institution's side.
 *
 * The thinnest of the three student drawers on purpose. The Class Tutor's has
 * four tabs because that seat decides this student's attendance, fees and flags;
 * the HOD's has the same four because it reviews those decisions. A Principal
 * does neither — by the time a single student's record matters at this altitude,
 * the question is only ever "who owns this, and have they acted", and the answer
 * is a class tutor inside a department, named here so the question can be
 * directed rather than escalated.
 *
 * Read-only, and it says so. Anything else would let a Principal take an action
 * the record would then attribute to the wrong seat.
 */

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

export function InstitutionStudentDrawer({ student, onClose }) {
  const head = student ? hodOf(student.departmentId) : null;
  const atRisk = student ? student.attendance < ATTENDANCE_THRESHOLD : false;

  return (
    <DrawerShell
      open={!!student}
      onOpenChange={(o) => !o && onClose()}
      title={student?.name ?? ''}
      contextLine={student ? `Roll ${student.roll} · ${classLabel(student.classId)}` : ''}
      description="Student record"
    >
      {student && (
        <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] py-[14px]">
          <dl className="m-0">
            <Row label="Register number" value={<span className="tabular-nums">{student.reg}</span>} />
            <Row label="Class" value={classLabel(student.classId)} />
            <Row label="Department" value={departmentLabel(student.departmentId)} />
            <Row
              label="Head of department"
              value={head ? head.name : <span className="text-danger font-[500]">Not recorded</span>}
              hint={head ? undefined : 'This department has no recorded approver'}
            />
            <Row
              label="Attendance"
              value={
                <span className={cn('tabular-nums', atRisk && 'text-danger font-[500]')}>{student.attendance}%</span>
              }
              hint={
                atRisk
                  ? `Below the ${ATTENDANCE_THRESHOLD}% eligibility threshold`
                  : `At or above the ${ATTENDANCE_THRESHOLD}% eligibility threshold`
              }
            />
          </dl>

          <p className="m-0 mt-[12px] text-[11.5px] text-ink-faint">
            Attendance corrections, fees and flags are decided by this student's class tutor and reviewed by the head of
            department · this seat sees the record, not the decision.
          </p>
        </div>
      )}
    </DrawerShell>
  );
}
