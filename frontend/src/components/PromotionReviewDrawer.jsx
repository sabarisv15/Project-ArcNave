import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Lock } from 'lucide-react';
import { DrawerRail, DrawerShell, GHOST_BTN, PRIMARY_BTN } from './AttendanceActionDrawer';
import { DEPARTMENT } from '../lib/departmentData';
import { PROMOTION_OUTCOMES, REVIEW_CONTEXT_NOTE, priorClassIndex, targetSectionsFor } from '../lib/promotionData';
import { LIFECYCLE_REJECTION, useInstitutionalLifecycle } from '../store/InstitutionalLifecycleProvider';
import { useAcademicTerm } from '../store/AcademicTermProvider';
import { cn } from '../lib/utils';

/**
 * One student's semester-transition decision.
 *
 * **Promotion is not automatic and this drawer is why.** An outcome is chosen,
 * the placement it would create is stated in full — which class, which section,
 * how many seats are left in it — and only then can it be confirmed. Nothing is
 * applied on selection. A queue that placed a cohort the moment it was opened
 * would quietly enrol students somebody was about to detain.
 *
 * **The four outcomes are four different things, and they read differently.**
 * Promote and Section change create a next-semester placement; Detain and
 * Transfer create none, and say so before the decision rather than after it.
 *
 * **The previous semester is history.** Everything above the decision is
 * read-only and rendered as read-only — the quiet grouped surface and the lock
 * glyph the class workspace already uses for a closed term — because nothing in
 * a closed semester can be changed by anyone, including the seat reviewing it.
 */

function Row({ label, value, hint }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-x-[12px] items-baseline py-[7px] border-t border-line-light first:border-t-0">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="m-0 text-[13px] text-ink">
        {value}
        {hint && <span className="block mt-[1px] text-[11.5px] text-ink-faint">{hint}</span>}
      </dd>
    </div>
  );
}

function OutcomePill({ outcome, className }) {
  const def = PROMOTION_OUTCOMES[outcome];
  if (!def) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
        def.tone,
        className,
      )}
    >
      {def.resultLabel}
    </span>
  );
}

