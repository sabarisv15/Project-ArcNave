import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { DelegatedScopeHeader } from '../components/DelegatedScopeHeader';
import { SeatStateBadge } from '../components/SeatStateBadge';
import { WorkflowTimeline } from '../components/WorkflowTimeline';
import { AuditHistory } from '../components/AuditHistory';
import { NoAssignedScope } from '../components/InstitutionalState';
import { TABLE_HEAD, TableEmptyState } from '../components/WorkspaceLayout';
import { DELEGATED_ROOT, delegatedScope, routedRevisions } from '../lib/delegatedScope';
import { ENDORSEMENT_STATES, chainProgress, endorsementChainLabel } from '../lib/endorsementChain';
import { DEPARTMENT_BY_ID, departmentLabel, hodOf } from '../lib/institutionData';
import { timetableStateOf } from '../lib/institutionTimetableData';
import { useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';
import { cn } from '../lib/utils';

/**
 * Delegated Overview — the delegated seat's landing.
 *
 * **Everything on it is configuration.** There is no fixed set of panels a
 * delegated workspace has, because there is no fixed delegated role: what the
 * seat covers, which work areas it carries and whether it sits in a workflow
 * chain are all provisioned per institution, and a college that delegated none
 * of those gets a screen that says so rather than one padded with rows it did
 * not ask for.
 *
 * Ordered the way the other institutional landings are: what is waiting on this
 * seat first, what it is responsible for second, and the standing scope last.
 * A seat that has nothing routed to it reads that in one line at the top rather
 * than having to infer it from an empty table further down.
 *
 * **It states its own limit.** The chain line names the seat that approves
 * finally, and it is not this one — an oversight screen that showed a queue and
 * no chain would let its reader believe the decision ends here.
 */

function Panel({ title, count, action, onAction, children }) {
  return (
    <section className="flex-1 min-w-0 bg-paper border border-line rounded-[16px] overflow-hidden">
      <header className="flex items-center gap-[8px] h-[40px] px-[14px] bg-mist border-b border-line">
        <h2 className="m-0 text-[12.5px] font-[600] text-ink">{title}</h2>
        {count > 0 && <span className="text-[11.5px] text-ink-faint tabular-nums">{count}</span>}
        <div className="flex-1" />
        {action && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-[3px] border-0 bg-transparent p-0 font-sans text-[12px] font-[500] text-accent cursor-pointer hover:underline"
          >
            {action}
            <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

function Row({ label, value, hint }) {
  return (
    <div className="grid grid-cols-[128px_1fr] gap-x-[12px] items-baseline px-[14px] py-[8px] border-t border-line-light first:border-t-0">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="m-0 text-[13px] text-ink">
        {value}
        {hint && <span className="block mt-[1px] text-[11.5px] text-ink-faint">{hint}</span>}
      </dd>
    </div>
  );
}

export function DelegatedOverview() {
  const navigate = useNavigate();
  const scope = delegatedScope();
  const { endorsementStateOf, delegatedReviewOf } = useInstitutionalLifecycle();

  const routed = routedRevisions(scope, endorsementStateOf, {
    timetableStateOf,
    departmentName: departmentLabel,
    hodName: (id) => hodOf(id)?.name ?? null,
  });
  const pending = routed.filter((r) => r.state === 'endorsed_pending_l2');
  const decidedHere = routed
    .map((r) => ({ ...r, review: delegatedReviewOf(r.departmentId) }))
    .filter((r) => r.review);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-[24px] pt-[18px] pb-[20px]">
      <DelegatedScopeHeader scope={scope} />

      <h1 className="flex-none m-0 mb-[12px] text-[17px] font-[600] tracking-[-.01em]">
        {scope.title}
      </h1>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet flex flex-col gap-[12px]">
        {/* The seat itself, before anything it is responsible for. A vacant
            delegated seat is a real institutional state, and the screens under
            it are not enterable while it lasts. */}
        <section className="bg-paper border border-line rounded-[16px] overflow-hidden">
          <header className="flex items-start gap-[10px] px-[14px] py-[11px] bg-mist border-b border-line">
            <div className="min-w-0 flex-1">
              <div className={TABLE_HEAD}>Position</div>
              <h2 className="m-0 mt-[3px] text-[12.5px] font-[600] text-ink">{scope.title}</h2>
            </div>
            <SeatStateBadge state={scope.seat.state} className="flex-none" />
          </header>
          <dl className="m-0 py-[4px]">
            <Row
              label="Held by"
              value={scope.occupied ? scope.seat.holderName : '—'}
              hint={
                scope.occupied
                  ? `${scope.seat.holderDesignation} · since ${scope.seat.since}`
                  : 'The position is configured but nobody holds it.'
              }
            />
            <Row
              label="Delegated scope"
              value={scope.areas.length > 0 ? scope.areas.join(' · ') : 'No areas were delegated.'}
              hint={scope.note}
            />
            <Row
              label="Approval chain"
              value={
                scope.inTimetableChain
                  ? 'In the timetable approval chain'
                  : 'Not in the timetable approval chain'
              }
              hint={endorsementChainLabel()}
            />
          </dl>
        </section>

        {scope.inTimetableChain && (
          <Panel
            title="Routed for your review"
            count={pending.length}
            action={pending.length > 0 ? 'Open approvals' : null}
            onAction={() => navigate(`${DELEGATED_ROOT}/approvals`)}
          >
            {pending.length === 0 ? (
              <TableEmptyState
                title="Nothing is routed to this position."
                hint="Endorsed revisions from the delegated departments arrive here before the institution head sees them."
              />
            ) : (
              <ul className="m-0 p-0 list-none">
                {pending.map((r) => (
                  <li key={r.departmentId}>
                    <button
                      type="button"
                      onClick={() => navigate(`${DELEGATED_ROOT}/approvals`)}
                      className="w-full grid grid-cols-[1fr_auto] gap-x-[12px] items-center px-[14px] py-[9px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2 first:border-t-0"
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] text-ink truncate">
                          {r.name}
                          <span className="text-ink-faint"> · {r.revision.label}</span>
                        </span>
                        <span className="block mt-[2px] text-[11.5px] text-ink-faint truncate">
                          Endorsed by {r.endorsedBy ?? 'the department'} · {r.submittedBy}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'flex-none inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                          ENDORSEMENT_STATES[r.state].tone
                        )}
                      >
                        {ENDORSEMENT_STATES[r.state].label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {/* Where a decision exists, the timeline and the audit line that go with
            it — the same primitives the other seats' decisions are recorded in,
            so a delegated review reads as the same kind of act. */}
        {decidedHere.length > 0 && (
          <Panel title="Reviewed here" count={decidedHere.length}>
            <div className="px-[14px] py-[11px] flex flex-col gap-[14px]">
              {decidedHere.map((r) => (
                <div key={r.departmentId}>
                  <div className="text-[12.5px] font-[500] text-ink">
                    {r.name}
                    <span className="font-[400] text-ink-faint"> · {r.revision.label}</span>
                  </div>
                  <div className="mt-[7px]">
                    <WorkflowTimeline
                      steps={chainProgress(r.state).map((s) => ({
                        label: s.title,
                        state: s.state,
                        at: null,
                        by: null,
                      }))}
                    />
                  </div>
                  <div className="mt-[6px]">
                    <AuditHistory
                      entries={[
                        {
                          action:
                            r.review.outcome === 'reviewed'
                              ? 'Reviewed and routed onward'
                              : 'Returned to the department',
                          by: scope.seat.holderName,
                          position: scope.title,
                          at: r.review.at,
                          note: r.review.note,
                        },
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <Panel title="Responsibilities" count={scope.responsibilities.length}>
          {scope.responsibilities.length === 0 ? (
            <NoAssignedScope />
          ) : (
            <ul className="m-0 p-0 list-none">
              {scope.responsibilities.map((r) => (
                <li key={r.id} className="px-[14px] py-[9px] border-t border-line-light first:border-t-0">
                  <div className="text-[13px] text-ink">{r.label}</div>
                  <div className="mt-[1px] text-[11.5px] text-ink-faint">{r.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Delegated departments"
          count={scope.departments.length}
          action={scope.workAreas.length > 0 ? 'Work areas' : null}
          onAction={() => navigate(`${DELEGATED_ROOT}/areas`)}
        >
          {scope.departments.length === 0 ? (
            <NoAssignedScope />
          ) : (
            <ul className="m-0 p-0 list-none">
              {scope.departments.map((d) => {
                const dept = DEPARTMENT_BY_ID[d.id];
                const state = endorsementStateOf(d.id);
                return (
                  <li
                    key={d.id}
                    className="grid grid-cols-[1fr_auto] gap-x-[12px] items-center px-[14px] py-[9px] border-t border-line-light first:border-t-0"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] text-ink truncate">{d.name}</span>
                      <span className="block mt-[2px] text-[11.5px] text-ink-faint truncate">
                        {dept ? `${dept.classCount} classes · ${dept.studentCount} students` : '—'}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'flex-none inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                        ENDORSEMENT_STATES[state].tone
                      )}
                      title={ENDORSEMENT_STATES[state].hint}
                    >
                      {ENDORSEMENT_STATES[state].label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
