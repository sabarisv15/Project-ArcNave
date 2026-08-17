import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../lib/utils';

/** Icon-only control with a Radix tooltip + accessible label (used app-wide). */
export function IconButton({ label, tooltip, className, children, ...props }) {
  const button = (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'grid place-items-center border-0 bg-transparent text-ink-faint cursor-pointer',
        'transition-colors duration-200 hover:bg-accent-soft hover:text-accent',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
  if (!tooltip) return button;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{button}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-[90] rounded-[8px] bg-ink px-[9px] py-[5px] text-[11.5px] text-sidebar shadow-pop data-[state=delayed-open]:animate-fadeUp data-[state=instant-open]:animate-fadeUp motion-reduce:animate-none"
        >
          {tooltip}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
