import { useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Building2, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { institutionSummary, isRangeOrdered } from '../lib/profileData';
import { CheckboxField, Field, MonthField, PROFILE_CONTROL } from './ProfileFields';

/**
 * The previous-institution list: staff-owned, repeatable, and never a fixed
 * number of rows.
 *
 * Read mode keeps each entry to a single line (`Institution · Designation ·
 * From–To`) so a long career doesn't turn the profile into a wall of cards.
 * Edit mode expands exactly one entry at a time — the rest stay collapsed as
 * the same one-liners, so it is always obvious which record is being changed.
 *
 * Removal is the only destructive action here, so it is the only one that
 * confirms. Adding, editing and collapsing are all reversible and stay quiet.
 */

let seq = 0;
const newEntry = () => ({
  id: `pi-new-${Date.now()}-${(seq += 1)}`,
  institutionName: '',
  designationHeld: '',
  from: '',
  to: '',
});

export function entryErrors(entry) {
  const errors = {};
  if (!entry.institutionName.trim()) errors.institutionName = 'Institution name is required.';
  if (!isRangeOrdered(entry.from, entry.to)) errors.to = '“To” cannot be before “From”.';
  return errors;
}

export function PreviousInstitutions({ entries, editing, onChange }) {
  const [openId, setOpenId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const patch = (id, changes) => onChange(entries.map((e) => (e.id === id ? { ...e, ...changes } : e)));

  const add = () => {
    const entry = newEntry();
    onChange([...entries, entry]);
    setOpenId(entry.id);
  };

  const remove = (id) => {
    onChange(entries.filter((e) => e.id !== id));
    if (openId === id) setOpenId(null);
    setConfirmId(null);
  };

  const pending = entries.find((e) => e.id === confirmId);

  if (!editing) {
    if (entries.length === 0) {
      return <p className="m-0 text-[13px] font-[400] text-ink-faint">No previous institutions recorded.</p>;
    }
    return (
      <ul className="m-0 p-0 list-none flex flex-col">
        {entries.map((e) => (
          <li
            key={e.id}
            className="flex items-center gap-[9px] py-[8px] border-t border-line-light first:border-t-0 first:pt-0"
          >
            <Building2 size={14} strokeWidth={1.8} className="flex-none text-ink-faint" aria-hidden="true" />
            <span className="text-[13px] font-[400] text-ink">{institutionSummary(e)}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      <ul className="m-0 p-0 list-none flex flex-col gap-[6px]">
        {entries.map((entry) => {
          const open = openId === entry.id;
          const errors = entryErrors(entry);
          const hasError = Object.keys(errors).length > 0;
          return (
            <li
              key={entry.id}
              className={cn(
                'border rounded-[11px] overflow-hidden transition-colors duration-200',
                open ? 'border-accent-line bg-tint' : 'border-line bg-paper',
                !open && hasError && 'border-danger/40',
              )}
            >
              <div className="flex items-center gap-[8px] pl-[11px] pr-[6px] h-[40px]">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : entry.id)}
                  className="flex-1 min-w-0 flex items-center gap-[8px] h-full border-0 bg-transparent p-0 font-sans text-left cursor-pointer"
                >
                  <ChevronDown
                    size={14}
                    strokeWidth={2}
                    aria-hidden="true"
                    className={cn('flex-none text-ink-faint transition-transform duration-200', open && 'rotate-180')}
                  />
                  <span className="truncate text-[13px] font-[400] text-ink">
                    {entry.institutionName.trim() ? institutionSummary(entry) : 'New institution'}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${entry.institutionName.trim() || 'this institution'}`}
                  title="Remove"
                  onClick={() => setConfirmId(entry.id)}
                  className="flex-none w-[30px] h-[30px] grid place-items-center rounded-[8px] border-0 bg-transparent text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-danger-soft hover:text-danger"
                >
                  <Trash2 size={15} strokeWidth={1.8} />
                </button>
              </div>

              {open && (
                <div className="px-[11px] pb-[12px] pt-[2px] grid gap-x-[14px] gap-y-[12px] sm:grid-cols-2">
                  <Field label="Institution name" required error={errors.institutionName}>
                    {(id) => (
                      <input
                        id={id}
                        value={entry.institutionName}
                        onChange={(e) => patch(entry.id, { institutionName: e.target.value })}
                        placeholder="Name of the institution"
                        className={PROFILE_CONTROL}
                      />
                    )}
                  </Field>
                  <Field label="Designation held">
                    {(id) => (
                      <input
                        id={id}
                        value={entry.designationHeld}
                        onChange={(e) => patch(entry.id, { designationHeld: e.target.value })}
                        placeholder="e.g. Assistant Professor"
                        className={PROFILE_CONTROL}
                      />
                    )}
                  </Field>
                  <Field label="From">
                    {(id) => (
                      <MonthField
                        id={id}
                        ariaLabel="From month and year"
                        value={entry.from}
                        onChange={(v) => patch(entry.id, { from: v })}
                      />
                    )}
                  </Field>
                  <Field label="To" error={errors.to}>
                    {(id) => (
                      <MonthField
                        id={id}
                        ariaLabel="To month and year"
                        value={entry.to}
                        onChange={(v) => patch(entry.id, { to: v })}
                      />
                    )}
                  </Field>
                  <div className="sm:col-span-2">
                    <CheckboxField
                      checked={!entry.to}
                      onChange={(checked) => patch(entry.id, { to: checked ? '' : entry.from || '' })}
                      label="I am still working here"
                      hint="Leaves the end date open — this entry reads as “Present”."
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={add}
        className="mt-[10px] inline-flex items-center gap-[6px] h-[34px] px-[12px] rounded-[9px] border border-line bg-paper font-sans text-[13px] font-[500] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink"
      >
        <Plus size={14} strokeWidth={2} aria-hidden="true" />
        Add institution
      </button>

      <AlertDialog.Root open={Boolean(pending)} onOpenChange={(v) => !v && setConfirmId(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[130] bg-overlay/20 animate-fadeUp" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[131] w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-line bg-paper p-[18px] shadow-dialog outline-none data-[state=open]:animate-fadeUp motion-reduce:animate-none">
            <AlertDialog.Title className="m-0 text-[15px] font-[600] text-ink">
              Remove this institution?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-[5px] text-[13px] font-[400] text-ink-muted">
              {pending ? institutionSummary(pending) || 'This entry' : ''} will be removed from your profile.
            </AlertDialog.Description>
            <div className="mt-[16px] flex justify-end gap-[8px]">
              <AlertDialog.Cancel asChild>
                <button
                  type="button"
                  className="h-[34px] px-[14px] rounded-[9px] border border-line bg-paper font-sans text-[13px] font-[500] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink"
                >
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  onClick={() => remove(confirmId)}
                  className="h-[34px] px-[14px] rounded-[9px] border-0 bg-danger font-sans text-[13px] font-[500] text-white cursor-pointer transition-colors duration-200 hover:bg-danger-hover"
                >
                  Remove
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
