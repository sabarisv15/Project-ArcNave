import { useMemo, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { DrawerShell, DrawerRail, PRIMARY_BTN, GHOST_BTN } from './AttendanceActionDrawer';
import { AssessmentReportDrawer } from './AssessmentReportDrawer';
import { useAssessmentsStore } from '../store/AssessmentsProvider';
import {
  TYPE_LABELS, canPublish, isValidMark, marksProgress, scopeById, studentsForScope,
} from '../lib/assessmentsData';
import { formatDateDMY } from '../lib/ist';
import { AutosaveStatus, DraftRestoredNote } from './AutosaveStatus';
import { CELL_DEBOUNCE_MS, useAutosave, useRestoredDraft } from '../hooks/useAutosave';
import { draftKey } from '../lib/draftStore';
import { ME } from '../lib/documentsData';

/**
 * One student row. The marks input is the row's whole point, so it is the only
 * interactive control competing for attention; Absent is a compact toggle
 * beside it. Enter/↓ moves to the next student's input, so a full class can be
 * entered without touching the mouse.
 */
function StudentRow({ student, index, entry, maxMarks, disabled, onChange, registerRef, onAdvance }) {
  const absent = !!entry?.absent;
  const value = entry?.absent ? '' : entry?.value ?? '';
  const invalid = !absent && value !== '' && !isValidMark({ value: Number(value), absent: false }, maxMarks);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_92px_78px] gap-x-[10px] items-center px-[18px] py-[6px] border-t border-line-light first:border-t-0">
      <span className="min-w-0">
        <span className="block text-[12.5px] font-[500] text-ink truncate">{student.name}</span>
        <span className="block text-[10.5px] text-ink-faint tabular-nums truncate">
          Roll {student.roll} · {student.registerNumber}
        </span>
      </span>

      <input
        ref={registerRef}
        type="number"
        inputMode="numeric"
        min="0"
        max={maxMarks}
        disabled={disabled || absent}
        value={value}
        aria-label={`Marks for ${student.name}, out of ${maxMarks}`}
        aria-invalid={invalid}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange(null);
          onChange({ value: Number(raw), absent: false });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); onAdvance(index + 1); }
          if (e.key === 'ArrowUp') { e.preventDefault(); onAdvance(index - 1); }
        }}
        className={cn(
          'h-[30px] w-full px-[9px] border rounded-[8px] bg-paper font-sans text-[12.5px] tabular-nums text-ink outline-none transition-colors duration-200 focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]',
          invalid ? 'border-danger' : 'border-line',
          (disabled || absent) && 'bg-tint2 text-ink-disabled cursor-not-allowed'
        )}
      />

      <button
        type="button"
        disabled={disabled}
        aria-pressed={absent}
        onClick={() => onChange(absent ? null : { value: null, absent: true })}
        className={cn(
          'h-[26px] px-[9px] border rounded-[8px] font-sans text-[11px] font-[500] transition-colors duration-200',
          absent ? 'border-danger bg-danger-soft text-danger' : 'border-line bg-paper text-ink-muted hover:bg-tint2',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
        )}
      >
        Absent
      </button>
    </div>
  );
}

/**
 * The marks-entry workspace: a compact context line, then the student table as
 * the dominant region with its own sticky header, then one action rail.
 * Autosave is quiet and inline — no toast per keystroke.
 *
 * A published assessment is read-only to direct entry here; changing published
 * marks is deliberately not offered and is left to a controlled correction
 * flow rather than allowed silently.
 */
