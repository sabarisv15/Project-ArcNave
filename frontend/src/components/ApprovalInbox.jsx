import { ChevronRight } from 'lucide-react';
import { REQUEST_KINDS, STATUS_LABELS, STATUS_ROW_EDGE, STATUS_TONE } from '../lib/approvalsData';
import { STICKY_HEAD, TABLE_HEAD, StickyTableShell } from './WorkspaceLayout';
import { NothingPending } from './InstitutionalState';
import { cn } from '../lib/utils';

/**
 * A queue of requests waiting on a seat.
 *
 * Built to be reused by the department and institution seats later, so it knows
 * nothing about classes: it takes requests and renders type, who asked and in
 * what position, the scope the request belongs to, when it arrived, and where it
 * has got to. Anything role-specific belongs to the screen around it.
 *
 * Requester **and position** are both shown, never just a name — the same
 * person can raise a request from different seats, and which one they were
 * acting in is part of the request.
 *
 * `kinds` is how a seat brings its own request types. It defaults to the Class
 * Tutor map, so every existing caller renders exactly as before; the department
 * seat passes its own rather than having its types merged into the shared one,
 * which would put four types a tutor can never receive into the tutor's filters.
 */

const GRID = 'grid grid-cols-[150px_1.4fr_1fr_110px_112px_44px] gap-x-[12px] items-center px-[16px]';

function relative(date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * `statusLabels` exists for the same reason `kinds` does, one level down: a seat
 * whose outcome is not an approval must not render the word "Approved" over its
 * queue. The status keys are shared, so filtering and tone stay one
 * implementation; only the words a seat uses for them change.
 */
export function ApprovalInbox({ requests, onOpen, emptyState, kinds = REQUEST_KINDS, statusLabels = STATUS_LABELS }) {
  return (
    <StickyTableShell minWidth={860}>
      <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
        <span>Type</span>
        <span>Requested by</span>
        <span>Scope</span>
        <span>Submitted</span>
        <span>Status</span>
        <span className="sr-only">Open</span>
      </div>

      {requests.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpen(r.id)}
          aria-label={`${kinds[r.kind].label} from ${r.requester.name} — open`}
          className={cn(
            GRID,
            'w-full h-[50px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
            /*
              The status, restated as an edge on the row itself, so a queue can
              be read in one downward scan rather than badge by badge. It is
              the same family the badge uses — one meaning, one value — and the
              row surface underneath stays white.
            */
            STATUS_ROW_EDGE[r.status],
          )}
        >
          <span className="text-[12.5px] text-ink truncate">{kinds[r.kind].short}</span>

          <span className="min-w-0">
            <span className="block text-[13px] text-ink truncate">{r.requester.name}</span>
            <span className="block text-[11px] text-ink-faint truncate">{r.requester.position}</span>
          </span>

          <span className="min-w-0">
            <span className="block text-[12.5px] text-ink-muted truncate" title={r.scope}>
              {r.subject}
            </span>
            <span className="block text-[11px] text-ink-faint truncate">{r.scope}</span>
          </span>

          <span className="text-[12px] text-ink-muted tabular-nums">{relative(r.requestedAt)}</span>

          <span>
            <span
              className={cn(
                'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                STATUS_TONE[r.status],
              )}
            >
              {statusLabels[r.status] ?? STATUS_LABELS[r.status]}
            </span>
          </span>

          <span className="flex justify-end text-ink-faint">
            <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
      ))}

      {requests.length === 0 && (emptyState ?? <NothingPending />)}
    </StickyTableShell>
  );
}
