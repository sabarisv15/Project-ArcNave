import { SEAT_STATES } from '../lib/seatState';
import { cn } from '../lib/utils';

/**
 * What state a seat is in.
 *
 * Three institutional states, and the first two are ordinary rather than
 * exceptional: a class runs perfectly well for a fortnight while its tutor
 * invitation is out. An outstanding invitation is deliberately **not** rendered
 * as coverage — it reads as its own waiting state, because a department that
 * counted invitations as filled would report itself covered while a class had
 * nobody in front of it.
 *
 * A shared component rather than a copied span, because the same badge has to
 * mean the same thing in the department's class table, the seat drawer, and the
 * class and institution screens when they read the same seats.
 */
export function SeatStateBadge({ state, className }) {
  const seat = SEAT_STATES[state] ?? SEAT_STATES.vacant;
  return (
    <span
      className={cn(
        'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500] max-w-full truncate',
        seat.tone,
        className,
      )}
    >
      {seat.label}
    </span>
  );
}
