import { useMemo, useState } from 'react';
import { Check, FileSpreadsheet, Upload } from 'lucide-react';
import { DrawerRail, DrawerShell, GHOST_BTN, PRIMARY_BTN } from '@/components/ui/Drawer';
import {
  ACCEPTED_EXTENSIONS,
  IMPORT_FIELDS,
  ROW_STATES,
  classifyRows,
  guessMapping,
  importableRows,
  parseDelimited,
  sampleFile,
  summarise,
} from '../lib/bulkImportData';
import { useAcademicRoster } from '@/features/institution';
import { OWNED_CLASS, PROMOTED_STUDENTS } from '../lib/classTutorData';
import { STICKY_HEAD, TABLE_HEAD, StickyTableShell } from './WorkspaceLayout';
import { cn } from '../lib/utils';

/**
 * Importing a list of students into this class.
 *
 * **Three steps: file, mapping, preview.** The preview is the one that earns
 * the feature — every row is classified valid / warning / rejected *before*
 * anything is created, with the reason stated per row. An import that reported
 * its failures afterwards would be asking someone to clean up a roster rather
 * than to make a decision.
 *
 * **The class context is locked and is not in the file.** Department, academic
 * year, semester and section come from the seat; a `class` column in the sheet
 * is ignored. A file that could redirect rows into another class would be a way
 * around the one-class scope this whole seat is built on.
 *
 * **Confirmed rows are active immediately**, carrying `Documents pending` —
 * they have a record and no documents yet, which is a follow-up, never a hold
 * on enrolment.
 *
 * This is deliberately **not** built on the Staff `StudentBulkTray`: that is a
 * multi-select tray over a multi-class teaching scope, and reusing it here
 * would import the wrong scope along with the markup.
 */

const GRID =
  'grid grid-cols-[28px_minmax(0,1.4fr)_minmax(0,1fr)_92px_minmax(0,1.3fr)] gap-x-[10px] items-center px-[14px]';

const STEPS = ['File', 'Columns', 'Preview'];

