import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Lock } from 'lucide-react';
import { DrawerRail, DrawerShell, GHOST_BTN, PRIMARY_BTN } from './AttendanceActionDrawer';
import { WorkflowTimeline } from './WorkflowTimeline';
import { ENDORSEMENT_STATES, chainProgress, nextSeatFor } from '../lib/endorsementChain';
import { LIFECYCLE_REJECTION, useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';
import { cn } from '../lib/utils';

/**
 * The final decision on one department's timetable revision.
 *
 * **Final does not mean first.** This seat decides last, and only after the
 * steps its institution configured have happened: a revision that has not been
 * endorsed by its own head of department, one that clashes with itself, and one
 * still sitting with the delegated seat are all refused — with the reason stated
 * rather than the buttons quietly missing. The guard is
 * `endorsementChain.js`'s and the provider applies it too, so the drawer cannot
 * offer a decision the provider would reject.
 *
 * **Approving does not make a revision live.** The department's approved, locked
 * grid is a separate thing this decision does not touch. A revision that has
 * been approved is *ready to lock*; the classes keep running the timetable they
 * were running until that happens. The drawer states this as a row of the diff
 * rather than leaving it implied, because "I approved the new timetable" and
 * "the new timetable is in force" are the two things most easily confused here.
 *
 * **Returning needs a reason.** A revision that comes back without one tells its
 * author it was wrong and not what about it was, which is the same as not
 * returning it.
 */

function Row({ label, value, hint, tone }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-x-[12px] items-baseline py-[7px] border-t border-line-light first:border-t-0">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={cn('m-0 text-[13px]', tone ?? 'text-ink')}>
        {value}
        {hint && <span className="block mt-[1px] text-[11.5px] text-ink-faint">{hint}</span>}
      </dd>
    </div>
  );
}

