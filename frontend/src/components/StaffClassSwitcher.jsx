import { cn } from '../lib/utils';
import { SCOPE_TOTAL, STAFF_CLASSES } from '../lib/studentsData';

/**
 * Class-first entry point: the staff member's assigned classes as compact tabs
 * (class · subject · student count, plus NOW / NEXT for today's schedule), with
 * an "All my students" tab first. Selecting a tab re-scopes the whole page.
 */
export function StaffClassSwitcher({ scope, onSelect }) {
  const tabs = [
    {
      id: 'all',
      code: 'All my students',
      subject: `${STAFF_CLASSES.length} assigned classes`,
      count: SCOPE_TOTAL,
      when: null,
    },
    ...STAFF_CLASSES.map((c) => ({
      id: c.id,
      code: c.code,
      subject: c.subject,
      count: c.studentIds.length,
      when: c.when,
    })),
  ];

  return (
    <div className="mb-[16px]">
      <div className="flex items-baseline gap-[9px] mb-[8px]">
        <span className="text-[10px] tracking-[.08em] uppercase text-accent font-[500]">My classes</span>
        <span className="text-[11px] text-ink-faint">
          {STAFF_CLASSES.length} classes · {SCOPE_TOTAL} unique students
        </span>
      </div>

      <div
        role="tablist"
        aria-label="My classes"
        className="hidden md:flex gap-[8px] overflow-x-auto scroll-quiet pt-px px-px pb-[3px]"
      >
        {tabs.map((t) => {
          const on = scope === t.id;
          const live = t.when === 'live';
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onSelect(t.id)}
              className={cn(
                'flex-none flex flex-col gap-[2px] min-w-[162px] pt-[9px] px-[13px] pb-[10px] rounded-[12px] text-left font-sans cursor-pointer transition-[background-color,border-color,transform] duration-200 active:scale-[.985] motion-reduce:active:scale-100',
                on
                  ? 'bg-accent-soft border border-accent-line shadow-[inset_0_0_0_1px_rgb(var(--c-accent-line))]'
                  : 'bg-paper border border-line hover:border-accent-line'
              )}
            >
              <span className="flex items-center gap-[7px]">
                <span className={cn('text-[12.5px] font-[500] whitespace-nowrap', on ? 'text-accent' : 'text-ink')}>
                  {t.code}
                </span>
                {(t.when === 'live' || t.when === 'next') && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-[4px] text-[9px] font-[600] tracking-[.07em] uppercase',
                      live ? 'text-success' : 'text-accent'
                    )}
                  >
                    <span
                      className={cn('w-[5px] h-[5px] rounded-full flex-none', live ? 'bg-success' : 'bg-accent-line')}
                    />
                    {live ? 'Now' : 'Next'}
                  </span>
                )}
              </span>
              <span className={cn('text-[11px] whitespace-nowrap', on ? 'text-accent' : 'text-ink-faint')}>
                {t.subject}
              </span>
              <span className={cn('text-[11px] whitespace-nowrap', on ? 'text-accent' : 'text-ink-faint')}>
                {t.count} students
              </span>
            </button>
          );
        })}
      </div>

      {/* Mobile: one "current class" selector that keeps class, subject and count visible. */}
      <div className="md:hidden">
        <select
          aria-label="Current class"
          value={scope}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full h-[40px] px-[11px] bg-paper border border-accent-line rounded-[12px] font-sans text-[13px] font-[500] text-accent outline-none"
        >
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id === 'all'
                ? `All my students · ${t.count} students`
                : `${t.code} · ${t.subject} · ${t.count} students${t.when === 'live' ? ' · now' : t.when === 'next' ? ' · next' : ''}`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
