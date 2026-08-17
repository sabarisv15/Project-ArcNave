import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '../lib/utils';
import { AutosaveStatus, DraftRestoredNote } from './AutosaveStatus';
import { useAutosave, useRestoredDraft } from '../hooks/useAutosave';
import { draftKey } from '../lib/draftStore';
import { ME } from '../lib/documentsData';

const FIELD =
  'w-full h-[36px] px-[11px] border border-line rounded-[10px] bg-paper font-sans text-[13px] text-ink outline-none transition-colors duration-200 focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]';

/**
 * Rename an item, or name a new folder — one dialog, because they are the same
 * single-field decision.
 *
 * Even this small a form autosaves its draft locally: closing it by accident
 * (Escape, backdrop, a stray click) and reopening restores what was typed, with
 * one quiet "Draft restored" line. The *name change itself* is still an
 * explicit confirm — autosave protects the typing, never commits the action.
 */
export function RenameNodeDialog({ open, node, mode = 'rename', folderId, onClose, onSubmit }) {
  const creating = mode === 'create';
  const key = draftKey(ME.id, creating ? 'new-folder' : 'rename', creating ? folderId ?? 'root' : node?.id ?? 'none');
  const restored = useRestoredDraft(key, open);

  const [name, setName] = useState('');
  const [seeded, setSeeded] = useState(false);
  const inputRef = useRef(null);

  const autosave = useAutosave({
    value: name,
    storageKey: key,
    keepLocalDraft: true, // an unconfirmed name lives only here
    // The draft *is* the local mirror for this form; there is no server-side
    // draft for an unconfirmed name, so the save is a no-op that still drives
    // the same quiet status language as every other form.
    onSave: () => {},
  });

  useEffect(() => {
    if (!open) { setSeeded(false); return; }
    if (seeded) return;
    const initial = restored?.value ?? (creating ? '' : node?.name ?? '');
    setName(initial);
    setSeeded(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open, seeded, restored, creating, node]);

  const usedDraft = !!restored?.value && restored.value !== (creating ? '' : node?.name);
  const clean = name.trim();
  const valid = clean.length > 0 && (creating || clean !== node?.name);

  const commit = () => {
    if (!valid) return;
    autosave.markClean(); // the draft has been taken by an explicit action
    onSubmit(clean);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (v) return;
        autosave.flush(); // an accidental close still keeps the typing
        onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[130] bg-overlay/20 animate-fadeUp" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[131] w-[calc(100%-48px)] max-w-[380px] bg-raised border border-line-strong rounded-[16px] p-[20px] shadow-dialog outline-none animate-fadeUp">
          <Dialog.Title className="m-0 mb-[10px] text-[15.5px] font-[600]">
            {creating ? 'New folder' : `Rename “${node?.name}”`}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            {creating ? 'Name the new folder' : 'Enter a new name for this item'}
          </Dialog.Description>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => { setName(e.target.value); autosave.schedule(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
            placeholder={creating ? 'Folder name' : 'New name'}
            aria-label={creating ? 'Folder name' : 'New name'}
            className={FIELD}
          />
          <div className="flex items-center gap-[10px] mt-[14px]">
            <span className="min-w-0 flex-1">
              {usedDraft ? <DraftRestoredNote show /> : <AutosaveStatus status={autosave.status} onRetry={autosave.retry} />}
            </span>
            <Dialog.Close asChild>
              <button type="button" className="h-[32px] px-[14px] border border-line rounded-[10px] bg-paper font-sans text-[12.5px] font-[500] text-ink-muted cursor-pointer hover:bg-tint2">
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={commit}
              disabled={!valid}
              className={cn(
                'h-[32px] px-[14px] border-0 rounded-[10px] font-sans text-[12.5px] font-[500]',
                valid ? 'bg-accent text-white cursor-pointer hover:bg-accent-hover' : 'bg-frame text-ink-disabled cursor-not-allowed'
              )}
            >
              {creating ? 'Create folder' : 'Rename'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
