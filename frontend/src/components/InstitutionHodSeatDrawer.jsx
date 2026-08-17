import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { DrawerRail, DrawerShell, GHOST_BTN, PRIMARY_BTN } from './AttendanceActionDrawer';
import { SeatStateBadge } from './SeatStateBadge';
import { FACULTY_BY_ID, facultyInitials, facultyOfDepartment } from '../lib/institutionData';
import { seatTitle } from '../lib/seatTitles';
import { HOD_L3 } from '../lib/roles';
import { LIFECYCLE_REJECTION, useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';
import { cn } from '../lib/utils';

/**
 * The department leadership seat for one department.
 *
 * **The only place a head of department changes, and the only seat this office
 * changes at all.** It is deliberately a sibling of `DepartmentSeatDrawer`
 * rather than a widened version of it: the two look alike because they are the
 * same kind of act, and they are separate because they are different
 * authorities. An institution head fills and moves department leadership; a head
 * of department fills and moves Class Tutor seats. Neither drawer offers the
 * other's decision, and no ordinary department-editing surface offers either —
 * a seat is an institutional position with a scope and a history, and putting it
 * behind the control that renames a department would make it look like an
 * attribute.
 *
 * **The seat is what has the history, not the person.** A handover records which
 * seat was held and when. The same person may lead a different department next
 * year, and their faculty record is not where "who ran Civil in August" lives.
 *
 * **An invitation is not coverage, and the drawer says so where it matters.**
 * The department has no approver while an invitation is outstanding, which is
 * not a detail — it is why escalations from that department arrive at this
 * office directly.
 *
 * Local/prototype only. Nothing here authorizes anything; in the product the
 * change is made server-side against the resolved Position Account.
 */

const MODES = {
  assign: { verb: 'Assign', title: 'Assign a head of department' },
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

export function InstitutionHodSeatDrawer({ department, onClose }) {
  const { hodSeatOf, assignHod, inviteHod, vacateHod } = useInstitutionalLifecycle();
  const seat = department ? hodSeatOf(department.id) : null;

  const [mode, setMode] = useState(null);
  const [pickedId, setPickedId] = useState('');
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');

  // A drawer opened on a different department starts from that department's own
  // state, never from the half-finished action left on the last one.
  useEffect(() => {
    setMode(null);
    setPickedId('');
    setReason('');
    setEmail('');
  }, [department?.id]);

  /**
   * Who can lead this department.
   *
   * Its own faculty, and only its own. Moving a person between departments is a
   * separate decision with its own approval — it reaches this office through
   * Approvals as a cross-department allocation — and offering the whole
   * institution's faculty here would let one drawer do quietly what that
   * decision exists to do openly.
   */
  const options = useMemo(
    () =>
      department
        ? facultyOfDepartment(department.id).filter((f) => f.id !== seat?.holderId)
        : [],
    [department, seat?.holderId]
  );

  const holder = seat?.state === 'active' ? FACULTY_BY_ID[seat.holderId] ?? null : null;
  const picked = pickedId ? FACULTY_BY_ID[pickedId] ?? null : null;
  const title = seatTitle(HOD_L3);

  function submit() {
    if (!department) return;

    if (mode === 'invite') {
      const result = inviteHod(department.id, email);
      if (!result.ok) {
        toast.error(
          result.reason === 'reason_required'
            ? 'An email address is needed to send an invitation.'
            : LIFECYCLE_REJECTION[result.reason] ?? 'That invitation could not be sent.'
        );
        return;
      }
      toast.success(`Invitation sent · ${department.name}`);
      onClose();
      return;
    }

    if (mode === 'vacate') {
      const result = vacateHod(department.id, { reason });
      if (!result.ok) {
        toast.error(LIFECYCLE_REJECTION[result.reason] ?? 'That seat could not be vacated.');
        return;
      }
      toast.success(`Seat vacated · ${department.name}`);
      onClose();
      return;
    }

    if (!picked) {
      toast.error(`Choose who takes the ${title.toLowerCase()} seat.`);
      return;
    }

    const result = assignHod(department.id, picked.id, { reason });
    if (!result.ok) {
      toast.error(LIFECYCLE_REJECTION[result.reason] ?? 'That seat could not be changed.');
      return;
    }
    toast.success(
      mode === 'reassign' ? `Seat reassigned · ${department.name}` : `${title} assigned · ${department.name}`
    );
    onClose();
  }

  return (
    <DrawerShell
      open={!!department}
      onOpenChange={(o) => !o && onClose()}
      title={department ? `${title} — ${department.name}` : ''}
      contextLine={department ? `${department.short} · ${department.classCount} classes · ${department.facultyCount} faculty` : ''}
      description="Department leadership seat"
      width="sm:w-[520px]"
    >
      {department && seat && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] py-[14px] space-y-[14px]">
            <dl className="m-0">
              <Row label="Seat state" value={<SeatStateBadge state={seat.state} />} />
              {seat.state === 'active' && (
                <Row
                  label="Held by"
                  value={holder?.name ?? '—'}
                  hint={holder ? `${holder.designation} · since ${seat.since ?? '—'}` : null}
                />
              )}
              {seat.state === 'invite_pending' && (
                <Row
                  label="Invitation out to"
                  value={seat.invitedEmail ?? '—'}
                  hint="The seat is not held until the invitation is accepted, and the department has no approver in the meantime."
                />
              )}
              {seat.state === 'vacant' && (
                <Row
                  label="Held by"
                  value={<span className="text-danger font-[500]">Nobody</span>}
                  hint="Escalations from this department reach this office directly."
                />
              )}
              <Row
                label="Department readiness"
                value={`${department.attendance}% attendance · ${department.pendingCount} pending`}
                hint={`${department.studentCount} students · ${department.classCount} classes`}
              />
            </dl>

            {/*
              History belongs to the seat. Stated even when empty, because
              "nobody has handed this over" is itself an answer.
            */}
            <div>
              <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                Reassignment history
              </div>
              {(seat.history ?? []).length === 0 ? (
                <p className="m-0 mt-[5px] text-[13px] text-ink-muted">
                  This seat has not been handed over.
                </p>
              ) : (
                <ol className="m-0 mt-[6px] p-0 list-none">
                  {seat.history.map((h, i) => (
                    <li
                      key={`${h.holderId}-${i}`}
                      className="py-[7px] border-t border-line-light first:border-t-0"
                    >
                      <div className="text-[12.5px] text-ink">
                        {FACULTY_BY_ID[h.holderId]?.name ?? h.holderId}
                      </div>
                      <div className="mt-[1px] text-[11.5px] text-ink-faint">
                        {h.from} → {h.to} · {h.reason}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {mode && mode !== 'invite' && mode !== 'vacate' && (
              <div>
                <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                  {MODES[mode].title}
                </div>
                <ul className="m-0 mt-[6px] p-0 list-none max-h-[280px] overflow-y-auto scroll-quiet">
                  {options.map((faculty) => (
                    <li key={faculty.id}>
                      <button
                        type="button"
                        onClick={() => setPickedId(faculty.id)}
                        aria-pressed={pickedId === faculty.id}
                        className={cn(
                          'w-full grid grid-cols-[26px_1fr] gap-x-[9px] items-center px-[8px] py-[7px] border rounded-[10px] bg-paper text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
                          pickedId === faculty.id ? 'border-accent-line bg-accent-soft' : 'border-transparent'
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
                            {faculty.designation}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="m-0 mt-[6px] text-[11.5px] text-ink-faint">
                  This department's own faculty. Moving somebody between departments is decided in
                  Approvals.
                </p>
              </div>
            )}

            {(mode === 'reassign' || mode === 'vacate') && (
              <div>
                <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                  Reason
                </div>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  aria-label="Reason"
                  placeholder="Why the seat is moving (kept on the seat's history)"
                  className="mt-[6px] w-full resize-none font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
                />
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
                    The department stays without an approver until the invitation is accepted, and does
                    not count towards leadership coverage in the meantime.
                  </p>
                </div>
              </div>
            )}

            <p className="m-0 text-[11.5px] text-ink-faint">
              Class Tutor seats are assigned by this department's own head, not from this office.
            </p>
          </div>

          {mode ? (
            <DrawerRail
              meta={
                <span className="text-[11.5px] text-ink-faint">
                  Recorded against this department's seat, not against a staff profile.
                </span>
              }
            >
              <button type="button" className={GHOST_BTN} onClick={() => setMode(null)}>
                Cancel
              </button>
              <button type="button" className={PRIMARY_BTN} onClick={submit}>
                {MODES[mode]?.verb ?? 'Vacate'}
              </button>
            </DrawerRail>
          ) : (
            <DrawerRail
              meta={
                <span className="text-[11.5px] text-ink-faint">
                  A head of department is changed only here.
                </span>
              }
            >
              {seat.state === 'active' && (
                <button type="button" className={GHOST_BTN} onClick={() => setMode('vacate')}>
                  Vacate
                </button>
              )}
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
