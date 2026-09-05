import { cn } from '../lib/utils';
import { SCOPE_TOTAL, STAFF_CLASSES } from '../lib/studentsData';

/**
 * Total unique students inside the signed-in staff member's teaching scope.
 * Not an institution-wide count — it changes with the assigned classes.
 */
export function StudentNavCountBadge({ active, count = SCOPE_TOTAL }) {
  return (
    <span
      title={`${count} unique students across your ${STAFF_CLASSES.length} assigned classes`}
      className={cn(
        'ml-auto min-w-[27px] h-[19px] inline-flex items-center justify-center px-[6px] rounded-[7px] text-[10.5px] font-[500] tabular-nums transition-colors duration-200',
        active ? 'bg-paper text-accent' : 'bg-tint2 text-ink-muted',
      )}
    >
      {count}
    </span>
  );
}
