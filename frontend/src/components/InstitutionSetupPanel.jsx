/**
 * Operational readiness, as an advisory panel.
 *
 * A **compact full-width block**, not an onboarding hero, a stepper, a modal or
 * a card grid — it sits in the governance stack between the metrics and the
 * work awaiting a decision, and costs about as much vertical budget as one
 * table. Nothing here blocks anything: every other destination stays reachable,
 * and the panel's whole job is to say what is not yet running and open the page
 * that owns it.
 *
 * **It is not a first-login task list**, and the copy no longer implies one.
 * Departments, intake, sections and capacities are provisioned by an application
 * built outside this prototype and by a seat that is not this one; an
 * institution head reads operations against them rather than setting them up.
 *
 * It renders `institutionSetupData.js` and decides nothing. That separation is
 * the point — what "ready" means is a rule about the institution, testable on
 * its own, and a component that computed it while drawing it would let the
 * panel and the pages it links to disagree.
 *
 * Two rows deliberately carry **no control**. Class Tutor coverage is the head
 * of department's decision, so it is reported and says so; attendance is a
 * consequence of an approved timetable rather than a setting, so it explains
 * itself instead of offering a toggle. And a row whose destination has not been
 * built — Academic Year — renders quiet text rather than a control that goes
 * nowhere, which is the same rule the Principal's nav already follows.
 *
 * Composed from the surfaces, badges and row rhythm the institution screens
 * already use: no new token, colour, font or breakpoint.
 */

import { useNavigate } from 'react-router-dom';
import { AlertCircle, Check, ChevronRight, Clock, CircleDot } from 'lucide-react';
import { INSTITUTION_SETUP, SETUP_STATUS } from '../lib/institutionSetupData';
import { TABLE_HEAD } from './WorkspaceLayout';
import { cn } from '../lib/utils';

/**
 * The compact marker at the head of a row.
 *
 * A shape as well as a colour: "complete" and "needs attention" must stay
 * distinguishable without relying on hue alone, and the icon is what carries
 * that when the badge beside it is read as a word rather than a swatch.
 */
const ROW_MARKER = {
  complete: { Icon: Check, tone: 'text-success' },
  progress: { Icon: Clock, tone: 'text-pending' },
  attention: { Icon: AlertCircle, tone: 'text-danger' },
  derived: { Icon: CircleDot, tone: 'text-ink-faint' },
};

function StateBadge({ state }) {
  return (
    <span
      className={cn(
        'flex-none inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
        state.tone,
      )}
    >
      {state.label}
    </span>
  );
}

/**
 * One readiness row.
 *
 * The wrap order is where the responsive behaviour lives, and it is one
 * declaration rather than two layouts: from `md` up the row reads label →
 * observed value → status → action across a single line; below it the value
 * drops to its own full-width line and the action below that, which keeps the
 * status beside the label it belongs to at every width and never produces a
 * horizontal scroll.
 */
function SetupRow({ row, onOpen }) {
  const marker = ROW_MARKER[row.state.kind] ?? ROW_MARKER.derived;
  const { Icon } = marker;

  return (
    <li className="border-t border-line-light first:border-t-0">
      <div className="px-[14px] py-[10px] flex flex-wrap items-center gap-x-[9px] gap-y-[5px]">
        <Icon size={14} strokeWidth={2} aria-hidden="true" className={cn('order-1 flex-none', marker.tone)} />

        <span className="order-2 flex-none text-[13px] font-[500] text-ink">{row.label}</span>

        <span className="order-3 md:order-4">
          <StateBadge state={row.state} />
        </span>

        <span className="order-4 md:order-3 w-full md:w-auto md:flex-1 min-w-0 text-[12.5px] text-ink-muted">
          {row.value}
        </span>

        {row.action ? (
          <button
            type="button"
            onClick={() => onOpen(row.action.to)}
            className="order-5 w-full md:w-auto md:flex-none inline-flex items-center gap-[3px] min-h-[24px] border-0 bg-transparent p-0 font-sans text-[12px] font-[500] text-accent text-left cursor-pointer hover:underline"
          >
            {row.action.label}
            <ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {/*
        Supporting context: where an authority sits, what a pending revision
        does not do, or where a control will live once it exists. Indented to
        the label rather than the marker, and never styled as an action.
      */}
      {row.note && (
        <div className="px-[14px] pb-[10px] -mt-[2px] pl-[33px] text-[11.5px] text-ink-faint">{row.note}</div>
      )}
    </li>
  );
}

export function InstitutionSetupPanel({ setup = INSTITUTION_SETUP }) {
  const navigate = useNavigate();
  const status = SETUP_STATUS[setup.status];

  return (
    <section
      aria-labelledby="institution-setup-title"
      className="bg-paper border border-line rounded-[16px] overflow-hidden"
    >
      <header className="flex items-start gap-[10px] px-[14px] py-[11px] bg-mist border-b border-line">
        <div className="min-w-0 flex-1">
          <div className={TABLE_HEAD}>Institution</div>
          <h2 id="institution-setup-title" className="m-0 mt-[3px] text-[12.5px] font-[600] text-ink">
            Operational readiness
          </h2>
          <p className="mt-[2px] mb-0 text-[12px] text-ink-muted">
            What is running against the structure provisioned for this institution.
          </p>
        </div>
        <span
          className={cn(
            'flex-none inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
            status.tone,
          )}
        >
          {status.label}
        </span>
      </header>

      <ul className="m-0 p-0 list-none">
        {setup.rows.map((row) => (
          <SetupRow key={row.id} row={row} onOpen={(to) => navigate(to)} />
        ))}
      </ul>
    </section>
  );
}
