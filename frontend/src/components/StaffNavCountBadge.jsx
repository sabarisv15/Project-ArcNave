import { cn } from '../lib/utils';
import { STAFF_TOTAL } from '../lib/staffData';

/** Total staff in the accessible directory — same muted badge style as Students. */
export function StaffNavCountBadge({ active, count = STAFF_TOTAL }) {
  return (
    <span
      title={`${count} staff in the directory`}
      className={cn(
        'ml-auto min-w-[27px] h-[19px] inline-flex items-center justify-center px-[6px] rounded-[7px] text-[10.5px] font-[500] tabular-nums transition-colors duration-200',
        active ? 'bg-paper text-accent' : 'bg-tint2 text-ink-muted'
      )}
    >
      {count}
    </span>
  );
}
