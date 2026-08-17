import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { cn } from '../lib/utils';

/**
 * A decision whose consequences have to be read before it is taken.
 *
 * **Not a warning, and deliberately not styled as one.** There is nothing
 * dangerous about commencing a semester — it is an ordinary act an institution
 * performs twice a year. What makes it need a dialog is that it changes several
 * things at once, in other people's workspaces, and the person taking it should
 * be able to see all of them in one place first. So the consequences are
 * enumerated in the order they occur, in plain statements of what the product
 * does, with no red, no siren and no "are you sure". A confirmation that
 * editorialises about risk teaches somebody to click through it.
 *
 * **The consequences are data, not copy.** They arrive from the module that owns
 * the transition, so what the dialog states beforehand and what the page
 * explains afterwards are the same eight facts rather than two lists that drift.
 *
 * An `AlertDialog` rather than a `Dialog`: this is a decision that has to be
 * answered rather than a panel that can be dismissed by clicking away, which is
 * exactly the distinction Radix draws between the two.
 */

const overlay = 'fixed inset-0 z-[80] bg-overlay/20 animate-fadeUp';
const panel =
  'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[81] w-[calc(100%-48px)] max-w-[560px] bg-raised border border-line-strong rounded-[16px] shadow-dialog animate-fadeUp outline-none overflow-hidden';
const ghostBtn =
  'h-[34px] px-[15px] border border-line rounded-[10px] bg-paper font-sans text-[13px] text-ink-muted cursor-pointer hover:bg-tint2';
const primaryBtn =
  'h-[34px] px-[16px] border-0 rounded-[10px] bg-accent font-sans text-[13px] font-[500] text-white cursor-pointer hover:bg-accent-hover';

export function ConfirmConsequenceDialog({
  open,
  onOpenChange,
  title,
  lede,
  consequences = [],
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  footnote,
  onConfirm,
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlay} />
        <AlertDialog.Content className={panel}>
          <div className="px-[24px] pt-[22px] pb-[14px]">
            <AlertDialog.Title className="m-0 text-[19px] font-[600] tracking-[-.01em] text-ink">
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-[6px] mb-0 text-[13px] text-ink-muted">
              {lede}
            </AlertDialog.Description>
          </div>

          {/*
            Numbered, because the order is the explanation: the band changes, so
            the classes change, so the seats change, and everything below follows
            from that. A bulleted list would present eight unrelated warnings.
          */}
          <ol className="m-0 px-[24px] pb-[4px] list-none max-h-[46vh] overflow-y-auto scroll-quiet">
            {consequences.map((c, i) => (
              <li
                key={c.key}
                className="grid grid-cols-[22px_1fr] gap-x-[10px] py-[9px] border-t border-line-light first:border-t-0"
              >
                <span
                  aria-hidden="true"
                  className="mt-[1px] h-[20px] w-[20px] grid place-items-center rounded-full bg-tint2 text-[11px] font-[500] tabular-nums text-ink-muted"
                >
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-[500] text-ink">{c.title}</span>
                  <span className="block mt-[2px] text-[12px] text-ink-muted">{c.detail}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-[10px] px-[24px] py-[16px] mt-[6px] border-t border-line bg-tint">
            {footnote && (
              <span className="min-w-0 flex-1 text-[11.5px] text-ink-faint">{footnote}</span>
            )}
            <div className={cn('flex gap-[10px]', footnote ? 'flex-none' : 'flex-1 justify-end')}>
              <AlertDialog.Cancel asChild>
                <button type="button" className={ghostBtn}>
                  {cancelLabel}
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button type="button" className={primaryBtn} onClick={onConfirm}>
                  {confirmLabel}
                </button>
              </AlertDialog.Action>
            </div>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
