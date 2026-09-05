import { forwardRef, useId, useRef } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Calendar, Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { FILTER_SURFACE } from './FilterPopover';

/**
 * The profile's field primitives.
 *
 * Two rendering modes, one set of components: a **read** row is a definition
 * pair (label above, value below) with no box around it, and an **edit** field
 * is the same pair with a real control in place of the value. Nothing ever
 * renders as a disabled input — a greyed-out box reads as "broken" rather than
 * "not yours", so institution-owned data uses the read row plus one
 * section-level explanation instead.
 */

const CONTROL =
  'w-full h-[36px] px-[11px] bg-paper border border-line rounded-[9px] font-sans text-[13px] font-[400] text-ink outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]';

export const PROFILE_CONTROL = CONTROL;

/** One compact section: quiet title, optional right-hand note, hairline body. */
export function ProfileSection({ title, note, action, children, id }) {
  return (
    <section id={id} aria-label={title} className="border border-line rounded-[16px] bg-paper overflow-hidden">
      <header className="flex items-center justify-between gap-[12px] px-[16px] py-[11px] border-b border-line bg-mist">
        <div className="min-w-0">
          <h2 className="m-0 text-[13.5px] font-[600] tracking-[-.005em] text-ink">{title}</h2>
          {note && <p className="m-0 mt-[1px] text-[12px] font-[400] text-ink-faint">{note}</p>}
        </div>
        {action}
      </header>
      <div className="px-[16px] py-[14px]">{children}</div>
    </section>
  );
}

/** Two even columns on desktop, one on narrow viewports. */
export function FieldGrid({ children, className }) {
  return <div className={cn('grid gap-x-[18px] gap-y-[14px] sm:grid-cols-2', className)}>{children}</div>;
}

export function FieldLabel({ htmlFor, children, required }) {
  return (
    <label htmlFor={htmlFor} className="block text-[12px] font-[500] text-ink-muted mb-[5px]">
      {children}
      {required && <span className="text-danger"> *</span>}
    </label>
  );
}

/** Read-only definition row — the only way institution-owned values are shown. */
export function ReadRow({ label, value, hint, className }) {
  return (
    <div className={className}>
      <div className="text-[12px] font-[400] text-ink-faint">{label}</div>
      <div className="mt-[2px] text-[13.5px] font-[500] text-ink">
        {value || <span className="text-ink-faint font-[400]">Not provided</span>}
      </div>
      {hint && <div className="mt-[2px] text-[12px] font-[400] text-ink-faint">{hint}</div>}
    </div>
  );
}

export function FieldError({ children }) {
  if (!children) return null;
  return <p className="m-0 mt-[5px] text-[12px] font-[400] text-danger">{children}</p>;
}

/** Labelled wrapper that owns the id wiring, so every control is programmatically labelled. */
export function Field({ label, required, error, hint, children, className }) {
  const id = useId();
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      {typeof children === 'function' ? children(id) : children}
      {hint && !error && <p className="m-0 mt-[5px] text-[12px] font-[400] text-ink-faint">{hint}</p>}
      <FieldError>{error}</FieldError>
    </div>
  );
}

export const TextInput = forwardRef(function TextInput({ className, ...props }, ref) {
  return <input ref={ref} className={cn(CONTROL, className)} {...props} />;
});

/**
 * Form select. Same Radix machinery as the filter surfaces so keyboard nav,
 * typeahead and Escape behave identically, but sized for a form row.
 */
export function ProfileSelect({ id, value, onChange, options, placeholder = 'Select…', ariaLabel }) {
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={onChange}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          CONTROL,
          'flex items-center justify-between gap-[6px] cursor-pointer data-[state=open]:border-accent-line',
        )}
      >
        <SelectPrimitive.Value placeholder={<span className="text-ink-faint">{placeholder}</span>} />
        <SelectPrimitive.Icon>
          <ChevronDown size={14} strokeWidth={2} className="text-ink-faint" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className={cn(FILTER_SURFACE, 'overflow-hidden')}>
          <SelectPrimitive.Viewport className="p-[5px] max-h-[260px]">
            {options.map((o) => {
              const val = typeof o === 'string' ? o : o.value;
              const label = typeof o === 'string' ? o : o.label;
              return (
                <SelectPrimitive.Item
                  key={val}
                  value={val}
                  className="flex items-center justify-between gap-[10px] h-[30px] px-[9px] rounded-[8px] font-sans text-[13px] font-[400] text-ink cursor-pointer outline-none select-none data-[highlighted]:bg-tint2 data-[state=checked]:text-accent data-[state=checked]:font-[500]"
                >
                  <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <Check size={12} strokeWidth={2.4} className="text-accent" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/**
 * Date of birth, always shown as DD/MM/YYYY.
 *
 * The visible control is a plain text field in that format — a native
 * `<input type="date">` renders in the browser's locale, which is exactly how
 * a DD/MM institution ends up reading dates as MM/DD. The native picker is
 * still available (calendar button → `showPicker()`, falling back to focusing
 * the hidden date input), so typing is fast and picking is still possible, but
 * the format on screen is never the browser's decision.
 */
export function DateField({ id, value, onChange, max, ariaLabel }) {
  const nativeRef = useRef(null);

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="bday"
        placeholder="DD/MM/YYYY"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => {
          // Digits only, re-grouped as the user types: 12041987 → 12/04/1987.
          const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
          const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
          onChange(parts.join('/'));
        }}
        className={cn(CONTROL, 'pr-[38px]')}
      />
      <button
        type="button"
        aria-label="Open date picker"
        title="Pick a date"
        onClick={() => {
          const el = nativeRef.current;
          if (!el) return;
          if (typeof el.showPicker === 'function') el.showPicker();
          else el.focus();
        }}
        className="absolute right-[4px] top-1/2 -translate-y-1/2 w-[30px] h-[28px] grid place-items-center rounded-[7px] border-0 bg-transparent text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-accent"
      >
        <Calendar size={15} strokeWidth={1.8} />
      </button>
      <input
        ref={nativeRef}
        type="date"
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const iso = e.target.value;
          if (!iso) return;
          const [y, m, d] = iso.split('-');
          onChange(`${d}/${m}/${y}`);
        }}
        className="absolute right-[10px] bottom-0 w-px h-px opacity-0 pointer-events-none"
      />
    </div>
  );
}

/** Month/year control — `<input type="month">`, displayed everywhere else as MM/YYYY. */
export function MonthField({ id, value, onChange, ariaLabel, disabled }) {
  return (
    <input
      id={id}
      type="month"
      value={value || ''}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className={cn(CONTROL, disabled && 'opacity-45 cursor-not-allowed')}
    />
  );
}

/** Quiet inline checkbox — label is the click target, no card around it. */
export function CheckboxField({ checked, onChange, label, hint }) {
  const id = useId();
  return (
    <div className="flex items-start gap-[9px]">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[2px] w-[15px] h-[15px] accent-accent cursor-pointer"
      />
      <label htmlFor={id} className="cursor-pointer select-none">
        <span className="block text-[13px] font-[500] text-ink">{label}</span>
        {hint && <span className="block text-[12px] font-[400] text-ink-faint">{hint}</span>}
      </label>
    </div>
  );
}