export function FinalApprovalDrawer({ row, department, onClose }) {
  const { endorsementStateOf, decisionOf, canDecide, blockReasonFor, approveFinal, returnForRevision } =
    useInstitutionalLifecycle();

  const [mode, setMode] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    setMode(null);
    setNote('');
  }, [row?.departmentId]);

  if (!row || !department) {
    return <DrawerShell open={false} onOpenChange={() => onClose()} title="" description="" />;
  }

  const state = endorsementStateOf(row.departmentId);
  const definition = ENDORSEMENT_STATES[state] ?? ENDORSEMENT_STATES.not_submitted;
  const decision = decisionOf(row.departmentId);
  const eligible = canDecide(row.departmentId);
  const blocked = blockReasonFor(row.departmentId);
  const waitingOn = nextSeatFor(state);

  /**
   * The configured chain, with this revision's position on it.
   *
   * Built from the provisioning rather than listed, so an institution without a
   * delegated seat renders a two-step chain here without this component knowing
   * that the seat is optional.
   */
  const steps = chainProgress(state).map((s) => ({
    label: s.title,
    state: s.state,
    at: null,
    by: null,
  }));

  function submit() {
    if (mode === 'return') {
      const result = returnForRevision(row.departmentId, { reason: note });
      if (!result.ok) {
        toast.error(
          result.detail ?? LIFECYCLE_REJECTION[result.reason] ?? 'That revision could not be returned.'
        );
        return;
      }
      toast.success(`Returned for revision · ${department.name}`);
      onClose();
      return;
    }

    const result = approveFinal(row.departmentId, { note });
    if (!result.ok) {
      toast.error(
        result.detail ?? LIFECYCLE_REJECTION[result.reason] ?? 'That revision could not be approved.'
      );
      return;
    }
    toast.success(`Approved — ready to lock · ${department.name}`);
    onClose();
  }

  return (
    <DrawerShell
      open={!!row}
      onOpenChange={(o) => !o && onClose()}
      title={department.name}
      contextLine={`${department.short} · ${row.revision?.label ?? 'No revision submitted'}`}
      description="Timetable final approval"
      width="sm:w-[560px]"
    >
      <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] py-[14px] space-y-[14px]">
        <div>
          <span
            className={cn(
              'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
              definition.tone
            )}
          >
            {definition.label}
          </span>
          <p className="m-0 mt-[6px] text-[12.5px] text-ink-muted">{definition.hint}</p>
        </div>

        {/*
          Live and proposed, side by side and never merged. The whole rule this
          screen exists to hold is that the first of these does not change
          because the second exists.
        */}
        <dl className="m-0">
          <Row
            label="Live timetable"
            value={row.live.label}
            hint={`${row.live.effectiveFrom} · unchanged by this decision`}
          />
          <Row
            label="Revision"
            value={row.revision?.label ?? 'Nothing submitted'}
            hint={row.revision?.submittedBy ?? 'This department has not submitted a revision.'}
          />
          <Row
            label="Unresolved conflicts"
            value={row.conflictCount === 0 ? 'None' : row.conflictCount}
            tone={row.conflictCount > 0 ? 'text-danger font-[500]' : undefined}
            hint={
              row.conflictCount > 0
                ? 'A grid that clashes with itself cannot be approved.'
                : 'Recomputed from the grid, not read off a stored count.'
            }
          />
          <Row
            label="Waiting on"
            value={waitingOn ?? 'Nobody — this revision is settled'}
          />
        </dl>

        <div>
          <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
            Approval chain
          </div>
          <div className="mt-[7px]">
            <WorkflowTimeline steps={steps} />
          </div>
        </div>

        {decision ? (
          <div>
            <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
              Decision
            </div>
            <dl className="m-0 mt-[4px]">
              <Row
                label="Outcome"
                value={decision.outcome === 'approved' ? 'Approved — ready to lock' : 'Returned for revision'}
                hint={
                  decision.outcome === 'approved'
                    ? 'The live timetable stays in force until the revision is locked against its classes.'
                    : 'Sent back to its author with the reason below.'
                }
              />
              {decision.note && <Row label="Note" value={decision.note} />}
            </dl>
          </div>
        ) : !eligible ? (
          <div className="flex items-start gap-[7px] px-[11px] py-[8px] border border-line rounded-[12px] bg-tint">
            <Lock size={13} strokeWidth={1.9} className="mt-[1px] flex-none text-ink-faint" aria-hidden="true" />
            <p className="m-0 text-[12px] text-ink-muted">{blocked}</p>
          </div>
        ) : mode ? (
          <div>
            <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
              {mode === 'return' ? 'Reason for returning' : 'Note'}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              aria-label={mode === 'return' ? 'Reason for returning' : 'Approval note'}
              placeholder={
                mode === 'return'
                  ? 'What has to change before this can be approved'
                  : 'Optional — kept on the decision record'
              }
              className="mt-[6px] w-full resize-none font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
            />
            {mode === 'approve' && (
              <div className="mt-[7px] flex items-start gap-[7px] px-[11px] py-[8px] border border-line rounded-[12px] bg-pending-soft">
                <AlertTriangle
                  size={13}
                  strokeWidth={1.9}
                  className="mt-[1px] flex-none text-pending"
                  aria-hidden="true"
                />
                <p className="m-0 text-[12px] text-pending">
                  Approving makes this revision ready to lock. {row.live.label} stays live until it is.
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {decision || !eligible ? (
        <DrawerRail
          meta={
            <span className="text-[11.5px] text-ink-faint">
              {decision
                ? 'This decision has been recorded and cannot be taken again.'
                : 'This revision is not at a step this office decides.'}
            </span>
          }
        />
      ) : mode ? (
        <DrawerRail
          meta={
            <span className="text-[11.5px] text-ink-faint">
              The live timetable is unaffected either way.
            </span>
          }
        >
          <button type="button" className={GHOST_BTN} onClick={() => setMode(null)}>
            Cancel
          </button>
          <button type="button" className={PRIMARY_BTN} onClick={submit}>
            {mode === 'return' ? 'Return with reason' : 'Approve finally'}
          </button>
        </DrawerRail>
      ) : (
        <DrawerRail
          meta={
            <span className="text-[11.5px] text-ink-faint">
              Final approval — after every configured step before it.
            </span>
          }
        >
          <button type="button" className={GHOST_BTN} onClick={() => setMode('return')}>
            Return
          </button>
          <button type="button" className={PRIMARY_BTN} onClick={() => setMode('approve')}>
            Approve
          </button>
        </DrawerRail>
      )}
    </DrawerShell>
  );
}
