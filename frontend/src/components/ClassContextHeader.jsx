import { Lock } from 'lucide-react';
import { STAFF_CLASSES } from '../lib/studentsData';

/**
 * The scope line above the table: a locked scope chip (set by the class
 * switcher, never re-applied by hand) plus the readable class context.
 */
export function ClassContextHeader({ scopeIsAll, scopeClass, scopeTotal }) {
  const chip = scopeIsAll ? 'All my classes' : scopeClass.code;
  const context = scopeIsAll
    ? STAFF_CLASSES.map((c) => c.subject).join(' · ')
    : `${scopeClass.programme} · Section ${scopeClass.section} · ${scopeClass.subject}`;
  const secondary = scopeIsAll
    ? `${scopeTotal} unique students`
    : `${scopeTotal} students · ${
        scopeClass.when === 'live' ? 'in session now · ' : scopeClass.when === 'next' ? 'up next · ' : ''
      }${scopeClass.slot}`;

  return (
    <div className="flex items-center justify-between gap-[12px] flex-wrap mb-[10px]">
      <div className="flex items-center gap-[10px] min-w-0">
        <span
          title="This scope comes from the class selector"
          className="inline-flex items-center gap-[6px] h-[26px] px-[10px] bg-accent-soft border border-accent-line rounded-[10px] text-[11.5px] font-[500] text-accent whitespace-nowrap"
        >
          <Lock size={11} strokeWidth={2} />
          {chip}
        </span>
        <span className="text-[12.5px] font-[500] text-ink whitespace-nowrap overflow-hidden text-ellipsis">
          {context}
        </span>
      </div>
      <span className="text-[12px] text-ink-faint whitespace-nowrap">{secondary}</span>
    </div>
  );
}
