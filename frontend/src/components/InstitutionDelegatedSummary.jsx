import { PROVISIONING, level2Scope } from '../lib/provisioning';
import { level2Seat } from '../lib/seatState';
import { endorsementChain } from '../lib/endorsementChain';
import { seatTitle } from '../lib/seatTitles';
import { LEVEL_2 } from '../lib/roles';
import { SeatStateBadge } from './SeatStateBadge';
import { TABLE_HEAD } from './WorkspaceLayout';

/**
 * The delegated seat, as an institution head can currently read it.
 *
 * **Display only, and deliberately still so now that the seat has a workspace of
 * its own.** That workspace belongs to the delegated seat; what an institution
 * head needs here is who holds the position, what it covers and where it sits in
 * the approval chain — not a way into somebody else's workspace. It states those
 * three because an institution head whose timetable revisions pass through a
 * seat they cannot see anywhere in the interface has been given a workflow with
 * a hole in it.
 *
 * **A vacant delegated seat still appears here.** A configured position with
 * nobody in it is a different fact from an institution that never had one, and
 * the head of the institution is precisely the person who should see it.
 *
 * **It renders nothing at all when no such seat was provisioned.** Not an empty
 * card, not a "not configured" row, not a call to action. An institution without
 * a delegated seat has an L3 → L1 chain and that is an ordinary, complete
 * arrangement — rendering a placeholder would frame a perfectly configured
 * institution as one missing a component. The `null` from `level2Seat()` is what
 * makes that structural rather than something each caller remembers.
 */
export function InstitutionDelegatedSummary({ provisioning = PROVISIONING }) {
  const seat = level2Seat(provisioning);
  const scope = level2Scope(provisioning);
  if (!seat) return null;

  const title = seatTitle(LEVEL_2, provisioning);
  const chain = endorsementChain(provisioning);
  const inChain = chain.some((step) => step.key === LEVEL_2);

  return (
    <section
      aria-labelledby="delegated-seat-title"
      className="bg-paper border border-line rounded-[16px] overflow-hidden"
    >
      <header className="flex items-start gap-[10px] px-[14px] py-[11px] bg-mist border-b border-line">
        <div className="min-w-0 flex-1">
          <div className={TABLE_HEAD}>Delegated seat</div>
          <h2 id="delegated-seat-title" className="m-0 mt-[3px] text-[12.5px] font-[600] text-ink">
            {title}
          </h2>
        </div>
        <SeatStateBadge state={seat.state} className="flex-none" />
      </header>

      <dl className="m-0 px-[14px] py-[4px]">
        <Row
          label="Held by"
          value={seat.state === 'active' ? seat.holderName : seat.invitedEmail ?? '—'}
          hint={
            seat.state === 'active'
              ? `${seat.holderDesignation} · since ${seat.since}`
              : seat.state === 'invite_pending'
                ? 'The seat is not held until the invitation is accepted.'
                : 'The position is configured but nobody holds it. Anything routed to it waits.'
          }
        />
        <Row
          label="Delegated scope"
          value={scope.areas.join(' · ')}
          hint={scope.note}
        />
        <Row
          label="Approval chain"
          value={inChain ? 'In the timetable approval chain' : 'Not in the timetable approval chain'}
          hint={chain.map((s) => s.title).join(' → ')}
        />
      </dl>

      <p className="m-0 px-[14px] pb-[11px] text-[11.5px] text-ink-faint">
        Configuration and occupancy only. This position works in its own workspace.
      </p>
    </section>
  );
}

function Row({ label, value, hint }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-x-[12px] items-baseline py-[8px] border-t border-line-light first:border-t-0">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="m-0 text-[13px] text-ink">
        {value}
        {hint && <span className="block mt-[1px] text-[11.5px] text-ink-faint">{hint}</span>}
      </dd>
    </div>
  );
}