export function BulkImportDrawer({ open, onOpenChange, onImported }) {
  const { classFill, importStudents, validateAdmission } = useAcademicRoster();
  const [stepIndex, setStepIndex] = useState(0);
  const [fileName, setFileName] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [result, setResult] = useState(null);

  const fill = classFill(OWNED_CLASS.id);

  const classified = useMemo(() => {
    if (!parsed) return [];
    return classifyRows(parsed.rows, mapping, (values, pending) =>
      validateAdmission(OWNED_CLASS.id, values, { scopeClassId: OWNED_CLASS.id, pending }),
    );
  }, [parsed, mapping, validateAdmission]);

  const counts = summarise(classified);

  function reset() {
    setStepIndex(0);
    setFileName(null);
    setParsed(null);
    setMapping({});
    setResult(null);
  }

  function close(next) {
    onOpenChange(next);
    if (!next) reset();
  }

  function loadSample() {
    // No file system in a prototype: a deterministic sample stands in for the
    // upload so the mapping and preview can be reviewed exactly as they will
    // behave. It carries one of every outcome, including a student already
    // placed in this class by promotion.
    const promotedReg = PROMOTED_STUDENTS[0]?.reg ?? '';
    const text = sampleFile(promotedReg);
    const next = parseDelimited(text);
    setFileName('class-intake.csv');
    setParsed(next);
    setMapping(guessMapping(next.headers));
    setStepIndex(1);
  }

  function confirm() {
    const outcome = importStudents(OWNED_CLASS.id, importableRows(classified), {
      scopeClassId: OWNED_CLASS.id,
    });
    setResult(outcome);
    onImported?.(outcome);
  }

  return (
    <DrawerShell
      open={open}
      onOpenChange={close}
      title="Import students"
      contextLine={`${OWNED_CLASS.code} · ${fill.headroom} of ${fill.capacity} seats free`}
      width="sm:w-[680px]"
    >
      <div className="flex-1 min-h-0 overflow-auto scroll-quiet px-[18px] py-[15px] flex flex-col gap-[13px]">
        <ol className="m-0 p-0 list-none flex items-center gap-[6px]">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-[6px]">
              {i > 0 && (
                <span aria-hidden="true" className="text-ink-ghost text-[11px]">
                  →
                </span>
              )}
              <span
                className={cn(
                  'inline-flex items-center h-[22px] px-[8px] rounded-[7px] text-[11.5px]',
                  i === stepIndex && !result
                    ? 'bg-accent-soft text-accent font-[600]'
                    : i < stepIndex || result
                      ? 'bg-tint2 text-ink-soft font-[500]'
                      : 'text-ink-faint',
                )}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>

        <div className="px-[12px] py-[9px] rounded-[12px] bg-tint border border-line">
          <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">Importing into</div>
          <div className="mt-[4px] text-[12.5px] text-ink">
            {OWNED_CLASS.dept} · {OWNED_CLASS.code} · Semester {OWNED_CLASS.semester} · AY {OWNED_CLASS.academicYear}
          </div>
          <div className="mt-[2px] text-[11.5px] text-ink-faint">
            Locked to this class. A class or section column in the file is ignored.
          </div>
        </div>

        {result ? (
          <div className="flex flex-col gap-[9px]">
            <div className="flex items-center gap-[7px] text-[13px] text-ink">
              <Check size={15} strokeWidth={2.2} aria-hidden="true" className="text-success" />
              <span>
                <span className="font-[500]">{result.accepted.length}</span> student
                {result.accepted.length === 1 ? '' : 's'} are now active in {OWNED_CLASS.code}.
              </span>
            </div>
            <p className="m-0 text-[12px] text-ink-muted">
              They carry <span className="text-ink-soft">Documents pending</span> until their documents are added.{' '}
              {counts.rejected} rejected row
              {counts.rejected === 1 ? ' was' : 's were'} not imported.
            </p>
          </div>
        ) : stepIndex === 0 ? (
          <div className="flex flex-col gap-[10px]">
            <p className="m-0 text-[12.5px] text-ink-muted">
              A CSV or spreadsheet of student rows. Documents are not part of an import — they are added per student
              afterwards.
            </p>
            <button
              type="button"
              onClick={loadSample}
              className="flex items-center justify-center gap-[7px] h-[76px] border border-dashed border-line rounded-[14px] bg-paper font-sans text-[12.5px] font-[500] text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink"
            >
              <Upload size={15} strokeWidth={1.9} aria-hidden="true" />
              Choose a file ({ACCEPTED_EXTENSIONS.join(', ')})
            </button>
          </div>
        ) : stepIndex === 1 ? (
          <div className="flex flex-col gap-[10px]">
            <div className="flex items-center gap-[7px] text-[12.5px] text-ink-soft">
              <FileSpreadsheet size={14} strokeWidth={1.8} aria-hidden="true" className="text-ink-faint" />
              {fileName} · {parsed.rows.length} rows
            </div>
            <p className="m-0 text-[12px] text-ink-muted">
              Match each column. The guesses below come from the header names and are worth checking — only you know
              what your export calls things.
            </p>
            {IMPORT_FIELDS.map((f) => (
              <label key={f.key} className="grid grid-cols-[150px_1fr] gap-x-[10px] items-center">
                <span className="text-[12px] text-ink-soft">
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                </span>
                <select
                  className="w-full font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[9px] px-[9px] py-[6px] outline-none focus:border-accent-line"
                  value={mapping[f.key] ?? ''}
                  onChange={(e) =>
                    setMapping((prev) => ({
                      ...prev,
                      [f.key]: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                >
                  <option value="">Not mapped</option>
                  {parsed.headers.map((h, i) => (
                    <option key={h + i} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            <div className="flex items-center gap-[10px] flex-wrap text-[12px]">
              {['valid', 'warning', 'rejected'].map((state) => (
                <span key={state} className="inline-flex items-center gap-[5px]">
                  <span
                    className={cn(
                      'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                      ROW_STATES[state].tone,
                    )}
                  >
                    {ROW_STATES[state].label}
                  </span>
                  <span className="text-ink-muted tabular-nums">{counts[state]}</span>
                </span>
              ))}
              <span className="text-ink-faint">of {counts.total} rows</span>
            </div>

            <StickyTableShell minWidth={560}>
              <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'h-[34px]')}>
                <span>#</span>
                <span>Name</span>
                <span>Register no</span>
                <span>State</span>
                <span>Notes</span>
              </div>
              {classified.map((row) => (
                <div key={row.index} className={cn(GRID, 'min-h-[40px] py-[6px] border-t border-line-light')}>
                  <span className="text-[11.5px] text-ink-faint tabular-nums">{row.index + 1}</span>
                  <span className="text-[12.5px] text-ink truncate">
                    {row.values.name || <span className="text-ink-faint">—</span>}
                  </span>
                  <span className="text-[12px] text-ink-muted truncate tabular-nums">
                    {row.values.reg || <span className="text-ink-faint">—</span>}
                  </span>
                  <span>
                    <span
                      className={cn(
                        'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                        ROW_STATES[row.state].tone,
                      )}
                    >
                      {ROW_STATES[row.state].label}
                    </span>
                  </span>
                  <span className="text-[11.5px] text-ink-muted">{row.issues.join(' · ')}</span>
                </div>
              ))}
            </StickyTableShell>

            <p className="m-0 text-[12px] text-ink-muted">
              Confirming activates {counts.valid + counts.warning} student
              {counts.valid + counts.warning === 1 ? '' : 's'} in {OWNED_CLASS.code} straight away. Rejected rows are
              not imported and nothing about them is saved.
            </p>
          </div>
        )}
      </div>

      <DrawerRail>
        {result ? (
          <button type="button" className={PRIMARY_BTN} onClick={() => close(false)}>
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              className={GHOST_BTN}
              onClick={() => (stepIndex === 0 ? close(false) : setStepIndex((i) => i - 1))}
            >
              {stepIndex === 0 ? 'Cancel' : 'Back'}
            </button>
            <button
              type="button"
              className={PRIMARY_BTN}
              disabled={
                stepIndex === 0 ||
                (stepIndex === 1 && (mapping.name == null || mapping.reg == null)) ||
                (stepIndex === 2 && counts.valid + counts.warning === 0)
              }
              onClick={() => (stepIndex === 2 ? confirm() : setStepIndex((i) => i + 1))}
            >
              {stepIndex === 2 ? `Import ${counts.valid + counts.warning}` : 'Continue'}
            </button>
          </>
        )}
      </DrawerRail>
    </DrawerShell>
  );
}
