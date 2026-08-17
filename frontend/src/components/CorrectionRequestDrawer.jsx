import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Search, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { PresentAbsentPill } from './PresentAbsentPill';
import { AutosaveStatus, DraftRestoredNote } from './AutosaveStatus';
import { useAutosave, useRestoredDraft } from '../hooks/useAutosave';
import { draftKey } from '../lib/draftStore';
import { ME } from '../lib/substituteData';

const schema = z.object({
  reason: z.string().trim().min(8, 'Explain the reason for this correction (at least 8 characters).'),
});

/** Right drawer — the only path to change locked attendance (§6B). Never applies instantly. */
export function CorrectionRequestDrawer({ open, onOpenChange, period, session, onSubmit }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState({}); // studentId -> requestedPresent

  const {
    register, handleSubmit, reset, watch, setValue, formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { reason: '' } });

  /**
   * A correction request is real work: the affected students and the written
   * reason are autosaved locally while it is being composed, so an accidental
   * close doesn't mean re-picking students and rewriting the explanation.
   * Sending it stays an explicit action, and the draft is cleared only then.
   */
  const key = draftKey(ME.id, 'correction', period.id);
  const restored = useRestoredDraft(key, open);
  const reason = watch('reason');
  const autosave = useAutosave({
    value: { reason, selected },
    storageKey: key,
    keepLocalDraft: true, // an unsent request has no other home
    onSave: () => {},
  });
  const seeded = useRef(false);
  const [usedDraft, setUsedDraft] = useState(false);

  useEffect(() => {
    if (!open) { seeded.current = false; setUsedDraft(false); return; }
    if (seeded.current) return;
    seeded.current = true;
    const d = restored?.value;
    if (d && (d.reason || Object.keys(d.selected ?? {}).length)) {
      setValue('reason', d.reason ?? '');
      setSelected(d.selected ?? {});
      setUsedDraft(true);
    }
  }, [open, restored, setValue]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return period.students;
    return period.students.filter((s) => s.name.toLowerCase().includes(term) || s.roll.includes(term));
  }, [period.students, query]);

  const toggleSelect = (studentId, existingPresent) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (studentId in next) delete next[studentId];
      else next[studentId] = !existingPresent;
      return next;
    });
    autosave.schedule();
  };

  const toggleRequestedValue = (studentId) => {
    setSelected((prev) => ({ ...prev, [studentId]: !prev[studentId] }));
    autosave.schedule();
  };

  const selectedCount = Object.keys(selected).length;

  // Closing by any route — Escape, backdrop, the close button — flushes the
  // pending autosave first, and deliberately does *not* wipe the local draft:
  // reopening this period's correction restores it.
  const close = (v, { keepDraft = true } = {}) => {
    if (!v) {
      autosave.flush();
      if (!keepDraft) autosave.markClean();
    }
    onOpenChange(v);
    if (!v) {
      reset();
      setSelected({});
      setQuery('');
    }
  };

  const submit = (values) => {
    const items = Object.entries(selected).map(([studentId, requestedPresent]) => ({
      studentId,
      existingPresent: session.presentIds.has(studentId),
      requestedPresent,
    }));
    onSubmit({ reason: values.reason, items });
    close(false, { keepDraft: false }); // sent — the draft has been taken
  };

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-overlay/20 animate-fadeUp" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-[121] w-full sm:w-[440px] flex flex-col bg-raised border-l border-line-strong rounded-l-[20px] shadow-dialog outline-none overflow-hidden data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 data-[state=open]:fade-in duration-200 ease-out motion-reduce:animate-none">
          <div className="flex items-start justify-between gap-[12px] pt-[18px] px-[18px] pb-[14px] border-b border-line">
            <div className="min-w-0">
              <Dialog.Title className="m-0 text-[16px] font-[600] tracking-[-.01em]">Request a correction</Dialog.Title>
              <Dialog.Description className="mt-[2px] text-[12px] text-ink-faint">
                {period.subject} · {period.code} — changes require Class Tutor approval.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close correction request"
                className="flex-none w-[30px] h-[30px] grid place-items-center border-0 bg-transparent rounded-[9px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent"
              >
                <X size={17} strokeWidth={1.9} />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit(submit)} className="flex-1 min-h-0 flex flex-col">
            <div className="px-[18px] pt-[14px]">
              <label className="block text-[11.5px] font-[500] uppercase tracking-[.05em] text-ink-faint mb-[8px]">
                Select affected students
              </label>
              <div className="relative mb-[10px]">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name or roll number…"
                  aria-label="Search students"
                  className="w-full h-[34px] pl-[32px] pr-[10px] border border-line rounded-[10px] bg-paper font-sans text-[12.5px] text-ink outline-none focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
                />
                <span className="absolute left-[10px] top-0 bottom-0 flex items-center text-ink-ghost pointer-events-none">
                  <Search size={13} strokeWidth={1.9} />
                </span>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px]">
              {filtered.map((s) => {
                const isSelected = s.id in selected;
                const existingPresent = session.presentIds.has(s.id);
                return (
                  <div
                    key={s.id}
                    className={cn(
                      'flex items-center gap-[10px] py-[8px] border-t border-line-light first:border-t-0',
                      isSelected && 'bg-accent-soft/40 -mx-[8px] px-[8px] rounded-[8px]'
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Include ${s.name} in this correction`}
                      checked={isSelected}
                      onChange={() => toggleSelect(s.id, existingPresent)}
                      className="w-[16px] h-[16px] accent-accent"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-[500] text-ink truncate">{s.name}</div>
                      <div className="text-[10.5px] text-ink-faint">Roll {s.roll} · recorded {existingPresent ? 'Present' : 'Absent'}</div>
                    </div>
                    {isSelected && (
                      <PresentAbsentPill size="sm" present={selected[s.id]} onToggle={() => toggleRequestedValue(s.id)} />
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <p className="py-[16px] text-[12px] text-ink-faint text-center">No students found for “{query}”.</p>
              )}
            </div>

            <div className="px-[18px] pt-[12px] pb-[18px] border-t border-line bg-surface">
              <label htmlFor="correction-reason" className="block text-[11.5px] font-[500] uppercase tracking-[.05em] text-ink-faint mb-[6px]">
                Reason (required)
              </label>
              <textarea
                id="correction-reason"
                {...register('reason', { onChange: () => { setUsedDraft(false); autosave.schedule(); } })}
                placeholder="Explain what was recorded incorrectly and why…"
                className="w-full min-h-[74px] px-[12px] py-[9px] border border-line rounded-[10px] bg-paper font-sans text-[12.5px] leading-[1.5] text-ink outline-none resize-none focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
              />
              {errors.reason && <p className="mt-[5px] text-[11px] text-danger">{errors.reason.message}</p>}

              <div className="flex items-center justify-between mt-[14px]">
                <span className="flex items-center gap-[7px] text-[11.5px] text-ink-faint">
                  {selectedCount} student{selectedCount === 1 ? '' : 's'} selected
                  {usedDraft
                    ? <DraftRestoredNote show />
                    : <AutosaveStatus status={autosave.status} onRetry={autosave.retry} />}
                </span>
                <button
                  type="submit"
                  disabled={selectedCount === 0}
                  className={cn(
                    'h-[34px] px-[16px] border-0 rounded-[10px] font-sans text-[13px] font-[500]',
                    selectedCount === 0 ? 'bg-frame text-ink-disabled cursor-not-allowed' : 'bg-accent text-white cursor-pointer hover:bg-accent-hover'
                  )}
                >
                  Submit request
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
