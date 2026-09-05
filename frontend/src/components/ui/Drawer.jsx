import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// P3 5.8 — the app's shared drawer chrome.
//
// These four lived inside AttendanceActionDrawer.jsx, and roughly 25
// unrelated drawers (assessments, departments, institution, documents,
// promotions, ...) imported them from there. That was invisible while
// everything sat in one flat components/ folder; it became impossible to
// ignore the moment attendance moved into its own feature, because it
// would have made every drawer in the product depend on the attendance
// feature.
//
// So they are shared UI, and they now live with the shared UI. Nothing
// about the markup or the class strings changed - the visual design is
// locked, and this is a move, not a restyle.

/**
 * One drawer chrome for every right-side workflow in the Attendance
 * workspace — attendance actions here, substitute workflows in the Substitute
 * tab. Opens from the right over a soft backdrop with the schedule still
 * visible behind it; closes on the close button, backdrop click and Escape
 * (the last two are Radix-native). The AppShell and sidebar never move.
 */
export function DrawerShell({ open, onOpenChange, title, contextLine, description, width = 'sm:w-[540px]', children }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-overlay/20 animate-fadeUp motion-reduce:animate-none" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 right-0 z-[121] w-full flex flex-col bg-raised border-l border-line-strong rounded-l-[20px] shadow-dialog outline-none overflow-hidden',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 data-[state=open]:fade-in duration-200 ease-out motion-reduce:animate-none',
            width,
          )}
        >
          {/* Compact context header — one line of context, never a title block plus a paragraph. */}
          <div className="flex-none flex items-start justify-between gap-[12px] pt-[15px] px-[18px] pb-[12px] border-b border-line">
            <div className="min-w-0">
              <Dialog.Title className="m-0 text-[14.5px] font-[600] tracking-[-.01em] text-ink truncate">
                {title}
              </Dialog.Title>
              {contextLine && (
                <div className="mt-[3px] text-[11.5px] text-ink-muted truncate tabular-nums" title={contextLine}>
                  {contextLine}
                </div>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                title="Close"
                className="flex-none w-[30px] h-[30px] grid place-items-center border-0 bg-transparent rounded-[9px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent"
              >
                <X size={17} strokeWidth={1.9} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{description || title}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Sticky bottom action rail — the drawer's only place for commit actions. */
export function DrawerRail({ children, meta }) {
  return (
    <div className="flex-none flex items-center gap-[10px] px-[18px] py-[11px] border-t border-line bg-surface">
      <div className="min-w-0 flex-1">{meta}</div>
      {children}
    </div>
  );
}

export const PRIMARY_BTN =
  'flex-none h-[34px] px-[15px] border-0 rounded-[10px] bg-accent text-white font-sans text-[12.5px] font-[500] cursor-pointer transition-colors duration-200 hover:bg-accent-hover active:bg-accent-press';
export const GHOST_BTN =
  'flex-none h-[34px] px-[13px] border border-line rounded-[10px] bg-paper font-sans text-[12.5px] font-[500] text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-tint2';
