import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Dialog from '@radix-ui/react-dialog';
import { FileText, Lock, Paperclip, Pencil, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { AddTextDialog, InstructionsDialog } from './Dialogs';
import { useWorkspace } from '@/store/WorkspaceProvider';

/** Instructions · Memory · Context. Compact sections, never large cards — the
 *  single bounded panel supplies the container hierarchy. */
function ProjectContextBody() {
  const { instructions, setInstructions, contextFiles, addContextFile, removeContextFile } = useWorkspace();
  const [instrOpen, setInstrOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-[500]">Instructions</span>
        <button
          type="button"
          aria-label="Edit instructions"
          onClick={() => setInstrOpen(true)}
          className="w-[26px] h-[26px] grid place-items-center border-0 bg-transparent rounded-[7px] text-ink-faint cursor-pointer hover:bg-accent-soft hover:text-accent"
        >
          <Pencil size={15} strokeWidth={1.9} />
        </button>
      </div>
      <p className="mt-[4px] mb-[18px] text-[12.5px] leading-[1.55] text-ink-faint">
        {instructions || 'Add instructions to tailor ArcNave’s responses for this project.'}
      </p>

      <div className="pt-[16px] border-t border-line-light">
        <div className="flex items-center gap-[7px]">
          <span className="text-[13px] font-[500]">Memory</span>
          <span className="inline-flex items-center gap-[4px] text-[11px] text-ink-faint">
            <Lock size={12} strokeWidth={2} />
            Only you
          </span>
        </div>
        <p className="mt-[4px] mb-0 text-[12.5px] leading-[1.55] text-ink-faint">
          Project memory will appear here after a few conversations.
        </p>
      </div>

      <div className="mt-[18px] pt-[16px] border-t border-line-light">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-[500]">Context</span>
          <Popover.Root>
            <Popover.Trigger asChild>
              <button
                type="button"
                aria-label="Add context"
                className="w-[26px] h-[26px] grid place-items-center border-0 bg-transparent rounded-[7px] text-ink-faint cursor-pointer hover:bg-accent-soft hover:text-accent"
              >
                <Plus size={15} strokeWidth={2} />
              </button>
            </Popover.Trigger>
            {/* Portalled so the panel can never clip it. */}
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={4}
                className="z-[70] w-[196px] p-[5px] bg-raised border border-line-strong rounded-[12px] shadow-pop data-[state=open]:animate-fadeUp motion-reduce:animate-none"
              >
                <button
                  type="button"
                  onClick={() => toast('File upload is not available in this preview')}
                  className="flex items-center gap-[9px] w-full h-[32px] px-[9px] border-0 bg-transparent rounded-[8px] font-sans text-[12.5px] text-ink cursor-pointer hover:bg-tint2"
                >
                  <Paperclip size={15} strokeWidth={1.8} />
                  Upload from device
                </button>
                <Popover.Close asChild>
                  <button
                    type="button"
                    onClick={() => setTextOpen(true)}
                    className="flex items-center gap-[9px] w-full h-[32px] px-[9px] border-0 bg-transparent rounded-[8px] font-sans text-[12.5px] text-ink cursor-pointer hover:bg-tint2"
                  >
                    <FileText size={15} strokeWidth={1.8} />
                    Add text content
                  </button>
                </Popover.Close>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>

        {contextFiles.length ? (
          <div className="flex flex-col gap-[1px] mt-[6px] pb-[6px]">
            {contextFiles.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-[9px] py-[6px] px-[7px] rounded-[8px] hover:bg-tint2 focus-within:bg-tint2"
              >
                <FileText size={15} strokeWidth={1.7} className="text-ink-faint shrink-0" />
                <span className="flex-1 min-w-0 block">
                  <span className="block text-[12.2px] truncate">{f.name}</span>
                  <span className="block text-[11px] text-ink-faint">{f.meta}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => removeContextFile(f.id)}
                  className="w-[22px] h-[22px] grid place-items-center border-0 bg-transparent rounded-[6px] text-ink-faint cursor-pointer shrink-0 hover:bg-accent-soft hover:text-danger"
                >
                  <X size={13} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-[4px] mb-0 text-[12.5px] leading-[1.55] text-ink-faint">
            Add PDFs, documents, spreadsheets, or reference material for this project.
          </p>
        )}
      </div>

      <InstructionsDialog
        open={instrOpen}
        onOpenChange={setInstrOpen}
        defaultValue={instructions}
        onSave={(value) => {
          setInstructions(value);
          setInstrOpen(false);
          toast('Instructions saved');
        }}
      />
      <AddTextDialog
        open={textOpen}
        onOpenChange={setTextOpen}
        onAdd={({ title, body }) => {
          addContextFile({
            id: 'f' + Date.now(),
            name: (title?.trim() || 'Untitled note') + '.txt',
            meta: 'Text · ' + Math.max(1, Math.round((body?.length || 0) / 1024)) + ' KB',
          });
          setTextOpen(false);
          toast('Added to project context');
        }}
      />
    </>
  );
}

/** Desktop/tablet: one bounded, independent workspace surface — never flush
 *  with the viewport edge, corners always visible. */
export function ProjectContextPanel() {
  return (
    <aside className="hidden md:flex self-start w-[296px] shrink-0 pt-[16px] pr-[16px]">
      <div className="w-full h-fit max-h-[calc(100dvh-96px)] flex flex-col overflow-hidden rounded-[20px] border border-line bg-paper shadow-shell">
        <div className="min-h-0 overflow-y-auto scroll-quiet px-[18px] pt-[18px] pb-[24px]">
          <ProjectContextBody />
        </div>
      </div>
    </aside>
  );
}

/** Narrow screens: the same panel content as a right-side overlay drawer. */
export function ProjectContextDrawer({ open, onOpenChange }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="md:hidden fixed inset-0 z-[120] bg-overlay/20 animate-fadeUp" />
        <Dialog.Content className="md:hidden fixed inset-y-0 right-0 z-[121] w-full sm:w-[360px] flex flex-col bg-paper border-l border-line-strong rounded-l-[20px] shadow-dialog outline-none overflow-hidden data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 data-[state=open]:fade-in duration-200 ease-out motion-reduce:animate-none">
          <div className="shrink-0 flex items-center justify-between pt-[16px] px-[18px] pb-[12px] border-b border-line-light">
            <Dialog.Title className="m-0 text-[15px] font-[600] tracking-[-.01em]">Project context</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close project context"
                title="Close"
                className="w-[28px] h-[28px] grid place-items-center border-0 bg-transparent rounded-[8px] text-ink-faint cursor-pointer hover:bg-accent-soft hover:text-accent"
              >
                <X size={16} strokeWidth={1.9} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Instructions, memory and reference material for this project.
          </Dialog.Description>
          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] pt-[16px] pb-[22px]">
            <ProjectContextBody />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
