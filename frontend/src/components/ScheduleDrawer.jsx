import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { SCHEDULE } from '../lib/mockData';
import { useWorkspace } from '../store/WorkspaceProvider';

export function ScheduleDrawer() {
  const { scheduleOpen, setScheduleOpen } = useWorkspace();
  return (
    <Dialog.Root open={scheduleOpen} onOpenChange={setScheduleOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-overlay/15 animate-fadeUp" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-[71] w-[360px] max-w-[90vw] bg-paper border-l border-line-strong rounded-l-[20px] shadow-dialog pt-[22px] px-[22px] pb-[18px] overflow-y-auto scroll-quiet outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 data-[state=open]:fade-in duration-200 ease-out motion-reduce:animate-none">
          <div className="flex items-center justify-between">
            <Dialog.Title className="m-0 text-[17px] font-[600]">Today’s schedule</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close schedule"
                className="w-[28px] h-[28px] grid place-items-center border-0 bg-transparent rounded-[8px] text-ink-faint cursor-pointer hover:bg-accent-soft"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-[4px] mb-[18px] text-[12.5px] text-ink-faint">
            Tuesday, 11 August · 5 sessions
          </Dialog.Description>
          {SCHEDULE.map((s) => (
            <div key={s.time} className="flex gap-[14px] py-[11px] border-t border-line-lighter">
              <span className="shrink-0 w-[64px] text-[12.5px] font-[500] text-accent">{s.time}</span>
              <span className="block flex-1 min-w-0">
                <span className="block text-[13px] font-[500]">{s.title}</span>
                <span className="block mt-[2px] text-[12px] text-ink-faint">{s.meta}</span>
              </span>
            </div>
          ))}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
