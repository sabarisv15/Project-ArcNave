import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { DrawerRail, DrawerShell, GHOST_BTN, PRIMARY_BTN } from '@/components/ui/Drawer';
import { AuditHistory } from './AuditHistory';
import { cn } from '../lib/utils';

/**
 * Recording a scholarship eligibility decision.
 *
 * **The human decides.** That is not a policy note bolted onto the UI, it is
 * the layout: the decision control, the reason field and the recorded actor sit
 * in the primary column, and the AI advisory is one small labelled block that
 * can be read or ignored. Nothing is pre-selected from it, nothing is disabled
 * until it loads, and **an absent advisory changes nothing** — the drawer is
 * fully usable with no AI output at all, which is exactly what happens when the
 * service is down or has nothing to say.
 *
 * The advisory is also never phrased as a verdict. It lists what it looked at
 * and what that suggests; the word "eligible" belongs to the person deciding.
 */

const FIELD =
  'w-full font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]';

function Label({ children }) {
  return <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">{children}</div>;
}

/**
 * The advisory block. Deliberately small, deliberately labelled, deliberately
 * not colour-coded to a recommendation — it carries no green tick and no red
 * cross, because it is not making the call.
 */
function AiAdvisory({ advisory }) {
  if (!advisory) {
    return (
      <div className="border border-line rounded-[12px] bg-tint px-[12px] py-[9px]">
        <div className="flex items-center gap-[6px] text-[11.5px] text-ink-faint">
          <Sparkles size={12} strokeWidth={1.9} aria-hidden="true" />
          No AI advisory is available for this student.
        </div>
        <p className="m-0 mt-[3px] text-[11.5px] text-ink-faint">
          Record your decision as normal — the advisory is optional.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-line rounded-[12px] bg-tint px-[12px] py-[9px]">
      <div className="flex items-center gap-[6px]">
        <Sparkles size={12} strokeWidth={1.9} className="text-ink-faint" aria-hidden="true" />
        <span className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">AI advisory</span>
      </div>
      <ul className="m-0 mt-[6px] pl-[15px] text-[12.5px] text-ink-muted space-y-[2px]">
        {advisory.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="m-0 mt-[7px] text-[11.5px] text-ink-faint">
        Advisory only. The eligibility decision is yours and is recorded against your position.
      </p>
    </div>
  );
}

export function ScholarshipDecisionPanel({ student, advisory, decision, onClose, onRecord }) {
  const [eligible, setEligible] = useState(null);
  const [reason, setReason] = useState('');
  const [scheme, setScheme] = useState('State merit scholarship');

  useEffect(() => {
    setEligible(null);
    setReason('');
  }, [student?.id]);

  const alreadyDecided = !!decision;
  const canRecord = eligible !== null && reason.trim().length > 0;

  return (
    <DrawerShell
      open={!!student}
      onOpenChange={(o) => !o && onClose()}
      title="Scholarship eligibility"
      contextLine={student ? `${student.name} · Roll ${student.roll} · ${student.reg}` : ''}
      description="Record a scholarship eligibility decision"
      width="sm:w-[560px]"
    >
      {student && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] py-[14px] space-y-[14px]">
            {alreadyDecided ? (
              <div>
                <Label>Recorded decision</Label>
                <div className="mt-[5px]">
                  <AuditHistory
                    entries={[
                      {
                        action: decision.eligible ? 'Recorded as eligible' : 'Recorded as not eligible',
                        by: decision.by,
                        position: decision.position,
                        at: decision.at,
                        note: decision.reason,
                      },
                    ]}
                  />
                </div>
              </div>
            ) : (
              <>
                {/* The decision comes first — the advisory is reference, not the lead. */}
                <div>
                  <Label>Scheme</Label>
                  <input value={scheme} onChange={(e) => setScheme(e.target.value)} className={cn(FIELD, 'mt-[6px]')} />
                </div>

                <div>
                  <Label>Your decision</Label>
                  <div
                    role="radiogroup"
                    aria-label="Eligibility decision"
                    className="mt-[6px] flex items-center gap-[6px]"
                  >
                    {[
                      { value: true, label: 'Eligible' },
                      { value: false, label: 'Not eligible' },
                    ].map((o) => (
                      <button
                        key={o.label}
                        type="button"
                        role="radio"
                        aria-checked={eligible === o.value}
                        onClick={() => setEligible(o.value)}
                        className={cn(
                          'flex-none h-[32px] px-[13px] border rounded-[9px] font-sans text-[12.5px] cursor-pointer transition-colors duration-200',
                          eligible === o.value
                            ? 'border-accent-line bg-accent-soft text-accent font-[600]'
                            : 'border-line bg-paper text-ink-muted font-[500] hover:bg-tint2 hover:text-ink',
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label>Reason</Label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder="What you based this on (kept on the record)"
                    className={cn(FIELD, 'mt-[6px] resize-none')}
                  />
                  {/* Required, and said plainly rather than by a disabled button alone. */}
                  <p className="m-0 mt-[4px] text-[11.5px] text-ink-faint">
                    A reason is required — this decision is auditable.
                  </p>
                </div>
              </>
            )}

            <AiAdvisory advisory={advisory} />
          </div>

          {alreadyDecided ? (
            <DrawerRail
              meta={
                <span className="text-[11.5px] text-ink-faint">
                  Recorded decisions are changed through a correction.
                </span>
              }
            />
          ) : (
            <DrawerRail meta={<span className="text-[11.5px] text-ink-faint">Recorded as You · Class Tutor.</span>}>
              <button type="button" className={GHOST_BTN} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={canRecord ? PRIMARY_BTN : cn(PRIMARY_BTN, 'opacity-45 cursor-not-allowed')}
                disabled={!canRecord}
                onClick={() => onRecord(student.id, { eligible, reason, scheme })}
              >
                Record decision
              </button>
            </DrawerRail>
          )}
        </>
      )}
    </DrawerShell>
  );
}
