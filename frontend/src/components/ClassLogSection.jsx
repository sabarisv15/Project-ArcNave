import { useState } from 'react';
import { Check, ChevronDown, NotebookPen } from 'lucide-react';
import { cn } from '../lib/utils';
import { TOPIC_TAUGHT_MAX_LENGTH, formatTime } from '../lib/attendanceData';
import { AutosaveStatus } from './AutosaveStatus';
import { useAutosave } from '../hooks/useAutosave';
import { draftKey } from '../lib/draftStore';
import { ME } from '../lib/substituteData';

const FIELD_INPUT =
  'w-full font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]';

const OPTIONAL_FIELDS = [
  { key: 'lessonObjective', label: 'Lesson objective', placeholder: 'e.g. Students can explain and implement binary search.' },
  { key: 'teachingMethod', label: 'Teaching method / activity', placeholder: 'e.g. Lecture + whiteboard walkthrough' },
  { key: 'resourcesUsed', label: 'Resources used', placeholder: 'e.g. Slides, textbook Ch. 4' },
  { key: 'homework', label: 'Homework / follow-up', placeholder: 'e.g. Solve problems 4.1–4.6 for next class' },
  { key: 'notes', label: 'Notes', placeholder: 'Anything else worth recording about this class' },
];

/**
 * The mandatory teaching record for this class hour — lives inside the same
 * marking flow as attendance, not a separate page. `topicTaught` is the only
 * required field; Lock is refused without it (validated by the caller, which
 * passes `topicError` + `topicRef` so this can focus the field on failure).
 * Date/time/subject/class are never repeated here — they already live in the
 * compact context header above.
 */