export function AssessmentDetailDrawer({ assessmentId, onClose }) {
  const { assessments, setMark, publishAssessment } = useAssessmentsStore();
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const inputRefs = useRef([]);

  const assessment = assessments.find((a) => a.id === assessmentId) ?? null;

  /**
   * Each edited cell lands in the record immediately (that is the draft), and
   * the batched sync is debounced at 400ms behind it. The session mirror means
   * a sync that never lands still leaves every entered mark recoverable, and
   * the rail shows the same quiet Saving…/Saved/Retry line as every other form
   * instead of a toast per keystroke. Nothing here can publish.
   */
  const key = draftKey(ME.id, 'assessment-marks', assessmentId ?? 'none');
  const restored = useRestoredDraft(key, !!assessmentId);
  const marksAutosave = useAutosave({
    value: assessment?.marks ?? {},
    storageKey: key,
    delay: CELL_DEBOUNCE_MS,
    enabled: !!assessment && assessment.status !== 'published',
    onSave: () => {},
  });
  const restoredMarks = !!restored?.value && Object.keys(restored.value).length > 0;

  const closeDrawer = () => {
    marksAutosave.flush(); // an accidental close still commits the last cell
    onClose();
  };
  const scope = assessment ? scopeById(assessment.scopeId) : null;
  const students = useMemo(() => studentsForScope(scope), [scope]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return students;
    return students.filter(
      (s) => s.name.toLowerCase().includes(term) || s.roll.includes(term) || s.registerNumber.includes(term)
    );
  }, [students, query]);

  if (!assessment) return null;

  const published = assessment.status === 'published';
  const { entered, total } = marksProgress(assessment, students);
  const publishable = canPublish(assessment, students);

  const advance = (nextIndex) => {
    const el = inputRefs.current[nextIndex];
    if (el) { el.focus(); el.select?.(); }
  };

  return (
    <>
      <DrawerShell
        open={!!assessmentId}
        onOpenChange={(v) => !v && closeDrawer()}
        title={assessment.name}
        contextLine={`${assessment.subject} · ${assessment.code} · ${TYPE_LABELS[assessment.type]} · ${formatDateDMY(assessment.date)} · Max ${assessment.maxMarks}`}
        description={`Marks entry for ${assessment.name}`}
        width="sm:w-[560px]"
      >
        <div className="flex-none flex items-center gap-[8px] px-[18px] pt-[12px] pb-[10px]">
          <div className="relative flex-1 min-w-0">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, roll, register no…"
              aria-label="Search students"
              className="w-full h-[32px] pl-[30px] pr-[10px] border border-line rounded-[9px] bg-paper font-sans text-[12.5px] text-ink outline-none focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
            />
            <span className="absolute left-[9px] top-0 bottom-0 flex items-center text-ink-ghost pointer-events-none">
              <Search size={13} strokeWidth={1.9} />
            </span>
          </div>
          {published && (
            <span className="flex-none inline-flex items-center gap-[5px] h-[26px] px-[9px] rounded-[8px] bg-success-soft text-[11px] font-[500] text-success">
              <Check size={11} strokeWidth={2.4} aria-hidden="true" />
              Published · read-only
            </span>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet bg-paper border-y border-line">
          <div className="grid grid-cols-[minmax(0,1fr)_92px_78px] gap-x-[10px] sticky top-0 z-[46] px-[18px] h-[30px] items-center bg-paper shadow-[inset_0_-1px_0_theme(colors.line.DEFAULT)] text-[10px] font-[500] tracking-[.06em] uppercase text-ink-muted">
            <span>Student</span>
            <span>Marks</span>
            <span />
          </div>

          {filtered.map((s) => {
            const index = students.indexOf(s);
            return (
              <StudentRow
                key={s.id}
                student={s}
                index={index}
                entry={assessment.marks[s.id]}
                maxMarks={assessment.maxMarks}
                disabled={published}
                onChange={(entry) => { setMark(assessment.id, s.id, entry); marksAutosave.schedule(); }}
                registerRef={(el) => { inputRefs.current[index] = el; }}
                onAdvance={advance}
              />
            );
          })}

          {filtered.length === 0 && (
            <p className="py-[16px] text-[12px] text-ink-faint text-center">No students found for “{query}”.</p>
          )}
        </div>

        {confirming ? (
          <div className="flex-none px-[18px] py-[12px] border-t border-line bg-paper">
            <div className="text-[12.5px] font-[500] text-ink">Publish marks?</div>
            <p className="mt-[3px] mb-[10px] text-[11.5px] leading-[1.5] text-ink-muted">
              Published marks will be available in Class Tutor view.
            </p>
            <div className="flex items-center justify-end gap-[8px]">
              <button type="button" className={GHOST_BTN} onClick={() => setConfirming(false)}>Cancel</button>
              <button
                type="button"
                className={PRIMARY_BTN}
                onClick={() => { publishAssessment(assessment.id); marksAutosave.markClean(); setConfirming(false); }}
              >
                Publish marks
              </button>
            </div>
          </div>
        ) : (
          <DrawerRail
            meta={
              <span className="block text-[11px] text-ink-faint tabular-nums" aria-live="polite">
                {entered} / {total} entered
                {!published && (
                  <>
                    <span className="mx-[5px] text-ink-faint" aria-hidden="true">·</span>
                    {restoredMarks && marksAutosave.status === 'idle' ? (
                      <DraftRestoredNote show />
                    ) : (
                      <AutosaveStatus
                        status={marksAutosave.status}
                        savedAt={marksAutosave.savedAt ?? assessment.marksSavedAt}
                        onRetry={marksAutosave.retry}
                      />
                    )}
                  </>
                )}
              </span>
            }
          >
            <button type="button" className={GHOST_BTN} onClick={() => setReportOpen(true)}>Report</button>
            {!published && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!publishable}
                title={publishable ? undefined : 'Every student needs a valid mark before publishing.'}
                className={cn(publishable ? PRIMARY_BTN : 'flex-none h-[34px] px-[15px] border-0 rounded-[10px] bg-frame text-ink-disabled font-sans text-[12.5px] font-[500] cursor-not-allowed')}
              >
                Publish marks
              </button>
            )}
          </DrawerRail>
        )}
      </DrawerShell>

      <AssessmentReportDrawer
        assessment={reportOpen ? assessment : null}
        students={students}
        onClose={() => setReportOpen(false)}
      />
    </>
  );
}
