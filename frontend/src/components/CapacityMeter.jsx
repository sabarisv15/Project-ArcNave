import { cn } from '../lib/utils';

/**
 * Enrolled against provisioned, and the space between them.
 *
 * Capacity is a **provisioned fact** — Platform Admin set this section's seat
 * count, and it may differ from its sibling section's. The roster count is a
 * different fact. The gap between them is the only number that decides whether
 * an admission or an import can go ahead, so it is stated rather than left for
 * the reader to subtract.
 *
 * A quiet bar in the app's existing vocabulary: `tint2` track, accent fill,
 * turning to the warning tone only when the section is genuinely full. Colour
 * never replaces the numbers.
 */
export function CapacityMeter({ enrolled, capacity, className }) {
  const safeCapacity = Math.max(1, capacity ?? 0);
  const pct = Math.min(100, Math.round((enrolled / safeCapacity) * 100));
  const headroom = Math.max(0, (capacity ?? 0) - enrolled);
  const full = headroom === 0;

  return (
    <div className={cn('min-w-[168px]', className)}>
      <div className="flex items-baseline gap-[6px]">
        <span className="text-[13px] font-[500] text-ink tabular-nums">
          {enrolled} / {capacity}
        </span>
        <span className="text-[11.5px] text-ink-faint">
          {full ? 'section full' : `${headroom} seat${headroom === 1 ? '' : 's'} free`}
        </span>
      </div>
      <div
        className="mt-[5px] h-[4px] rounded-full bg-tint2 overflow-hidden"
        role="img"
        aria-label={`${enrolled} of ${capacity} provisioned seats filled`}
      >
        <div
          className={cn('h-full rounded-full transition-all duration-300', full ? 'bg-pending' : 'bg-accent')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
