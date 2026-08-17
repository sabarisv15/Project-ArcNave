import { useEffect, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { DrawerShell, DrawerRail, PRIMARY_BTN, GHOST_BTN } from './AttendanceActionDrawer';
import { useAssessmentsStore } from '../store/AssessmentsProvider';
import { ASSESSMENT_TYPES, eligibleScopes, scopeLabel } from '../lib/assessmentsData';
import { SessionTypeChip } from './SessionType';
import { istDayKey, parseISTDateBounds } from '../lib/ist';
import { AutosaveStatus, DraftRestoredNote } from './AutosaveStatus';
import { useAutosave, useRestoredDraft } from '../hooks/useAutosave';
import { draftKey } from '../lib/draftStore';
import { ME as DOC_ME } from '../lib/documentsData';

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

/**
 * Step 1 — scope. Every option is one of the staff member's own allocations in
 * the active approved timetable. There is no free-text subject or class field
 * in this drawer, which is what makes "create an assessment for a class I
 * don't teach" unrepresentable rather than merely validated against.
 */
function ScopePicker({ scopes, value, onChange }) {
  return (
    <div className="grid gap-[6px]">
      {scopes.map((s) => {
        const on = s.id === value;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            aria-pressed={on}
            className={cn(
              'w-full flex items-center gap-[9px] px-[11px] py-[8px] border rounded-[10px] text-left cursor-pointer transition-colors duration-200',
              on ? 'border-accent-line bg-accent-soft' : 'border-line bg-paper hover:bg-tint2'
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-[500] text-ink truncate">{s.subject}</span>
              <span className="block text-[11px] text-ink-faint truncate">
                {s.code}
                {s.batch ? ` · ${s.batch}` : ''} · {s.weeklyHours} {s.weeklyHours === 1 ? 'hr' : 'hrs'}/week
              </span>
            </span>
            <SessionTypeChip type={s.type} />
            {on && <Check size={14} strokeWidth={2.4} className="flex-none text-accent" aria-hidden="true" />}
          </button>
        );
      })}
      {scopes.length === 0 && (
        <p className="m-0 text-[12px] text-ink-faint">
          You have no subject allocations in the active approved timetable.
        </p>
      )}
    </div>
  );
}

/**
 * Create an assessment, in a drawer over the Assessments workspace — never a
 * standalone page. Scope first, then the few details that actually differ per
 * assessment. There is no cap on how many a staff member may create inside
 * their own scope.
 */
export function AssessmentCreateDrawer({ open, onClose, onCreated }) {
  const { createAssessment } = useAssessmentsStore();
  const scopes = eligibleScopes();

  const [scopeId, setScopeId] = useState(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('internal');
  const [dateKey, setDateKey] = useState(() => istDayKey(new Date()));
  const [maxMarks, setMaxMarks] = useState('50');
  const [instructions, setInstructions] = useState('');
  const [showInstructions, setShowInstructions] = useState(false);
  const [touched, setTouched] = useState(false);

  /**
   * The half-filled form is worth keeping. Every field autosaves locally on a
   * 600ms debounce, so closing the drawer by accident — backdrop, Escape, an
   * outside click — and reopening restores exactly what was typed, with one
   * quiet "Draft restored" line. Creating the assessment is still the explicit
   * action; nothing here creates anything on its own.
   */
  const key = draftKey(DOC_ME.id, 'assessment-create', 'new');
  const restored = useRestoredDraft(key, open);
  const formValue = { scopeId, name, type, dateKey, maxMarks, instructions };
  const autosave = useAutosave({
    value: formValue,
    storageKey: key,
    keepLocalDraft: true, // the assessment doesn't exist until Create is pressed
    onSave: () => {},
  });
  const [usedDraft, setUsedDraft] = useState(false);

  useEffect(() => {
    if (!open) return;
    const d = restored?.value;
    setScopeId(d?.scopeId ?? (scopes.length === 1 ? scopes[0].id : null));
    setName(d?.name ?? '');
    setType(d?.type ?? 'internal');
    setDateKey(d?.dateKey ?? istDayKey(new Date()));
    setMaxMarks(d?.maxMarks ?? '50');
    setInstructions(d?.instructions ?? '');
    setShowInstructions(!!d?.instructions);
    setTouched(false);
    setUsedDraft(!!d && (!!d.name || !!d.instructions || !!d.scopeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, restored]);

  const edit = (setter) => (value) => { setter(value); setUsedDraft(false); autosave.schedule(); };

  const marksNumber = Number(maxMarks);
  const marksValid = Number.isFinite(marksNumber) && marksNumber > 0;
  const nameValid = name.trim().length > 0;
  const canSubmit = !!scopeId && nameValid && marksValid && !!dateKey;

  const submit = (saveAsDraft) => {
    setTouched(true);
    if (!canSubmit) return;
    const created = createAssessment({
      scopeId,
      name,
      type,
      date: parseISTDateBounds(dateKey).start,
      maxMarks: marksNumber,
      instructions,
      saveAsDraft,
    });
    if (created) {
      autosave.markClean(); // the draft has become a real assessment
      onClose();
      if (!saveAsDraft) onCreated?.(created);
    }
  };

  const selected = scopes.find((s) => s.id === scopeId);

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => { if (!v) { autosave.flush(); onClose(); } }}
      title="Create assessment"
      contextLine={selected ? scopeLabel(selected) : 'Choose one of your timetable allocations'}
      description="Create an assessment for a subject and class you teach."
      width="sm:w-[480px]"
    >
      <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] pt-[14px] pb-[16px]">
        <div className="mb-[16px]">
          <FieldLabel hint="from your approved timetable">Subject &amp; class</FieldLabel>
          <ScopePicker scopes={scopes} value={scopeId} onChange={edit(setScopeId)} />
        </div>

        <div className="mb-[14px]">
          <FieldLabel>Assessment name</FieldLabel>
          <input
            value={name}
            onChange={(e) => edit(setName)(e.target.value)}
            placeholder="e.g. Internal Test 1"
            aria-label="Assessment name"
            aria-invalid={touched && !nameValid}
            className={cn(FIELD, touched && !nameValid && 'border-danger')}
          />
        </div>

        <div className="grid grid-cols-2 gap-[10px] mb-[14px]">
          <div>
            <FieldLabel>Type</FieldLabel>
            <div className="relative">
              <select
                value={type}
                onChange={(e) => edit(setType)(e.target.value)}
                aria-label="Assessment type"
                className={cn(FIELD, 'appearance-none pr-[26px] cursor-pointer')}
              >
                {ASSESSMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <ChevronDown size={13} strokeWidth={2} aria-hidden="true" className="absolute right-[9px] top-1/2 -translate-y-1/2 text-ink-ghost pointer-events-none" />
            </div>
          </div>
          <div>
            <FieldLabel>Maximum marks</FieldLabel>
            <input
              type="number"
              min="1"
              value={maxMarks}
              onChange={(e) => edit(setMaxMarks)(e.target.value)}
              aria-label="Maximum marks"
              aria-invalid={touched && !marksValid}
              className={cn(FIELD, 'tabular-nums', touched && !marksValid && 'border-danger')}
            />
          </div>
        </div>

        <div className="mb-[14px]">
          <FieldLabel hint="DD/MM/YYYY">Assessment date</FieldLabel>
          <input
            type="date"
            value={dateKey}
            onChange={(e) => edit(setDateKey)(e.target.value)}
            aria-label="Assessment date"
            className={cn(FIELD, 'w-[168px]')}
          />
        </div>

        <button
          type="button"
          onClick={() => setShowInstructions((v) => !v)}
          aria-expanded={showInstructions}
          className="inline-flex items-center gap-[5px] h-[26px] border-0 bg-transparent font-sans text-[11.5px] font-[500] text-ink-muted cursor-pointer hover:text-accent"
        >
          <ChevronDown size={13} strokeWidth={2.2} className={cn('transition-transform duration-200', showInstructions && 'rotate-180')} aria-hidden="true" />
          {showInstructions ? 'Hide instructions' : 'Add instructions'}
        </button>
        {showInstructions && (
          <textarea
            value={instructions}
            onChange={(e) => edit(setInstructions)(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="Optional notes for this assessment"
            aria-label="Assessment instructions"
            className={cn(FIELD, 'h-auto py-[8px] mt-[8px] resize-none')}
          />
        )}
      </div>

      <DrawerRail
        meta={
          <span className="flex items-center gap-[7px] text-[11px] text-ink-faint">
            <span>
              {!scopeId ? 'Select a subject and class' : !nameValid ? 'Name is required' : !marksValid ? 'Maximum marks must be above 0' : 'Ready'}
            </span>
            {/* An incomplete form still keeps its draft — validation gates the
                explicit Create action, never the autosave. */}
            {usedDraft
              ? <DraftRestoredNote show />
              : <AutosaveStatus status={autosave.status} onRetry={autosave.retry} />}
          </span>
        }
      >
        <button type="button" className={GHOST_BTN} onClick={() => submit(true)}>Save draft</button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={!canSubmit}
          className={cn(canSubmit ? PRIMARY_BTN : 'flex-none h-[34px] px-[15px] border-0 rounded-[10px] bg-frame text-ink-disabled font-sans text-[12.5px] font-[500] cursor-not-allowed')}
        >
          Create assessment
        </button>
      </DrawerRail>
    </DrawerShell>
  );
}
