import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DelegatedScopeHeader } from '../components/DelegatedScopeHeader';
import { ApprovalInbox } from '../components/ApprovalInbox';
import { DecisionDrawer } from '../components/DecisionDrawer';
import { NoResults } from '../components/InstitutionalState';
import { PANE, TableEmptyState } from '../components/WorkspaceLayout';
import {
  DELEGATED_DECIDABLE_STATE,
  DELEGATED_REQUEST_KINDS,
  delegatedScope,
  routedRevisions,
} from '../lib/delegatedScope';
import { ENDORSEMENT_STATES, chainProgress, endorsementChainLabel } from '../lib/endorsementChain';
import { departmentLabel, hodOf } from '../lib/institutionData';
import { timetableStateOf } from '../lib/institutionTimetableData';
import { useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';
import { cn } from '../lib/utils';

/**
 * Routed Approvals — what the delegated seat has been sent, and nothing else.
 *
 * **This is a review queue, not an approval queue.** The distinction is the
 * whole screen: the primary action routes a revision *onward* to the institution
 * head, and the word "Approve" never appears on it, because approving is not
 * something this seat can do. The shared `DecisionDrawer` carries this seat's
 * own outcome labels rather than a variant of the drawer being written.
 *
 * **Scope is structural, not a filter.** The queue is derived from the
 * delegated departments and the live endorsement state, so a department that was
 * not delegated produces no row here — there is nothing to hide, because there
 * was never anything to show. A conflicted or un-endorsed revision is equally
 * absent: it is still with the department that owns it.
 *
 * The chain line sits under the heading for the same reason it sits on the
 * overview: a queue with no chain lets its reader believe the decision ends
 * here.
 */

const VIEWS = [
  { key: 'pending', label: 'Pending' },
  { key: 'decided', label: 'Reviewed' },
];

/**
 * A routed revision, in the shape the shared approval primitives read.
 *
 * **Pending means pending *here*.** A revision is only this seat's work while its
 * state says it is with this seat; one that has already moved on to the
 * institution head is not a decision waiting on anybody in this queue, whatever
 * it says elsewhere. Deriving the status from the state rather than from "no
 * local review yet" is what keeps that true — the fixture already contains a
 * revision that passed this seat before the session started.
 */
function toRequest(r, scope, review) {
  const decided = Boolean(review);
  const waitingHere = r.state === DELEGATED_DECIDABLE_STATE;

  return {
    id: r.departmentId,
    kind: 'timetable_review',
    status: decided ? (review.outcome === 'reviewed' ? 'approved' : 'rejected') : waitingHere ? 'pending' : 'approved',
    subject: r.revision.label,
    requester: {
      name: r.endorsedBy ?? r.submittedBy ?? 'The department',
      position: `Head of Department · ${r.name}`,
    },
    requestedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
    scope: r.name,
    reason:
      'Endorsed by the department and routed to this position for review. Reviewing it sends it to the institution head, who takes the final decision.',
    changes: [
      {
        label: 'Revision status',
        from: ENDORSEMENT_STATES[r.state].label,
        to: 'Reviewed — pending final approval',
      },
      {
        label: 'Live timetable',
        from: r.live?.label ?? 'Current grid',
        to: 'Unchanged until finally approved and locked',
      },
      {
        label: 'Unresolved conflicts on the proposed grid',
        from: String(r.conflictCount),
        to: String(r.conflictCount),
      },
    ],
    timeline: chainProgress(r.state).map((s) => ({
      label: s.title,
      state: s.state,
      at: null,
      by: null,
    })),
    decision: decided
      ? {
          by: scope.seat.holderName,
          position: scope.title,
          at: review.at,
          outcome: review.outcome === 'reviewed' ? 'approved' : 'rejected',
          note: review.note,
        }
      : null,
  };
}

export function DelegatedApprovalsView() {
  const scope = delegatedScope();
  const { endorsementStateOf, delegatedReviewOf, reviewDelegated, returnFromDelegated } =
    useInstitutionalLifecycle();
  const [view, setView] = useState('pending');
  const [openId, setOpenId] = useState(null);

  const requests = useMemo(
    () =>
      routedRevisions(scope, endorsementStateOf, {
        timetableStateOf,
        departmentName: departmentLabel,
        hodName: (id) => hodOf(id)?.name ?? null,
      })
        .map((r) => toRequest(r, scope, delegatedReviewOf(r.departmentId))),
    [scope, endorsementStateOf, delegatedReviewOf]
  );

  const visible = requests.filter((r) =>
    view === 'pending' ? r.status === 'pending' : r.status !== 'pending'
  );
  const pendingCount = requests.filter((r) => r.status === 'pending').length;
  const open = openId ? requests.find((r) => r.id === openId) : null;

  function decide(departmentId, outcome, note) {
    const result =
      outcome === 'approved'
        ? reviewDelegated(departmentId, { note })
        : returnFromDelegated(departmentId, { reason: note });

    if (!result.ok) {
      toast.error(
        result.detail ??
          (result.reason === 'reason_required'
            ? 'Returning a revision needs a reason its author can act on.'
            : 'That decision could not be recorded.')
      );
      return;
    }

    setOpenId(null);
    toast.success(
      outcome === 'approved'
        ? 'Reviewed — routed to the institution head'
        : 'Returned to the department'
    );
  }

  return (
    <div className={PANE}>
      <DelegatedScopeHeader scope={scope} trail="Routed approvals" />

      <div className="flex-none flex items-center gap-[8px] flex-wrap mb-[4px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Routed approvals</h1>

        <div role="tablist" aria-label="Review views" className="flex items-center gap-[4px] ml-[4px]">
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
                  : 'text-ink-muted font-[500] hover:text-ink hover:bg-tint2'
              )}
            >
              {v.label}
              {v.key === 'pending' && pendingCount > 0 && (
                <span className="ml-[5px] text-[11px] tabular-nums text-ink-faint">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* The limit of this seat, stated where the decisions are taken. */}
      <p className="flex-none m-0 mb-[12px] text-[11.5px] text-ink-faint">{endorsementChainLabel()}</p>

      <ApprovalInbox
        requests={visible}
        onOpen={setOpenId}
        kinds={DELEGATED_REQUEST_KINDS}
        statusLabels={{
          pending: 'Pending review',
          approved: 'Reviewed — sent onward',
          rejected: 'Returned',
        }}
        emptyState={
          view === 'decided' ? (
            <NoResults what="reviewed revisions" />
          ) : (
            <TableEmptyState
              title="Nothing is routed to this position."
              hint="Endorsed revisions from the delegated departments arrive here before the institution head sees them."
            />
          )
        }
      />

      <DecisionDrawer
        request={open}
        onClose={() => setOpenId(null)}
        onDecide={decide}
        kinds={DELEGATED_REQUEST_KINDS}
        outcomeLabels={{ approved: 'Review and route onward', rejected: 'Return to department' }}
        recordedLabels={{ approved: 'Reviewed and routed onward', rejected: 'Returned to the department' }}
      />
    </div>
  );
}
