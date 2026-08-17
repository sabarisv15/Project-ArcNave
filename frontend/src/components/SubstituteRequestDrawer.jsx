import { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { DrawerShell, DrawerRail, PRIMARY_BTN } from './AttendanceActionDrawer';
import { useAttendanceStore } from '../store/AttendanceProvider';
import {
  ME,
  dateFromDayKey,
  dayKeyOffset,
  eligibleStaffFor,
  myPeriodsOnDate,
  slotTimeRange,
} from '../lib/substituteData';
import { formatDayDateDMY } from '../lib/ist';
import { AutosaveStatus, DraftRestoredNote } from './AutosaveStatus';
import { useAutosave, useRestoredDraft } from '../hooks/useAutosave';
import { draftKey } from '../lib/draftStore';

const FIELD =
  'w-full h-[34px] font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[10px] outline-none transition-colors duration-200 focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]';

function FieldLabel({ children, hint }) {
  return (
    <div className="flex items-baseline gap-[6px] mb-[6px]">
      <span className="text-[10.5px] font-[500] uppercase tracking-[.06em] text-ink-faint">{children}</span>
      {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
    </div>
  );
}

/** Two-option segmented control — the request's scope and its recipient mode both use it. */
function Segmented({ value, onChange, options, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex items-center gap-[2px] p-[2px] bg-frame rounded-[10px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-[28px] px-[12px] border-0 rounded-[8px] font-sans text-[12px] cursor-pointer transition-colors duration-200',
            value === o.value ? 'bg-paper text-ink font-[600] shadow-seg' : 'bg-transparent text-ink-muted font-[500] hover:text-ink'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One of the staff member's own periods, as a selectable row. */
function PeriodRow({ slot, selected, onSelect, selectable }) {
  const Tag = selectable ? 'button' : 'div';
  return (
    <Tag
      {...(selectable ? { type: 'button', onClick: onSelect, 'aria-pressed': selected } : {})}
      className={cn(
        'w-full flex items-center gap-[10px] px-[11px] py-[8px] border rounded-[10px] text-left transition-colors duration-200',
        selectable && 'cursor-pointer',
        selected ? 'border-accent-line bg-accent-soft' : 'border-line bg-paper',
        selectable && !selected && 'hover:bg-tint2'
      )}
    >
      <span className="flex-none w-[52px] text-[11px] font-[500] text-ink-faint tabular-nums">P{slot.period}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-[500] text-ink truncate">{slot.subject}</span>
        <span className="block text-[11px] text-ink-faint truncate">
          {slot.code}
          {slot.batch ? ` · ${slot.batch}` : ''}
        </span>
      </span>
      <span className="flex-none text-[11.5px] text-ink-muted tabular-nums whitespace-nowrap">{slotTimeRange(slot)}</span>
      {selected && <Check size={14} strokeWidth={2.4} className="flex-none text-accent" aria-hidden="true" />}
    </Tag>
  );
}

/**
 * Request coverage for the staff member's own periods.
 *
 * The period list is derived from their approved timetable for the chosen
 * date, so a period they don't own is never offerable in the first place. A
 * full-day request always covers every scheduled period on that date — the
 * form shows exactly which ones, so "6 periods" is never an abstraction.
 *
 * Recipients are resolved by the same availability/conflict rules the store
 * re-checks on submit: staff with a clash or without cover authorisation are
 * listed with their reason and are not selectable.
 */
export function SubstituteRequestDrawer({ open, onClose, prefill }) {
  const { createSubstituteRequest } = useAttendanceStore();

  const [scope, setScope] = useState('period');
  const [dateKey, setDateKey] = useState(() => dayKeyOffset(1));
  const [slotKey, setSlotKey] = useState(null);
  const [recipientMode, setRecipientMode] = useState('available');
  const [staffId, setStaffId] = useState(null);
  const [staffQuery, setStaffQuery] = useState('');
  const [reason, setReason] = useState('');

  /**
   * The composed-but-unsent request is autosaved locally, keyed by the period
   * it was opened for (there is no record id yet — it hasn't been sent).
   *
   * Recovery is split deliberately: a prefill from a specific period always
   * wins for *what* is being covered (scope, date, slot), so reopening from a
   * different period can never quietly retarget the request at the wrong
   * class — while the typed reason and the chosen recipient are restored, since
   * those are the parts that cost real effort. Sending stays explicit and is
   * the only thing that clears the draft.
   */
  const key = draftKey(ME.id, 'substitute-request', prefill?.slotKey ?? 'new');
  const restored = useRestoredDraft(key, open);
  const autosave = useAutosave({
    value: { scope, dateKey, slotKey, recipientMode, staffId, reason },
    storageKey: key,
    keepLocalDraft: true, // nothing else holds an unsent request
    onSave: () => {},
  });
  const [usedDraft, setUsedDraft] = useState(false);

  // Reopening with a different prefill must not inherit the last request's state.
  useEffect(() => {
    if (!open) return;
    const d = restored?.value;
    // What is being covered: the prefill is authoritative when there is one.
    setScope(prefill?.scope ?? d?.scope ?? 'period');
    setDateKey(prefill?.dateKey ?? d?.dateKey ?? dayKeyOffset(1));
    setSlotKey(prefill?.slotKey ?? d?.slotKey ?? null);
    // Composed content: always restored.
    setRecipientMode(d?.recipientMode ?? 'available');
    setStaffId(d?.staffId ?? null);
    setStaffQuery('');
    setReason(d?.reason ?? '');
    setUsedDraft(!!d?.reason);
  }, [open, prefill, restored]);

  const dayPeriods = useMemo(() => myPeriodsOnDate(dateKey), [dateKey]);

  const selectedSlots = useMemo(() => {
    if (scope === 'day') return dayPeriods;
    const found = dayPeriods.find((p) => p.slotKey === slotKey);
    return found ? [found] : [];
  }, [scope, dayPeriods, slotKey]);

  const periodNumbers = selectedSlots.map((s) => s.period);

  const { eligible, blocked } = useMemo(
    () => (periodNumbers.length ? eligibleStaffFor(dateKey, periodNumbers) : { eligible: [], blocked: [] }),
    [dateKey, periodNumbers.join(',')]
  );

  // A specific recipient who stops being eligible (date/period changed) is dropped, never silently kept.
  useEffect(() => {
    if (staffId && !eligible.some((c) => c.id === staffId)) setStaffId(null);
  }, [eligible, staffId]);

  const filteredStaff = useMemo(() => {
    const term = staffQuery.trim().toLowerCase();
    const match = (c) => !term || c.name.toLowerCase().includes(term) || c.designation.toLowerCase().includes(term);
    return { eligible: eligible.filter(match), blocked: blocked.filter(match) };
  }, [eligible, blocked, staffQuery]);

  const canSubmit =
    selectedSlots.length > 0 &&
    (recipientMode === 'available' ? eligible.length > 0 : !!staffId);

  const submit = () => {
    const ok = createSubstituteRequest({
      dateKey,
      scope,
      slots: selectedSlots,
      recipientMode,
      toStaffId: recipientMode === 'specific' ? staffId : null,
      recipientCount: eligible.length,
      reason,
    });
    if (ok) { autosave.markClean(); onClose(); }
  };

  const noTeaching = dayPeriods.length === 0;

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => { if (!v) { autosave.flush(); onClose(); } }}
      title="Request substitute"
      contextLine={`${formatDayDateDMY(dateFromDayKey(dateKey))} · ${dayPeriods.length} scheduled period${dayPeriods.length === 1 ? '' : 's'}`}
      description="Request another staff member to cover your scheduled periods."
      width="sm:w-[500px]"
    >
      <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] pt-[14px] pb-[16px]">
        <div className="flex items-center gap-[10px] flex-wrap mb-[14px]">
          <Segmented
            ariaLabel="Request type"
            value={scope}
            onChange={(v) => { setScope(v); if (v === 'day') setSlotKey(null); }}
            options={[{ value: 'period', label: 'One period' }, { value: 'day', label: 'Full day' }]}
          />
          <input
            type="date"
            aria-label="Request date"
            value={dateKey}
            onChange={(e) => { setDateKey(e.target.value); setSlotKey(null); }}
            className={cn(FIELD, 'w-[152px]')}
          />
        </div>

        <div className="mb-[14px]">
          <FieldLabel hint={scope === 'day' ? `all ${dayPeriods.length} scheduled` : 'select one of your periods'}>
            {scope === 'day' ? 'Periods covered' : 'Period'}
          </FieldLabel>
          {noTeaching ? (
            <p className="m-0 text-[12px] text-ink-faint">No periods are scheduled for you on this date.</p>
          ) : (
            <div className="grid gap-[6px]">
              {dayPeriods.map((slot) => (
                <PeriodRow
                  key={slot.slotKey}
                  slot={slot}
                  selectable={scope === 'period'}
                  selected={scope === 'day' || slot.slotKey === slotKey}
                  onSelect={() => setSlotKey(slot.slotKey)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mb-[14px]">
          <FieldLabel>Send to</FieldLabel>
          <Segmented
            ariaLabel="Recipient mode"
            value={recipientMode}
            onChange={setRecipientMode}
            options={[{ value: 'available', label: 'Available staff' }, { value: 'specific', label: 'Specific staff' }]}
          />

          {recipientMode === 'available' ? (
            <p className="mt-[8px] mb-0 text-[12px] text-ink-muted">
              {periodNumbers.length === 0
                ? 'Select a period to see who is available.'
                : eligible.length === 0
                  ? 'No eligible staff are free for these periods.'
                  : `${eligible.length} eligible staff are free for ${periodNumbers.length === 1 ? 'this period' : `all ${periodNumbers.length} periods`} and will receive this request.`}
            </p>
          ) : (
            <div className="mt-[8px]">
              <div className="relative mb-[8px]">
                <input
                  value={staffQuery}
                  onChange={(e) => setStaffQuery(e.target.value)}
                  placeholder="Search staff…"
                  aria-label="Search staff"
                  className={cn(FIELD, 'pl-[30px]')}
                />
                <span className="absolute left-[9px] top-0 bottom-0 flex items-center text-ink-ghost pointer-events-none">
                  <Search size={13} strokeWidth={1.9} />
                </span>
              </div>
              <div className="grid gap-[5px]">
                {filteredStaff.eligible.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setStaffId(c.id)}
                    aria-pressed={staffId === c.id}
                    className={cn(
                      'w-full flex items-center gap-[9px] px-[11px] py-[7px] border rounded-[10px] text-left cursor-pointer transition-colors duration-200',
                      staffId === c.id ? 'border-accent-line bg-accent-soft' : 'border-line bg-paper hover:bg-tint2'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-[500] text-ink truncate">{c.name}</span>
                      <span className="block text-[11px] text-ink-faint truncate">{c.designation}</span>
                    </span>
                    <span className="flex-none text-[11px] font-[500] text-success">Free</span>
                    {staffId === c.id && <Check size={14} strokeWidth={2.4} className="flex-none text-accent" aria-hidden="true" />}
                  </button>
                ))}
                {/* Shown, never selectable — the reason is more useful than hiding them. */}
                {filteredStaff.blocked.map((c) => (
                  <div key={c.id} className="flex items-center gap-[9px] px-[11px] py-[7px] border border-line rounded-[10px] bg-tint2 opacity-70">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-[500] text-ink-muted truncate">{c.name}</span>
                      <span className="block text-[11px] text-ink-faint truncate">{c.reason}</span>
                    </span>
                    <span className="flex-none text-[11px] font-[500] text-ink-faint">Unavailable</span>
                  </div>
                ))}
                {filteredStaff.eligible.length === 0 && filteredStaff.blocked.length === 0 && (
                  <p className="m-0 text-[12px] text-ink-faint">No staff found for this search.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <FieldLabel hint="optional">Reason</FieldLabel>
          <textarea
            value={reason}
            onChange={(e) => { setReason(e.target.value.slice(0, 300)); setUsedDraft(false); autosave.schedule(); }}
            rows={2}
            placeholder="e.g. Attending a faculty development programme."
            aria-label="Reason for this request"
            className={cn(FIELD, 'h-auto py-[8px] resize-none')}
          />
        </div>
      </div>

      <DrawerRail
        meta={
          <span className="flex items-center gap-[7px] text-[11px] text-ink-faint">
            <span>
              {selectedSlots.length === 0
                ? 'Select a period'
                : `${selectedSlots.length} period${selectedSlots.length === 1 ? '' : 's'} · ${recipientMode === 'specific' ? (staffId ? '1 recipient' : 'no recipient selected') : `${eligible.length} recipients`}`}
            </span>
            {/* One quiet line: the recovered draft until the user touches it,
                then ordinary save status. */}
            {usedDraft
              ? <DraftRestoredNote show />
              : <AutosaveStatus status={autosave.status} onRetry={autosave.retry} />}
          </span>
        }
      >
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={cn(
            canSubmit
              ? PRIMARY_BTN
              : 'flex-none h-[34px] px-[15px] border-0 rounded-[10px] bg-frame text-ink-disabled font-sans text-[12.5px] font-[500] cursor-not-allowed'
          )}
        >
          Submit request
        </button>
      </DrawerRail>
    </DrawerShell>
  );
}