export function ClassLogSection({ classLog, onChange, topicError, topicRef, disabled }) {
  const [expanded, setExpanded] = useState(false);
  const topicLength = classLog.topicTaught.length;
  const hasOptionalContent = OPTIONAL_FIELDS.some((f) => classLog[f.key]?.trim());

  return (
    <div className="mt-[16px] pt-[14px] border-t border-line">
      <div className="flex items-center gap-[7px] mb-[8px]">
        <NotebookPen size={14} strokeWidth={1.9} className="text-ink-faint" aria-hidden="true" />
        <span className="text-[11.5px] font-[500] uppercase tracking-[.06em] text-ink-faint">Class log</span>
      </div>

      <div>
        <label htmlFor="topic-taught" className="block text-[12.5px] font-[500] text-ink mb-[6px]">
          Topic taught<span className="text-danger"> *</span>
        </label>
        <textarea
          id="topic-taught"
          ref={topicRef}
          value={classLog.topicTaught}
          onChange={(e) => onChange({ topicTaught: e.target.value.slice(0, TOPIC_TAUGHT_MAX_LENGTH) })}
          disabled={disabled}
          rows={3}
          placeholder="e.g. Binary search: traversal and complexity"
          aria-required="true"
          aria-invalid={!!topicError}
          aria-describedby={topicError ? 'topic-taught-error' : undefined}
          className={cn(FIELD_INPUT, 'resize-y min-h-[64px]', topicError && 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(180,69,60,.1)]')}
        />
        <div className="flex items-center justify-between mt-[5px]">
          {topicError ? (
            <span id="topic-taught-error" className="text-[11.5px] font-[500] text-danger">
              {topicError}
            </span>
          ) : (
            <span />
          )}
          <span className="text-[10.5px] text-ink-faint tabular-nums whitespace-nowrap">
            {topicLength}/{TOPIC_TAUGHT_MAX_LENGTH}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-[12px] inline-flex items-center gap-[5px] h-[26px] px-[2px] border-0 bg-transparent font-sans text-[11.5px] font-[500] text-ink-muted cursor-pointer hover:text-accent"
      >
        <ChevronDown size={13} strokeWidth={2.2} className={cn('transition-transform duration-200', expanded && 'rotate-180')} aria-hidden="true" />
        {expanded ? 'Hide note' : hasOptionalContent ? 'Show note' : 'Add note'}
      </button>

      {expanded && (
        <div className="mt-[10px] grid grid-cols-1 sm:grid-cols-2 gap-[10px] animate-fadeUp">
          {OPTIONAL_FIELDS.map((f) => (
            <div key={f.key} className={f.key === 'notes' ? 'sm:col-span-2' : undefined}>
              <label htmlFor={`classlog-${f.key}`} className="block text-[11.5px] font-[500] text-ink-soft mb-[5px]">
                {f.label}
              </label>
              <textarea
                id={`classlog-${f.key}`}
                value={classLog[f.key]}
                onChange={(e) => onChange({ [f.key]: e.target.value })}
                disabled={disabled}
                rows={2}
                placeholder={f.placeholder}
                className={cn(FIELD_INPUT, 'resize-y min-h-[40px]')}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Read-only class log summary shown once a record is locked/submitted — never editable inline past that point. */
export function ClassLogReadOnly({ classLog }) {
  const hasOptional = ['lessonObjective', 'teachingMethod', 'resourcesUsed', 'homework', 'notes'].some((k) => classLog[k]?.trim());
  return (
    <div className="mt-[16px] pt-[14px] border-t border-line">
      <div className="flex items-center gap-[7px] mb-[8px]">
        <NotebookPen size={13} strokeWidth={1.9} className="text-ink-faint" aria-hidden="true" />
        <span className="text-[11px] font-[500] uppercase tracking-[.06em] text-ink-faint">Class log</span>
      </div>
      <div className="text-[13px] leading-[1.5] text-ink whitespace-pre-wrap">{classLog.topicTaught || '—'}</div>
      {hasOptional && (
        <dl className="mt-[10px] grid grid-cols-1 sm:grid-cols-2 gap-x-[14px] gap-y-[8px]">
          {[
            ['Lesson objective', classLog.lessonObjective],
            ['Teaching method', classLog.teachingMethod],
            ['Resources used', classLog.resourcesUsed],
            ['Homework / follow-up', classLog.homework],
            ['Notes', classLog.notes],
          ]
            .filter(([, v]) => v?.trim())
            .map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] tracking-[.05em] uppercase text-ink-faint mb-[2px]">{label}</dt>
                <dd className="m-0 text-[12px] text-ink-muted whitespace-pre-wrap">{value}</dd>
              </div>
            ))}
        </dl>
      )}
    </div>
  );
}

export function formatClassLogTime(period) {
  return `${formatTime(period.startTime)}–${formatTime(period.endTime)}`;
}

/** Quiet "Saved · just now" text — never a repeated toast for every keystroke/autosave. */
export function ClassLogSavedIndicator({ savedAt, now }) {
  if (!savedAt) return <span className="text-[11px] text-ink-faint">Not saved yet</span>;
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  const text = seconds < 45 ? 'Saved · just now' : `Saved · last saved ${Math.round(seconds / 60)} min ago`;
  return (
    <span className="inline-flex items-center gap-[5px] text-[11px] text-ink-faint">
      <Check size={11} strokeWidth={2.2} className="text-success" aria-hidden="true" />
      {text}
    </span>
  );
}

/**
 * Class log editing once attendance is Locked/Submitted/expired — topic and
 * notes stay editable "at any time" (per the Class Log spec) even though
 * the attendance record itself is frozen. Editing here never reopens,
 * unlocks, or recalculates attendance; it only patches `session.classLog`.
 */
export function ClassLogEditable({ classLog, onChange, savedAt, now, periodId }) {
  // Each keystroke patches the record straight away (that is the draft); the
  // debounced autosave behind it keeps the session mirror and the quiet
  // status line, so closing the drawer mid-sentence never loses the text.
  const key = draftKey(ME.id, 'class-log', periodId ?? 'unknown');
  const autosave = useAutosave({ value: classLog, storageKey: key, onSave: () => {} });

  return (
    <div>
      <ClassLogSection
        classLog={classLog}
        onChange={(patch) => { onChange(patch); autosave.schedule(); }}
        topicError={null}
      />
      <div className="flex justify-end mt-[6px]">
        {autosave.status === 'error' || autosave.status === 'saving'
          ? <AutosaveStatus status={autosave.status} onRetry={autosave.retry} />
          : <ClassLogSavedIndicator savedAt={savedAt} now={now} />}
      </div>
    </div>
  );
}
