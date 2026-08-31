import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { DrawerRail, DrawerShell, GHOST_BTN, PRIMARY_BTN } from './AttendanceActionDrawer';
import { SeatStateBadge } from './SeatStateBadge';
import { DEPARTMENT, DEPT_FACULTY, FACULTY_BY_ID, facultyInitials } from '../lib/departmentData';
import { FACULTY_LIFECYCLE_STATES, assignabilityReason, isAssignable } from '../lib/facultyLifecycle';
import { seatTitle } from '../lib/seatTitles';
import { CLASS_TUTOR_L4 } from '../lib/roles';
import { useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';
import { cn } from '../lib/utils';

/**
 * The Class Tutor seat for one class.
 *
 * **The only place a Class Tutor changes.** Not the class-edit surface, not a
 * staff profile, not a generic role picker. A seat is an institutional position
 * with a scope and a history, and changing who holds it is a decision with
 * consequences for a whole class's attendance and approvals — putting it behind
 * the same control that renames a section would make it look like an attribute.
 * Everything else about a class is edited elsewhere; this is edited only here.
 *
 * **The seat is what has the history, not the person.** A handover records which
 * seat was held and when. The same human may hold a different seat next term,
 * and their profile is not where "who ran second-year B in August" lives.
 *
 * Local/prototype only. It is interaction behaviour so the designed experience
 * can be reviewed honestly — nothing here authorizes anything, and in the
 * product the change is made server-side against the resolved Position Account.
 */

const MODES = {
  assign: { verb: 'Assign', title: 'Assign a class tutor' },
  reassign: { verb: 'Reassign', title: 'Reassign this seat' },
  invite: { verb: 'Send invite', title: 'Invite someone to this seat' },
};

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

/**
 * Who can be put in the seat, and who cannot but is shown anyway.
 *
 * An unavailable or not-yet-accepted faculty member stays visible with the
 * reason attached rather than silently disappearing from the list. "Where is
 * Deepa" is a question an HOD will ask, and an empty answer is the worst one.
 */
function candidates(currentHolderId, seats) {
  return DEPT_FACULTY.filter((f) => f.id !== currentHolderId).map((f) => {
    const holds = seats.filter((s) => s.state === 'active' && s.holderId === f.id);
    return {
      faculty: f,
      assignable: isAssignable(f),
      reason: assignabilityReason(f),
      holds,
    };
  });
}

export function DepartmentSeatDrawer({ cls, onClose }) {
  const { seatOf, seats, assignTutor, inviteTutor } = useInstitutionalLifecycle();
  const seat = cls ? seatOf(cls.id) : null;

  const [mode, setMode] = useState(null);
  const [pickedId, setPickedId] = useState('');
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');

  // A drawer opened on a different class starts from that class's own state,
  // never from the half-finished action left on the last one.
  useEffect(() => {
    setMode(null);
    setPickedId('');
    setReason('');
    setEmail('');
  }, [cls?.id]);

  const options = useMemo(() => candidates(seat?.holderId ?? null, seats), [seat?.holderId, seats]);
  const holder = seat?.state === 'active' ? (FACULTY_BY_ID[seat.holderId] ?? null) : null;
  const picked = pickedId ? (FACULTY_BY_ID[pickedId] ?? null) : null;

  const title = seatTitle(CLASS_TUTOR_L4);

  function submit() {
    if (!cls) return;

    if (mode === 'invite') {
      const address = email.trim();
      if (!address) {
        toast.error('An email address is needed to send an invitation.');
        return;
      }
      const result = inviteTutor(cls.id, address, { scopeDepartmentId: DEPARTMENT.id });
      if (!result.ok) {
        toast.error('That seat is not in this department.');
        return;
      }
      toast.success(`Invitation sent · ${cls.code}`);
      onClose();
      return;
    }

    if (!picked) {
      toast.error(`Choose who takes the ${title.toLowerCase()} seat.`);
      return;
    }

    const result = assignTutor(cls.id, picked.id, { reason, scopeDepartmentId: DEPARTMENT.id });
    if (!result.ok) {
      toast.error('That seat is not in this department.');
      return;
    }
    toast.success(mode === 'reassign' ? `Seat reassigned · ${cls.code}` : `${title} assigned · ${cls.code}`);
    onClose();
  }

  return (
    <DrawerShell
      open={!!cls}
      onOpenChange={(o) => !o && onClose()}
      title={cls ? `${title} — ${cls.code}` : ''}
      contextLine={cls ? `${DEPARTMENT.short} Department · Semester ${cls.semester} · Section ${cls.section}` : ''}
      description="Class tutor seat"
      width="sm:w-[520px]"
    >
      {cls && seat && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] py-[14px] space-y-[14px]">
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
                    hint="The seat is not held until the invitation is accepted."
                  />
                )}
                {seat.state === 'vacant' && (
                  <Row
                    label="Held by"
                    value={<span className="text-danger font-[500]">Nobody</span>}
                    hint="Attendance corrections and class-level approvals have no owner."
                  />
                )}
                <Row label="Class" value={cls.code} hint={cls.programme} />
                <Row
                  label="Enrolled"
                  value={`${cls.enrolled ?? cls.studentCount} of ${cls.capacity}`}
                  hint="Provisioned section capacity"
                />
              </dl>
            </div>

            {/*
              History belongs to the seat. It is stated even when empty, because
              "nobody has handed this over" is itself an answer.
            */}
            <div>
              <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                Reassignment history
              </div>
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

            {mode && mode !== 'invite' && (
              <div>
                <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                  {MODES[mode].title}
                </div>
                <ul className="m-0 mt-[6px] p-0 list-none max-h-[280px] overflow-y-auto scroll-quiet">
                  {options.map(({ faculty, assignable, reason: why, holds }) => (
                    <li key={faculty.id}>
                      <button
                        type="button"
                        disabled={!assignable}
                        onClick={() => setPickedId(faculty.id)}
                        aria-pressed={pickedId === faculty.id}
                        className={cn(
                          'w-full grid grid-cols-[26px_1fr_auto] gap-x-[9px] items-center px-[8px] py-[7px] border rounded-[10px] bg-paper text-left transition-colors duration-200',
                          pickedId === faculty.id ? 'border-accent-line bg-accent-soft' : 'border-transparent',
                          assignable ? 'cursor-pointer hover:bg-tint2' : 'cursor-not-allowed opacity-70',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="w-[26px] h-[26px] grid place-items-center rounded-full bg-warm-soft text-warm text-[10.5px] font-[500]"
                        >
                          {facultyInitials(faculty.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] text-ink truncate">{faculty.name}</span>
                          <span className="block text-[11.5px] text-ink-faint truncate">
                            {why ?? faculty.designation}
                          </span>
                          {holds.length > 0 && (
                            <span className="block text-[11px] text-pending truncate">
                              Already holds {holds.length} other seat{holds.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </span>
                        <span className="flex-none text-[11px] text-ink-faint">
                          {FACULTY_LIFECYCLE_STATES[faculty.lifecycle]?.label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                {mode === 'reassign' && (
                  <div className="mt-[10px]">
                    <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">Reason</div>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      aria-label="Reason for reassignment"
                      placeholder="Why the seat is moving (kept on the seat's history)"
                      className="mt-[6px] w-full resize-none font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
                    />
                  </div>
                )}
              </div>
            )}

            {mode === 'invite' && (
              <div>
                <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                  {MODES.invite.title}
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-label="Invitation email address"
                  placeholder="name@arcnave.edu.in"
                  className="mt-[6px] w-full font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
                />
                <div className="mt-[7px] flex items-start gap-[7px] px-[11px] py-[8px] border border-line rounded-[12px] bg-pending-soft">
                  <AlertTriangle
                    size={13}
                    strokeWidth={1.9}
                    className="mt-[1px] flex-none text-pending"
                    aria-hidden="true"
                  />
                  <p className="m-0 text-[12px] text-pending">
                    The seat stays uncovered until the invitation is accepted. It does not count towards this
                    department's tutor coverage in the meantime.
                  </p>
                </div>
              </div>
            )}
          </div>

          {mode ? (
            <DrawerRail
              meta={
                <span className="text-[11.5px] text-ink-faint">
                  Recorded against this class's seat, not against a staff profile.
                </span>
              }
            >
              <button type="button" className={GHOST_BTN} onClick={() => setMode(null)}>
                Cancel
              </button>
              <button type="button" className={PRIMARY_BTN} onClick={submit}>
                {MODES[mode].verb}
              </button>
            </DrawerRail>
          ) : (
            <DrawerRail
              meta={
                <span className="text-[11.5px] text-ink-faint">
                  A class tutor is changed only here — never through class details.
                </span>
              }
            >
              <button type="button" className={GHOST_BTN} onClick={() => setMode('invite')}>
                Invite
              </button>
              <button
                type="button"
                className={PRIMARY_BTN}
                onClick={() => setMode(seat.state === 'active' ? 'reassign' : 'assign')}
              >
                {seat.state === 'active' ? 'Reassign' : 'Assign'}
              </button>
            </DrawerRail>
          )}
        </>
      )}
    </DrawerShell>
  );
}
