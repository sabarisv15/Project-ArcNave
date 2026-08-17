import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { CopyButton } from './ui/CopyButton';
import { cn } from '../lib/utils';
import { initials } from '../lib/staffData';

function Stat({ label, value, tone }) {
  return (
    <div className="bg-surface border border-line rounded-[14px] py-[12px] px-[14px]">
      <div className="text-[9.5px] tracking-[.06em] uppercase text-ink-faint mb-[4px]">{label}</div>
      <div className={cn('text-[15px] font-[600]', tone)}>{value}</div>
    </div>
  );
}

/** Right-side staff sheet — 452px desktop, near-full width on mobile. */
export function StaffDetailDrawer({ s }) {
  const p = s.detailStaff;

  return (
    <Dialog.Root open={!!p} onOpenChange={(open) => !open && s.closeDetail()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-overlay/20 animate-fadeUp" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-[121] w-full sm:w-[452px] flex flex-col bg-raised border-l border-line-strong rounded-l-[22px] shadow-dialog outline-none overflow-hidden data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 data-[state=open]:fade-in duration-200 ease-out motion-reduce:animate-none">
          {p && (
            <>
              <div className="flex items-start justify-between gap-[12px] pt-[18px] px-[18px] pb-[14px] border-b border-line">
                <div className="flex items-center gap-[12px] min-w-0">
                  <span className="flex-none w-[40px] h-[40px] grid place-items-center rounded-full bg-accent-soft text-accent text-[14px] font-[600]">
                    {initials(p.name)}
                  </span>
                  <div className="min-w-0">
                    <Dialog.Title className="m-0 text-[17px] font-[600] tracking-[-.01em] truncate">{p.name}</Dialog.Title>
                    <div className="mt-[2px] text-[11.5px] tabular-nums text-ink-faint">{p.employeeId}</div>
                  </div>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Close staff detail"
                    title="Close"
                    className="flex-none w-[30px] h-[30px] grid place-items-center border-0 bg-transparent rounded-[9px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent"
                  >
                    <X size={17} strokeWidth={1.9} />
                  </button>
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">
                Designation, department, contact and email detail for {p.name}.
              </Dialog.Description>

              <div className="flex-1 overflow-y-auto scroll-quiet pt-[16px] px-[18px] pb-[22px]">
                <div className="text-[13.5px] font-[500] text-ink">{p.designation}</div>
                <div className="mt-[2px] text-[12px] text-ink-faint">{p.department}</div>

                <div className="grid grid-cols-1 gap-[10px] mt-[16px]">
                  <Stat label="Employment type" value={p.employmentType} />
                </div>

                <div className="mt-[16px] bg-surface border border-line rounded-[14px] py-[12px] px-[14px]">
                  <div className="text-[9.5px] tracking-[.06em] uppercase text-ink-faint mb-[8px]">Contact</div>
                  <div className="text-[13px] text-ink tabular-nums">{p.phone}</div>
                  <div className="h-px bg-line-light my-[10px]" />
                  <div className="text-[9.5px] tracking-[.06em] uppercase text-ink-faint mb-[8px]">Email</div>
                  <div className="flex items-center justify-between gap-[12px] text-[13px]">
                    <a
                      href={`mailto:${p.email}`}
                      title={p.email}
                      className="text-ink truncate hover:text-accent hover:underline"
                    >
                      {p.email}
                    </a>
                    <CopyButton
                      getText={() => p.email}
                      label={`Copy email address ${p.email}`}
                      size={13}
                      className="flex-none w-[26px] h-[26px] grid place-items-center border-0 bg-transparent rounded-[8px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                    />
                  </div>
                </div>

                <div className="mt-[16px] bg-surface border border-line rounded-[14px] py-[12px] px-[14px]">
                  <div className="text-[9.5px] tracking-[.06em] uppercase text-ink-faint mb-[6px]">Last updated</div>
                  <div className="text-[12.5px] text-ink-soft">{p.updated}</div>
                </div>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
