import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { FILTER_SURFACE } from './FilterPopover';

/** `Data Structures · II B.Sc CS — A` — the class line, kept short. */
function scopeLine(subject) {
  return [subject.classCode, subject.batch].filter(Boolean).join(' · ');
}

/**
 * The scope every number in Attendance history is measured against: which
 * subject/class, and how much of it has actually been submitted. Reads as
 * `Data Structures · II B.Sc CS — A · 72 / 90 hrs`.
 */
export function SubjectScopeSelector({ subjects, value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = subjects.find((s) => s.key === value) ?? subjects[0];
  if (!current) return null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Change subject scope"
          className={cn(
            'inline-flex items-center gap-[9px] h-[36px] pl-[13px] pr-[10px] max-w-full rounded-[11px] border font-sans cursor-pointer transition-colors duration-200',
            open ? 'border-accent-line bg-accent-soft' : 'border-line bg-paper hover:bg-tint2'
          )}
        >
          <span className="text-[14px] font-[600] text-ink truncate">{current.subject}</span>
          <span className="text-[12px] text-ink-muted truncate">{scopeLine(current)}</span>
          <span className="text-ink-faint" aria-hidden="true">·</span>
          <span className="text-[12px] font-[500] text-accent tabular-nums whitespace-nowrap">
            {current.submittedHours} / {current.scheduledHours} hrs
          </span>
          <ChevronDown size={13} strokeWidth={2} className="flex-none text-ink-faint" aria-hidden="true" />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={cn(FILTER_SURFACE, 'p-[5px] w-[340px]')}>
          {subjects.map((s) => {
            const on = s.key === current.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => { onChange(s.key); setOpen(false); }}
                className={cn(
                  'flex items-center gap-[10px] w-full px-[10px] py-[8px] border-0 bg-transparent rounded-[9px] font-sans cursor-pointer text-left hover:bg-tint2'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-[13px] truncate', on ? 'text-accent font-[500]' : 'text-ink font-[500]')}>
                    {s.subject}
                  </span>
                  <span className="block text-[11px] text-ink-faint truncate">
                    {scopeLine(s)}
                    {s.ownership === 'substitute' ? ' · Substitute' : ''}
                  </span>
                </span>
                <span className="flex-none text-[11.5px] text-ink-muted tabular-nums">
                  {s.submittedHours} / {s.scheduledHours} hrs
                </span>
                {on && <Check size={13} strokeWidth={2.4} className="flex-none text-accent" aria-hidden="true" />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** One inline metric strip — never a row of dashboard cards. */
export function SubjectSummaryStrip({ ledger }) {
  if (!ledger) return null;
  const metrics = [
    // Doubles as the completeness label: every number here is submitted-only.
    <>Based on <span className="font-[600] text-ink tabular-nums">{ledger.submittedHours}</span> submitted hrs</>,
    <>Class average <span className="font-[600] text-ink tabular-nums">{ledger.classAverage}%</span></>,
  ];
  if (ledger.belowThreshold > 0) {
    metrics.push(<><span className="font-[600] text-danger tabular-nums">{ledger.belowThreshold}</span> below 75%</>);
  }
  if (ledger.unsubmittedHours > 0) {
    metrics.push(
      <>
        <span className="tabular-nums">{ledger.unsubmittedHours}</span>
        {ledger.unsubmittedHours === 1 ? ' hr' : ' hrs'} not yet submitted
      </>
    );
  }

  return (
    <div className="flex items-center gap-[10px] flex-wrap text-[12px] text-ink-muted">
      {metrics.map((m, i) => (
        <span key={i} className="inline-flex items-center gap-[10px]">
          {i > 0 && <span className="text-ink-faint" aria-hidden="true">·</span>}
          <span>{m}</span>
        </span>
      ))}
    </div>
  );
}