export function PromotionReviewDrawer({ candidate, onClose }) {
  const { previewOutcome, confirmOutcome, reviewOf, reviews } = useInstitutionalLifecycle();
  const { priorClasses, activeClassById } = useAcademicTerm();

  const [outcome, setOutcome] = useState('promote');
  const [section, setSection] = useState('');
  const [note, setNote] = useState('');

  /*
   * The term's own prior classes and running classes, so a section offered here
   * is one the institution is actually running in the current term rather than
   * one it ran in the term this module was loaded in.
   */
  const priorClassById = useMemo(() => priorClassIndex(priorClasses), [priorClasses]);
  const resolvers = useMemo(() => ({ priorClassById, activeClassById }), [priorClassById, activeClassById]);

  const decided = candidate ? reviewOf(candidate.id) : null;
  const priorClass = candidate ? priorClassById[candidate.priorClassId] : null;
  const sections = useMemo(() => (candidate ? targetSectionsFor(candidate, resolvers) : []), [candidate, resolvers]);

  useEffect(() => {
    // A different student starts from their own recommendation, never from the
    // decision half-made about the last one.
    setOutcome(candidate?.recommendation === 'detain' ? 'detain' : 'promote');
    setSection(sections.find((s) => s.section !== candidate?.section)?.section ?? '');
    setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id]);

  const preview = useMemo(
    () => (candidate && !decided ? previewOutcome(candidate, outcome, section) : null),
    // `reviews` is a dependency because a decision taken elsewhere consumes the
    // capacity this preview is reporting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidate, outcome, section, decided, reviews, previewOutcome],
  );

  function confirm() {
    if (!candidate) return;
    const result = confirmOutcome(candidate, {
      outcome,
      section,
      note,
      scopeDepartmentId: DEPARTMENT.id,
    });

    if (!result.ok) {
      toast.error(LIFECYCLE_REJECTION[result.reason] ?? 'That decision could not be recorded.');
      return;
    }

    toast.success(`${PROMOTION_OUTCOMES[outcome].resultLabel} · ${candidate.name}`);
    onClose();
  }

  const definition = PROMOTION_OUTCOMES[outcome];
  const blocked = preview && !preview.ok;

  return (
    <DrawerShell
      open={!!candidate}
      onOpenChange={(o) => !o && onClose()}
      title={candidate?.name ?? ''}
      contextLine={candidate ? `${priorClass?.code ?? ''} · Roll ${candidate.roll} · ${candidate.reg}` : ''}
      description="Semester transition review"
      width="sm:w-[520px]"
    >
      {candidate && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] py-[14px] space-y-[14px]">
            <p className="m-0 text-[12px] text-ink-muted">{REVIEW_CONTEXT_NOTE}</p>

            {/* The closed semester, in the quieter language a closed record gets. */}
            <section
              aria-label="Previous semester"
              className="bg-tint border border-line rounded-[16px] px-[14px] py-[12px]"
            >
              <header className="flex items-center gap-[7px]">
                <Lock size={13} strokeWidth={1.9} aria-hidden="true" className="text-ink-faint" />
                <h3 className="m-0 text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                  Semester {candidate.semester} · closed
                </h3>
                <span className="text-[11px] text-ink-faint">read-only</span>
              </header>
              <dl className="m-0 mt-[4px]">
                <Row label="Attendance" value={`${candidate.attendance}%`} />
                <Row label="CGPA" value={candidate.cgpa} />
                <Row
                  label="Backlogs"
                  value={candidate.backlogCount === 0 ? 'None' : candidate.backlogCount}
                  hint={candidate.backlogCount >= 2 ? 'Two or more standing backlogs' : null}
                />
                <Row label="Fees" value={candidate.feeTier} />
              </dl>
            </section>

            {decided ? (
              <div>
                <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">Decision</div>
                <div className="mt-[6px]">
                  <OutcomePill outcome={decided.outcome} />
                </div>
                <dl className="m-0 mt-[6px]">
                  {decided.targetClassId ? (
                    <Row
                      label="Placed in"
                      value={decided.targetClassId}
                      hint={
                        decided.sectionChanged
                          ? `Section ${decided.fromSection} → ${decided.toSection}`
                          : `Section ${decided.toSection} · same section`
                      }
                    />
                  ) : (
                    <Row label="Placement" value="None created" hint={PROMOTION_OUTCOMES[decided.outcome].hint} />
                  )}
                  <Row
                    label="Student id"
                    value={decided.studentId}
                    hint="Unchanged by the transition — the same record throughout."
                  />
                  {decided.note && <Row label="Note" value={decided.note} />}
                </dl>
              </div>
            ) : (
              <>
                <div>
                  <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">Outcome</div>
                  <div role="radiogroup" aria-label="Promotion outcome" className="mt-[6px] grid grid-cols-2 gap-[6px]">
                    {Object.values(PROMOTION_OUTCOMES).map((def) => (
                      <button
                        key={def.key}
                        type="button"
                        role="radio"
                        aria-checked={outcome === def.key}
                        onClick={() => setOutcome(def.key)}
                        className={cn(
                          'text-left px-[10px] py-[8px] border rounded-[12px] bg-paper font-sans cursor-pointer transition-colors duration-200',
                          outcome === def.key ? 'border-accent-line bg-accent-soft' : 'border-line hover:bg-tint2',
                        )}
                      >
                        <span className="block text-[13px] font-[500] text-ink">{def.label}</span>
                        <span className="block mt-[2px] text-[11.5px] text-ink-faint">{def.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {outcome === 'section_change' && (
                  <div>
                    <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                      Target section
                    </div>
                    <select
                      value={section}
                      onChange={(e) => setSection(e.target.value)}
                      aria-label="Target section"
                      className="mt-[6px] w-full font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none focus:border-accent-line"
                    >
                      <option value="">Choose a section…</option>
                      {sections.map((t) => (
                        <option key={t.section} value={t.section}>
                          Section {t.section} — {t.code}
                        </option>
                      ))}
                    </select>
                    <p className="m-0 mt-[5px] text-[11.5px] text-ink-faint">
                      Only sections this department is actually running next semester are offered.
                    </p>
                  </div>
                )}

                {(outcome === 'detain' || outcome === 'transfer') && (
                  <div>
                    <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                      {outcome === 'transfer' ? 'Destination' : 'Reason'}
                    </div>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      aria-label={outcome === 'transfer' ? 'Destination' : 'Reason'}
                      placeholder={
                        outcome === 'transfer'
                          ? 'Where the student is going (recorded on the outcome)'
                          : 'Why the student is being detained (kept on the record)'
                      }
                      className="mt-[6px] w-full resize-none font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
                    />
                  </div>
                )}

                {/* What confirming would actually do, stated before it is done. */}
                <div>
                  <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                    Resulting placement
                  </div>
                  {definition.createsPlacement ? (
                    blocked ? (
                      <div className="mt-[6px] flex items-start gap-[7px] px-[11px] py-[8px] border border-line rounded-[12px] bg-danger-soft">
                        <AlertTriangle
                          size={13}
                          strokeWidth={1.9}
                          className="mt-[1px] flex-none text-danger"
                          aria-hidden="true"
                        />
                        <p className="m-0 text-[12px] text-danger">
                          {LIFECYCLE_REJECTION[preview.reason] ?? 'This placement cannot be made.'}
                        </p>
                      </div>
                    ) : (
                      <p className="m-0 mt-[5px] text-[13px] text-ink">
                        {preview?.target?.code}
                        <span className="block mt-[2px] text-[11.5px] text-ink-faint">
                          Semester {preview?.target?.semester} · section {preview?.target?.section} ·{' '}
                          {preview?.fill?.enrolled} of {preview?.fill?.capacity} filled, {preview?.fill?.headroom} free
                          · the student keeps id {candidate.id}
                        </span>
                      </p>
                    )
                  ) : (
                    <p className="m-0 mt-[5px] text-[13px] text-ink-muted">
                      {definition.hint}
                      <span className="block mt-[2px] text-[11.5px] text-ink-faint">
                        Their previous semester record stays readable and cannot be changed.
                      </span>
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {decided ? (
            <DrawerRail
              meta={
                <span className="text-[11.5px] text-ink-faint">
                  This decision has been recorded and cannot be taken again.
                </span>
              }
            />
          ) : (
            <DrawerRail
              meta={<span className="text-[11.5px] text-ink-faint">Nothing is applied until you confirm.</span>}
            >
              <button type="button" className={GHOST_BTN} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className={PRIMARY_BTN} onClick={confirm} disabled={blocked}>
                Confirm {definition.label.toLowerCase()}
              </button>
            </DrawerRail>
          )}
        </>
      )}
    </DrawerShell>
  );
}
