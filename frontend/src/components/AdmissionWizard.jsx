import { useMemo, useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { DrawerRail, DrawerShell, GHOST_BTN, PRIMARY_BTN } from '@/components/ui/Drawer';
import { AdmissionDocumentStep } from './AdmissionDocumentStep';
import {
  ADMISSION_FIELDS,
  ADMISSION_STEPS,
  confidenceBand,
  emptyAdmission,
  missingRequired,
} from '../lib/admissionData';
import { REJECTION, useAcademicRoster } from '@/features/institution';
import { OWNED_CLASS } from '../lib/classTutorData';
import { cn } from '../lib/utils';

/**
 * Admitting one genuinely new student into this class.
 *
 * **Documents → Details → Confirm → Complete**, and the sequence is the design.
 * The extraction on step one proposes; step two is where a human corrects it;
 * step three states exactly what will be created, including the class it will
 * be created in; step four confirms it exists. A flow that collapsed two and
 * three would be asking someone to approve a record they have only seen as
 * form inputs.
 *
 * **A valid submit activates the student immediately.** There is no approval
 * queue after it — a Class Tutor admitting a new student into their own class
 * *is* the decision, not a request for one. What the submit is bounded by is
 * the section's provisioned capacity and a duplicate check against everyone
 * already placed in the class, both applied by the shared roster layer so this
 * wizard and the bulk import cannot drift apart on what "already here" means.
 *
 * **The scope is fixed and not editable.** Department, academic year, semester
 * and section are the seat's own and are shown as context rather than asked
 * for — a form that let a tutor type a section would be offering a scope they
 * do not have.
 */

const FIELD =
  'w-full font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]';

function Steps({ index }) {
  return (
    <ol className="m-0 p-0 list-none flex items-center gap-[6px] flex-wrap">
      {ADMISSION_STEPS.map((step, i) => (
        <li key={step.key} className="flex items-center gap-[6px]">
          {i > 0 && (
            <span aria-hidden="true" className="text-ink-ghost text-[11px]">
              →
            </span>
          )}
          <span
            className={cn(
              'inline-flex items-center gap-[5px] h-[22px] px-[8px] rounded-[7px] text-[11.5px]',
              i === index
                ? 'bg-accent-soft text-accent font-[600]'
                : i < index
                  ? 'bg-tint2 text-ink-soft font-[500]'
                  : 'text-ink-faint',
            )}
            aria-current={i === index ? 'step' : undefined}
          >
            {i < index && <Check size={11} strokeWidth={2.4} aria-hidden="true" />}
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ScopeContext() {
  return (
    <div className="px-[12px] py-[9px] rounded-[12px] bg-tint border border-line">
      <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">Admitting into</div>
      <div className="mt-[4px] text-[12.5px] text-ink">
        {OWNED_CLASS.dept} · {OWNED_CLASS.code} · Semester {OWNED_CLASS.semester} · AY {OWNED_CLASS.academicYear}
      </div>
      <div className="mt-[2px] text-[11.5px] text-ink-faint">
        This position admits into its own class only — the class cannot be changed here.
      </div>
    </div>
  );
}

export function AdmissionWizard({ open, onOpenChange, onAdmitted }) {
  const { admitStudent, classFill, validateAdmission } = useAcademicRoster();
  const [stepIndex, setStepIndex] = useState(0);
  const [files, setFiles] = useState([]);
  const [extraction, setExtraction] = useState(null);
  const [values, setValues] = useState(emptyAdmission);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  const fill = classFill(OWNED_CLASS.id);
  const step = ADMISSION_STEPS[stepIndex];
  const missing = missingRequired(values);

  /**
   * The same check the submit will apply, run live on the Confirm step so a
   * capacity or duplicate problem is visible *before* the button rather than
   * as a failure after it.
   */
  const precheck = useMemo(
    () => (stepIndex === 2 ? validateAdmission(OWNED_CLASS.id, values) : { ok: true }),
    [stepIndex, validateAdmission, values],
  );

  function reset() {
    setStepIndex(0);
    setFiles([]);
    setExtraction(null);
    setValues(emptyAdmission());
    setError(null);
    setCreated(null);
  }

  function close(next) {
    onOpenChange(next);
    if (!next) reset();
  }

  function applyExtraction(next) {
    setExtraction(next);
    // Proposals only, and only into fields the user has not already typed in —
    // an extraction must never overwrite something a person entered.
    setValues((prev) => {
      const merged = { ...prev };
      Object.entries(next.values).forEach(([key, value]) => {
        if (value && !String(prev[key] ?? '').trim()) merged[key] = value;
      });
      return merged;
    });
  }

  function submit() {
    const outcome = admitStudent(OWNED_CLASS.id, values, {
      scopeClassId: OWNED_CLASS.id,
      origin: 'admitted',
      // Documents supplied during the wizard clear the pending state; skipping
      // the upload leaves it set, which is a follow-up rather than a hold.
      documentsPending: files.length === 0,
    });

    if (!outcome.ok) {
      setError(outcome);
      return;
    }
    setCreated(outcome.student);
    setError(null);
    setStepIndex(3);
    onAdmitted?.(outcome.student);
  }

  const canContinue = stepIndex === 0 ? true : stepIndex === 1 ? missing.length === 0 : precheck.ok;

  return (
    <DrawerShell
      open={open}
      onOpenChange={close}
      title="Add student"
      contextLine={`${OWNED_CLASS.code} · ${fill.enrolled} of ${fill.capacity} seats filled`}
      width="sm:w-[560px]"
    >
      <div className="flex-1 min-h-0 overflow-auto scroll-quiet px-[18px] py-[15px] flex flex-col gap-[14px]">
        <Steps index={stepIndex} />
        <p className="m-0 text-[12px] text-ink-faint">{step.caption}</p>

        {stepIndex !== 3 && <ScopeContext />}

        {stepIndex === 0 && (
          <AdmissionDocumentStep
            files={files}
            extraction={extraction}
            onAdd={(f) => setFiles((prev) => [...prev.filter((x) => x.kind !== f.kind), f])}
            onRemove={(kind) => setFiles((prev) => prev.filter((x) => x.kind !== kind))}
            onExtract={applyExtraction}
          />
        )}

        {stepIndex === 1 && (
          <div className="flex flex-col gap-[11px]">
            {extraction && (
              <p className="m-0 text-[12px] text-ink-muted">
                Values proposed by the prototype extraction are filled in below. Check every one — nothing has been
                saved yet.
              </p>
            )}
            {ADMISSION_FIELDS.map((f) => {
              const band = extraction ? confidenceBand(extraction.confidence?.[f.key]) : null;
              return (
                <label key={f.key} htmlFor={`admission-${f.key}`} className="block">
                  <span className="block mb-[5px] text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                    {f.label}
                    {f.required && <span className="text-danger"> *</span>}
                  </span>
                  <input
                    id={`admission-${f.key}`}
                    type={f.type}
                    className={FIELD}
                    value={values[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                  {band && (
                    <span className={cn('block mt-[4px] text-[11px]', band.tone)}>Extraction: {band.label}</span>
                  )}
                  {f.hint && <span className="block mt-[3px] text-[11px] text-ink-faint">{f.hint}</span>}
                </label>
              );
            })}
          </div>
        )}

        {stepIndex === 2 && (
          <div className="flex flex-col gap-[10px]">
            <div className="border border-line rounded-[12px] overflow-hidden">
              <div className="px-[12px] py-[7px] bg-tint border-b border-line text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                Will be created
              </div>
              <dl className="m-0 p-0">
                {ADMISSION_FIELDS.map((f) => (
                  <div
                    key={f.key}
                    className="grid grid-cols-[140px_1fr] gap-x-[12px] px-[12px] py-[7px] border-t border-line-light first:border-t-0"
                  >
                    <dt className="m-0 text-[12px] text-ink-faint">{f.label}</dt>
                    <dd className="m-0 text-[12.5px] text-ink">
                      {String(values[f.key] ?? '').trim() || <span className="text-ink-faint">—</span>}
                    </dd>
                  </div>
                ))}
                <div className="grid grid-cols-[140px_1fr] gap-x-[12px] px-[12px] py-[7px] border-t border-line-light">
                  <dt className="m-0 text-[12px] text-ink-faint">Documents</dt>
                  <dd className="m-0 text-[12.5px] text-ink">
                    {files.length > 0 ? `${files.length} uploaded` : 'None — will be marked Documents pending'}
                  </dd>
                </div>
              </dl>
            </div>

            {!precheck.ok && (
              <p className="m-0 flex items-start gap-[6px] text-[12px] text-danger">
                <AlertCircle size={13} strokeWidth={2} aria-hidden="true" className="mt-[2px] flex-none" />
                {REJECTION[precheck.reason]}
                {precheck.reason === 'missing_field' && ` (${precheck.detail})`}
              </p>
            )}

            <p className="m-0 text-[12px] text-ink-muted">
              Submitting activates this student in {OWNED_CLASS.code} straight away. There is no approval step after it.
            </p>
          </div>
        )}

        {stepIndex === 3 && created && (
          <div className="flex flex-col gap-[10px]">
            <div className="flex items-center gap-[7px] text-[13px] text-ink">
              <Check size={15} strokeWidth={2.2} aria-hidden="true" className="text-success" />
              <span>
                <span className="font-[500]">{created.name}</span> is active in {OWNED_CLASS.code}.
              </span>
            </div>
            <div className="px-[12px] py-[9px] rounded-[12px] bg-tint border border-line text-[12px] text-ink-muted">
              Roll {created.roll} · {created.reg}
              {created.documentsPending && ' · Documents pending'}
            </div>
            <p className="m-0 text-[12px] text-ink-faint">
              They appear in the class roster now, and count against the section's {fill.capacity} provisioned seats.
            </p>
          </div>
        )}

        {error && stepIndex !== 3 && (
          <p className="m-0 text-[12px] text-danger">
            {REJECTION[error.reason]}
            {error.reason === 'missing_field' && ` (${error.detail})`}
          </p>
        )}
      </div>

      <DrawerRail
        meta={
          stepIndex === 1 && missing.length > 0 ? (
            <span className="text-ink-faint">Required: {missing.join(', ')}</span>
          ) : null
        }
      >
        {stepIndex === 3 ? (
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
              disabled={!canContinue}
              onClick={() => (stepIndex === 2 ? submit() : setStepIndex((i) => i + 1))}
            >
              {stepIndex === 2 ? 'Admit student' : 'Continue'}
            </button>
          </>
        )}
      </DrawerRail>
    </DrawerShell>
  );
}
