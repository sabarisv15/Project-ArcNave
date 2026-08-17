import { useEffect, useState } from 'react';
import { DrawerShell, DrawerRail, GHOST_BTN, PRIMARY_BTN } from './AttendanceActionDrawer';
import { WorkflowTimeline } from './WorkflowTimeline';
import { AuditHistory } from './AuditHistory';
import { REQUEST_KINDS, STATUS_LABELS, STATUS_TONE } from '../lib/approvalsData';
import { cn } from '../lib/utils';

/**
 * Deciding one request.
 *
 * The rule this drawer is built around: **an approval screen that cannot show
 * the original value beside the proposed one is not an approval screen.** So
 * the diff is the first thing in the body, before the reason and well before
 * the actions — a decision taken without seeing what changes is a rubber stamp.
 *
 * A request that has already been decided opens in exactly the same drawer with
 * the same diff and timeline, and the action rail is replaced by the recorded
 * outcome. There is no separate "history" view to learn.
 *
 * `kinds` defaults to the Class Tutor map so existing callers are untouched;
 * `deciderPosition` names the seat the decision is being taken in, because "your
 * decision is recorded against this seat" is only true if the seat is the right
 * one.
 *
 * **`outcomeLabels` exists because not every seat approves.** A delegated
 * position reviews a revision and routes it onward — it does not, and must not,
 * *approve* anything, and a shared drawer that hard-coded the word Approve into
 * its primary button and its audit line would have that seat claiming an
 * authority the product reserves for the institution head. The outcome keys
 * stay the same; only the words a seat uses for them change.
 */

const DEFAULT_OUTCOME_LABELS = { approved: 'Approve', rejected: 'Reject' };
const DEFAULT_RECORDED_LABELS = { approved: 'Approved', rejected: 'Rejected' };

const FIELD =
  'w-full font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]';

function Label({ children }) {
  return <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">{children}</div>;
}

/**
 * Original → proposed, side by side.
 *
 * The arrow direction is fixed and the two sides are never swapped: whatever is
 * on the record today is always on the left. Colour is not used to say which
 * one is "right" — that is the decision being asked for, and the UI does not
 * get to pre-empt it.
 */
function Diff({ changes }) {
  return (
    <div className="border border-line rounded-[12px] overflow-hidden">
      <div className="grid grid-cols-[1fr_1fr] gap-x-[12px] px-[12px] py-[7px] bg-tint border-b border-line">
        <span className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">On record</span>
        <span className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">Proposed</span>
      </div>
      {changes.map((c) => (
        <div key={c.label} className="px-[12px] py-[8px] border-t border-line-light first:border-t-0">
          <div className="text-[11.5px] text-ink-faint">{c.label}</div>
          <div className="mt-[2px] grid grid-cols-[1fr_1fr] gap-x-[12px] items-baseline">
            <span className="text-[13px] text-ink-muted line-through decoration-ink-faint/60">{c.from}</span>
            <span className="text-[13px] text-ink font-[500]">{c.to}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DecisionDrawer({
  request,
  onClose,
  onDecide,
  kinds = REQUEST_KINDS,
  outcomeLabels = DEFAULT_OUTCOME_LABELS,
  recordedLabels = DEFAULT_RECORDED_LABELS,
}) {
  const [note, setNote] = useState('');

  // A note typed against one request must never follow the user to the next.
  useEffect(() => {
    setNote('');
  }, [request?.id]);

  const decided = request && request.status !== 'pending';

  return (
    <DrawerShell
      open={!!request}
      onOpenChange={(o) => !o && onClose()}
      title={request ? kinds[request.kind].label : ''}
      contextLine={request ? `${request.scope} · ${request.subject}` : ''}
      description="Approval request"
      width="sm:w-[560px]"
    >
      {request && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] py-[14px] space-y-[14px]">
            <div className="flex items-center gap-[8px]">
              <span
                className={cn(
                  'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                  STATUS_TONE[request.status]
                )}
              >
                {STATUS_LABELS[request.status]}
              </span>
              <span className="text-[11.5px] text-ink-faint">
                Requested by {request.requester.name} · {request.requester.position}
              </span>
            </div>

            <div>
              <Label>What changes</Label>
              <div className="mt-[6px]">
                <Diff changes={request.changes} />
              </div>
            </div>

            <div>
              <Label>Reason given</Label>
              <p className="m-0 mt-[5px] text-[13px] text-ink">{request.reason}</p>
            </div>

            <div>
              <Label>Progress</Label>
              <div className="mt-[7px]">
                <WorkflowTimeline steps={request.timeline} />
              </div>
            </div>

            {request.decision && (
              <div>
                <Label>Decision</Label>
                <div className="mt-[5px]">
                  <AuditHistory
                    entries={[
                      {
                        action: recordedLabels[request.decision.outcome] ?? request.decision.outcome,
                        by: request.decision.by,
                        position: request.decision.position,
                        at: request.decision.at,
                        note: request.decision.note,
                      },
                    ]}
                  />
                </div>
              </div>
            )}

            {!decided && (
              <div>
                <Label>Note</Label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Why you are approving or rejecting (kept on the record)"
                  className={cn(FIELD, 'mt-[6px] resize-none')}
                />
              </div>
            )}
          </div>

          {decided ? (
            <DrawerRail
              meta={
                <span className="text-[11.5px] text-ink-faint">
                  This request has been decided and can no longer be changed.
                </span>
              }
            />
          ) : (
            <DrawerRail meta={<span className="text-[11.5px] text-ink-faint">Your decision is recorded against this seat.</span>}>
              <button type="button" className={GHOST_BTN} onClick={() => onDecide(request.id, 'rejected', note)}>
                {outcomeLabels.rejected}
              </button>
              <button type="button" className={PRIMARY_BTN} onClick={() => onDecide(request.id, 'approved', note)}>
                {outcomeLabels.approved}
              </button>
            </DrawerRail>
          )}
        </>
      )}
    </DrawerShell>
  );
}
