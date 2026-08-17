import { BookOpen, FlaskConical } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * The one place theory vs practical is given a look, shared by the timetable
 * grid, the legend, and the workload breakdown so no surface invents its own
 * variant.
 *
 * Both tints are deliberately desaturated paper-tinted washes, not subject
 * colours: cool teal-blue for theory, muted lilac for practical. Colour never
 * carries the meaning on its own — every use pairs it with an icon (book /
 * flask) or a text label, so the distinction survives greyscale and colour
 * vision deficiency.
 *
 * They stay literals rather than tokens because this is a categorical pair of
 * two, not a status family the rest of the app shares. What changed in the
 * polish pass is only their cast: the theory wash was a warm cream
 * (`#F5F3EE`), which read as a beige patch in a blue-white grid, and both are
 * now on the same cool axis as every surface around them.
 */
export const SESSION_TYPES = {
  theory: {
    label: 'Theory',
    Icon: BookOpen,
    cell: 'bg-[#EFF5F9]',
    edge: 'border-l-[#B6D2DD]',
    icon: 'text-[#3F6E7C]',
    chip: 'bg-[#E7F0F5] text-[#31606E]',
    dot: 'bg-[#7FA9B4]',
  },
  practical: {
    label: 'Practical',
    Icon: FlaskConical,
    cell: 'bg-[#F4F1F9]',
    edge: 'border-l-[#CFC5E2]',
    icon: 'text-[#5F5177]',
    chip: 'bg-[#ECE7F5] text-[#544672]',
    dot: 'bg-[#A296B8]',
  },
};

/** Small type chip — icon + word. Used where a row has room for the label in full. */
export function SessionTypeChip({ type, className }) {
  const meta = SESSION_TYPES[type];
  if (!meta) return null;
  const { Icon, label, chip } = meta;
  return (
    <span className={cn('inline-flex items-center gap-[4px] h-[19px] px-[6px] rounded-[6px] text-[10.5px] font-[500]', chip, className)}>
      <Icon size={10.5} strokeWidth={2.1} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Icon-only marker for dense grid cells — the accessible name still says the word. */
export function SessionTypeIcon({ type, className }) {
  const meta = SESSION_TYPES[type];
  if (!meta) return null;
  const { Icon, label, icon } = meta;
  return (
    <Icon
      size={11}
      strokeWidth={2}
      role="img"
      aria-label={label}
      className={cn('flex-none', icon, className)}
    />
  );
}

/** The quiet legend that sits with the timetable's controls — never a card. */
export function SessionTypeLegend({ className }) {
  return (
    <div className={cn('flex items-center gap-[10px]', className)}>
      {Object.entries(SESSION_TYPES).map(([key, { Icon, label, cell, icon }]) => (
        <span key={key} className="inline-flex items-center gap-[5px] text-[11px] text-ink-muted">
          <span className={cn('flex-none w-[14px] h-[14px] grid place-items-center rounded-[4px] border border-line', cell)}>
            <Icon size={9} strokeWidth={2.2} className={icon} aria-hidden="true" />
          </span>
          {label}
        </span>
      ))}
    </div>
  );
}
