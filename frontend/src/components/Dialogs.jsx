import * as Dialog from '@radix-ui/react-dialog';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Label from '@radix-ui/react-label';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

const overlay = 'fixed inset-0 z-[80] bg-overlay/20 animate-fadeUp';
const panel =
  'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[81] w-[calc(100%-48px)] bg-raised border border-line-strong rounded-[16px] p-[24px] shadow-dialog animate-fadeUp outline-none';
const field =
  'w-full h-[38px] px-[12px] border border-line rounded-[10px] font-sans text-[13.5px] text-ink outline-none';
const area =
  'w-full px-[12px] py-[10px] border border-line rounded-[10px] font-sans text-[13.5px] leading-[1.55] text-ink outline-none resize-none';
const ghostBtn =
  'h-[34px] px-[15px] border border-line rounded-[10px] bg-paper font-sans text-[13px] text-ink-muted cursor-pointer hover:bg-tint2';

function PrimaryBtn({ disabled, children, ...props }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={cn(
        'h-[34px] px-[16px] border-0 rounded-[10px] font-sans text-[13px] font-[500]',
        disabled ? 'bg-frame text-ink-disabled cursor-not-allowed' : 'bg-accent text-white cursor-pointer hover:bg-accent-hover'
      )}
      {...props}
    >
      {children}
    </button>
  );
}

const projectSchema = z.object({
  name: z.string().regex(/[a-zA-Z0-9]/, 'A project name is required'),
  goal: z.string().optional(),
});

export function NewProjectDialog({ open, onOpenChange, onCreate }) {
  const { register, handleSubmit, watch, reset } = useForm({
    resolver: zodResolver(projectSchema),
    defaultValues: { name: '', goal: '' },
    mode: 'onChange',
  });
  const valid = /[a-zA-Z0-9]/.test(watch('name') || '');

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={cn(panel, 'max-w-[520px]')}>
          <Dialog.Title className="m-0 mb-[18px] text-[19px] font-[600]">Create a project</Dialog.Title>
          <Dialog.Description className="sr-only">Create a new ArcNave project</Dialog.Description>
          <form
            onSubmit={handleSubmit((values) => {
              onCreate(values);
              reset();
            })}
          >
            <Label.Root className="block text-[12.5px] font-[500] mb-[6px]">What are you working on?</Label.Root>
            <input {...register('name')} placeholder="Name your project" className={cn(field, 'mb-[16px]')} />

            <Label.Root className="block text-[12.5px] font-[500] mb-[6px]">What are you trying to achieve?</Label.Root>
            <textarea
              {...register('goal')}
              placeholder="Describe the project goal, academic area, outcomes, and any important context…"
              className={cn(area, 'min-h-[92px]')}
            />

            <button
              type="button"
              onClick={() => toast('File selection is not available in this preview')}
              className="mt-[12px] flex items-center gap-[8px] h-[32px] px-[12px] border border-dashed border-line-strong rounded-[9px] bg-transparent font-sans text-[12.5px] text-ink-muted cursor-pointer hover:border-accent-line hover:text-accent"
            >
              <Plus size={14} strokeWidth={1.9} />
              Add files or a folder
            </button>

            <div className="flex justify-end gap-[10px] mt-[22px]">
              <Dialog.Close asChild>
                <button type="button" className={ghostBtn}>
                  Cancel
                </button>
              </Dialog.Close>
              <PrimaryBtn disabled={!valid}>Create project</PrimaryBtn>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const instructionsSchema = z.object({ instructions: z.string() });

export function InstructionsDialog({ open, onOpenChange, defaultValue, onSave }) {
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(instructionsSchema),
    values: { instructions: defaultValue || '' },
  });
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={cn(panel, 'max-w-[520px]')}>
          <Dialog.Title className="m-0 mb-[6px] text-[19px] font-[600]">Project instructions</Dialog.Title>
          <Dialog.Description className="m-0 mb-[14px] text-[12.8px] text-ink-faint">
            Tailor how ArcNave responds inside this project.
          </Dialog.Description>
          <form onSubmit={handleSubmit((v) => onSave(v.instructions))}>
            <textarea
              {...register('instructions')}
              placeholder="e.g. Always reference NAAC Criterion numbering and keep language suitable for the principal’s review."
              className={cn(area, 'min-h-[120px]')}
            />
            <div className="flex justify-end gap-[10px] mt-[20px]">
              <Dialog.Close asChild>
                <button type="button" className={ghostBtn}>
                  Cancel
                </button>
              </Dialog.Close>
              <PrimaryBtn>Save instructions</PrimaryBtn>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const textSchema = z.object({ title: z.string().optional(), body: z.string().optional() });

export function AddTextDialog({ open, onOpenChange, onAdd }) {
  const { register, handleSubmit, reset } = useForm({
    resolver: zodResolver(textSchema),
    defaultValues: { title: '', body: '' },
  });
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={cn(panel, 'max-w-[520px]')}>
          <Dialog.Title className="m-0 mb-[14px] text-[19px] font-[600]">Add text content</Dialog.Title>
          <Dialog.Description className="sr-only">Add reference text to the project context</Dialog.Description>
          <form
            onSubmit={handleSubmit((v) => {
              onAdd(v);
              reset();
            })}
          >
            <input {...register('title')} placeholder="Title" className={cn(field, 'mb-[12px]')} />
            <textarea
              {...register('body')}
              placeholder="Paste reference material, meeting notes, or policy text…"
              className={cn(area, 'min-h-[110px]')}
            />
            <div className="flex justify-end gap-[10px] mt-[20px]">
              <Dialog.Close asChild>
                <button type="button" className={ghostBtn}>
                  Cancel
                </button>
              </Dialog.Close>
              <PrimaryBtn>Add to context</PrimaryBtn>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DeleteProjectDialog({ open, onOpenChange, projectTitle, onConfirm }) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlay} />
        <AlertDialog.Content className={cn(panel, 'max-w-[420px] p-[22px]')}>
          <AlertDialog.Title className="m-0 mb-[8px] text-[17px] font-[600]">Delete this project?</AlertDialog.Title>
          <AlertDialog.Description className="m-0 mb-[20px] text-[13px] leading-[1.6] text-ink-muted">
            {projectTitle} and its conversations will be removed from your workspace. This cannot be undone.
          </AlertDialog.Description>
          <div className="flex justify-end gap-[10px]">
            <AlertDialog.Cancel asChild>
              <button type="button" className={ghostBtn}>
                Cancel
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                onClick={onConfirm}
                className="h-[34px] px-[16px] border-0 rounded-[10px] bg-danger text-white font-sans text-[13px] font-[500] cursor-pointer hover:bg-danger-hover"
              >
                Delete project
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
