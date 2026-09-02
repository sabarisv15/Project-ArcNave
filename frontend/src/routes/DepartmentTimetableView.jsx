import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Lock } from 'lucide-react';
import { DEPARTMENT, DEPT_CLASSES } from '../lib/departmentData';
import { facultyName } from '../lib/departmentSignals';
import {
  CONFLICTS,
  CONFLICT_LABELS,
  DAYS,
  HOURS,
  HOUR_SLOTS,
  LIVE_VERSION,
  LIVE_VERSION_ID,
  TIMETABLE_VERSIONS,
  findConflicts,
} from '../lib/departmentTimetableData';
import {
  ENDORSEMENT_STATES,
  canEndorse,
  chainProgress,
  endorsedStateFor,
  endorsementStateOf,
  nextSeatFor,
} from '../lib/endorsementChain';
import { HAS_LEVEL_2 } from '../lib/provisioning';
import { seatTitle } from '../lib/seatTitles';
import { HOD_L3, LEVEL_2, PRINCIPAL_L1 } from '../lib/roles';
import { DepartmentScopeHeader } from '../components/DepartmentScopeHeader';
import { WorkflowTimeline } from '../components/WorkflowTimeline';
import { DrawerRail, DrawerShell, GHOST_BTN, PRIMARY_BTN } from '@/components/ui/Drawer';
import { NoAssignedDepartment, NoConflicts, NoResults, NoTimetable } from '../components/InstitutionalState';
import { PANE, STICKY_HEAD, TABLE_HEAD, StickyTableShell } from '../components/WorkspaceLayout';
import { cn } from '../lib/utils';

/**
 * Department → Timetable.
 *
 * Not the class timetable with a bigger title. The things only this seat can
 * see are **across** classes: one faculty member timetabled to two rooms at
 * once, two classes sent to the same lab, a period with a subject and nobody on
 * it. So the grid is the whole department in one view — a day at a time, classes
 * as rows — and the Conflicts tab is a first-class destination rather than a
 * warning strip.
 *
 * The rule that governs the screen: **a pending revision never replaces the live
 * timetable.** Six classes are turning up to the locked version today, so the
 * Current tab always shows that, and the revision under review is visible as
 * something waiting on a decision, not as the timetable.
 */

const TABS = [
  { key: 'current', label: 'Current timetable' },
  { key: 'revisions', label: 'Revisions' },
  { key: 'conflicts', label: 'Conflicts' },
];

/**
 * A revision's state in the approval chain.
 *
 * The vocabulary is deliberately not the old one. "Approved" used to appear here
 * the moment a Head of Department signed off, which is the one word this seat
 * may not produce: an endorsed revision is *on its way somewhere*, and until the
 * final approval lands the department is still running the timetable it already
 * had. Every state and its wording lives in `endorsementChain.js`, so what this
 * screen may claim is settled once rather than by a label map per page.
 */
function Pill({ state }) {
  const def = ENDORSEMENT_STATES[state] ?? ENDORSEMENT_STATES.draft;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[4px] h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
        def.tone,
      )}
    >
      {state === 'approved_locked' && <Lock size={10} strokeWidth={2.1} aria-hidden="true" />}
      {def.label}
    </span>
  );
}

/**
 * The chain this revision travels, with the seat it is waiting on marked.
 *
 * Built from the provisioning, so an institution with a delegated seat renders
 * three steps and one without renders two — and no screen has to know that the
 * middle step is optional.
 */
function Chain({ state }) {
  const steps = chainProgress(state);
  return (
    <ol className="m-0 p-0 list-none flex flex-wrap items-center gap-x-[6px] gap-y-[3px]">
      {steps.map((step, i) => (
        <li key={step.key} className="flex items-center gap-[6px]">
          {i > 0 && <span className="text-ink-faint">→</span>}
          <span
            className={cn(
              'text-[11.5px]',
              step.state === 'current'
                ? 'text-accent font-[500]'
                : step.state === 'done'
                  ? 'text-ink-muted'
                  : 'text-ink-faint',
            )}
          >
            {step.title}
          </span>
        </li>
      ))}
    </ol>
  );
}

/*
 * Classes as rows, hours as columns, one day at a time. A single grid holding
 * all five days would be 30 columns wide — unreadable at any width and
 * unusable below a desktop. The day switch costs one control and keeps the
 * cross-class reading, which is the only reason this view exists.
 */
const GRID = 'grid grid-cols-[126px_repeat(5,minmax(0,1fr))] gap-x-[8px] items-stretch px-[16px]';

function DepartmentGrid({ version, day, conflicts }) {
  const conflictAt = (classId, hour) =>
    conflicts.find((c) => c.day === day && c.hour === hour && c.classIds.includes(classId));

  return (
    <StickyTableShell minWidth={860}>
      <div className={cn(GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px] items-center')}>
        <span>Class</span>
        {HOURS.map((h) => (
          <span key={h} className="truncate" title={HOUR_SLOTS[h]}>
            Hour {h}
          </span>
        ))}
      </div>

      {DEPT_CLASSES.map((cls) => (
        <div key={cls.id} className={cn(GRID, 'border-t border-line-light py-[6px]')}>
          <span className="flex items-center min-w-0 text-[12px] text-ink truncate" title={cls.code}>
            {cls.code}
          </span>

          {HOURS.map((hour) => {
            const cell = version.cells.find((c) => c.classId === cls.id && c.day === day && c.hour === hour);
            const clash = conflictAt(cls.id, hour);

            return (
              <span
                key={hour}
                title={
                  clash
                    ? clash.detail
                    : cell
                      ? `${cell.subject} · ${facultyName(cell.facultyId)} · ${cell.room}`
                      : 'Free period'
                }
                className={cn(
                  'min-w-0 rounded-[8px] px-[8px] py-[6px] border',
                  clash ? 'bg-warning-soft border-warning/30' : 'bg-tint border-transparent',
                )}
              >
                {cell ? (
                  <>
                    <span className="block text-[12px] text-ink truncate">{cell.subject}</span>
                    <span
                      className={cn(
                        'block text-[11px] truncate',
                        cell.facultyId ? 'text-ink-faint' : 'text-danger font-[500]',
                      )}
                    >
                      {cell.facultyId ? facultyName(cell.facultyId) : 'Unassigned'}
                    </span>
                    <span className="block text-[10.5px] text-ink-faint truncate tabular-nums">{cell.room}</span>
                  </>
                ) : (
                  <span className="block text-[11.5px] text-ink-faint">—</span>
                )}
              </span>
            );
          })}
        </div>
      ))}
    </StickyTableShell>
  );
}

const CONFLICT_GRID =
  'grid grid-cols-[minmax(0,130px)_112px_minmax(0,1.6fr)_minmax(0,1fr)] gap-x-[12px] items-center px-[16px]';

function ConflictsTab({ conflicts }) {
  if (conflicts.length === 0) {
    return (
      <StickyTableShell>
        <NoConflicts />
      </StickyTableShell>
    );
  }

  return (
    <>
      <StickyTableShell minWidth={720}>
        <div className={cn(CONFLICT_GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
          <span>Type</span>
          <span>When</span>
          <span>What is wrong</span>
          <span>Classes affected</span>
        </div>

        {conflicts.map((c) => (
          <div key={c.id} className={cn(CONFLICT_GRID, 'py-[9px] border-t border-line-light')}>
            <span className="min-w-0">
              <span
                className={cn(
                  'inline-flex items-center h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
                  c.kind === 'unassigned_period' ? 'text-danger bg-danger-soft' : 'text-pending bg-pending-soft',
                )}
              >
                {CONFLICT_LABELS[c.kind]}
              </span>
            </span>

            <span className="text-[12.5px] text-ink-muted tabular-nums">
              {c.day} · Hour {c.hour}
              <span className="block text-[11px] text-ink-faint">{HOUR_SLOTS[c.hour]}</span>
            </span>

            {/*
              The cause, not a count. "1 conflict" tells an HOD nothing they can
              act on; naming the person, the room and the slot does.
            */}
            <span className="min-w-0 text-[12.5px] text-ink">{c.detail}</span>

            <span className="min-w-0 text-[12px] text-ink-muted truncate">
              {c.classIds.map((id) => DEPT_CLASSES.find((cls) => cls.id === id)?.code ?? id).join(' · ')}
            </span>
          </div>
        ))}
      </StickyTableShell>

      <p className="flex-none m-0 mt-[8px] text-[11.5px] text-ink-faint">
        Conflicts are found by checking the live timetable, not recorded against it — resolving one requires an approved
        revision.
      </p>
    </>
  );
}

const VERSION_GRID =
  'grid grid-cols-[minmax(0,1.5fr)_minmax(0,150px)_minmax(0,1fr)] gap-x-[12px] items-start px-[16px]';

function RevisionsTab({ versions, onOpen }) {
  if (versions.length === 0)
    return (
      <StickyTableShell>
        <NoResults what="revisions" />
      </StickyTableShell>
    );

  return (
    <StickyTableShell minWidth={680}>
      <div className={cn(VERSION_GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px] items-center')}>
        <span>Version</span>
        <span>Status</span>
        <span>Progress</span>
      </div>

      {versions.map((v) => {
        const conflictCount = findConflicts(v.cells).length;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onOpen(v.id)}
            aria-label={`${v.label} — open revision`}
            className={cn(
              VERSION_GRID,
              'w-full py-[11px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
            )}
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink truncate">{v.label}</span>
              <span className="block mt-[1px] text-[11px] text-ink-faint truncate">
                {v.id === LIVE_VERSION_ID ? 'Currently followed by the department' : v.effectiveFrom}
              </span>
              <span className="block mt-[1px] text-[11px] text-ink-faint truncate">{v.submittedBy}</span>
              {conflictCount > 0 && (
                <span className="mt-[4px] inline-flex items-center gap-[4px] text-[11.5px] text-danger">
                  <AlertTriangle size={11} strokeWidth={2} aria-hidden="true" />
                  {conflictCount} unresolved conflict{conflictCount > 1 ? 's' : ''}
                </span>
              )}
            </span>

            <span>
              <Pill state={v.endorsement} />
              <span className="block mt-[4px]">
                <Chain state={v.endorsement} />
              </span>
            </span>

            <span>
              <WorkflowTimeline steps={v.timeline} />
            </span>
          </button>
        );
      })}
    </StickyTableShell>
  );
}

/**
 * Deciding a submitted revision.
 *
 * Same shape as the approvals drawer on purpose — progress, then what it would
 * change, then the decision — because it is the same kind of act. A decided
 * revision keeps the drawer and loses the action rail.
 */
function RevisionDrawer({ version, decision, onClose, onDecide }) {
  const [note, setNote] = useState('');
  const conflicts = version ? findConflicts(version.cells) : [];
  /*
   * A conflicted revision is not endorsable. Sending a grid that puts one person
   * in two rooms onward for approval makes the clash somebody else's problem
   * without making it any less wrong — so the rail loses its action and says
   * why, rather than offering a button whose result would have to be undone.
   */
  const canDecide = version ? canEndorse(version.endorsement) && !decision : false;
  const decided = decision ?? (version && !canDecide && version.endorsement !== 'conflict_identified' ? version : null);

  return (
    <DrawerShell
      open={!!version}
      onOpenChange={(o) => !o && onClose()}
      title={version?.label ?? ''}
      contextLine={version ? `${DEPARTMENT.short} Department · ${version.submittedBy}` : ''}
      description="Timetable revision"
      width="sm:w-[520px]"
    >
      {version && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] py-[14px] space-y-[14px]">
            <div className="flex items-center gap-[8px] flex-wrap">
              <Pill state={version.endorsement} />
              <span className="text-[11.5px] text-ink-faint">{version.effectiveFrom}</span>
            </div>

            <div>
              <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">Approval chain</div>
              <div className="mt-[6px]">
                <Chain state={version.endorsement} />
              </div>
              <p className="m-0 mt-[5px] text-[11.5px] text-ink-faint">
                {ENDORSEMENT_STATES[version.endorsement]?.hint}
              </p>
            </div>

            <div>
              <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
                Conflicts in this version
              </div>
              {conflicts.length === 0 ? (
                <p className="m-0 mt-[5px] text-[13px] text-ink">
                  None — this version schedules every class without a clash.
                </p>
              ) : (
                <ul className="m-0 mt-[6px] p-0 list-none">
                  {conflicts.map((c) => (
                    <li key={c.id} className="py-[6px] border-t border-line-light first:border-t-0">
                      <div className="text-[12.5px] text-ink">{c.detail}</div>
                      <div className="mt-[1px] text-[11.5px] text-ink-faint">
                        {CONFLICT_LABELS[c.kind]} · {c.day} Hour {c.hour}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">Progress</div>
              <div className="mt-[7px]">
                <WorkflowTimeline steps={version.timeline} />
              </div>
            </div>

            {canDecide && (
              <div>
                <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">Note</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  aria-label="Endorsement note"
                  placeholder="Why you are endorsing or rejecting (kept on the record)"
                  className="mt-[6px] w-full resize-none font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
                />
              </div>
            )}

            {decision && (
              <div>
                <div className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">Decision</div>
                {/*
                  Never "Approved". What this seat did was endorse, and the line
                  says where that sent it — the next seat on the chain, which is
                  the delegated one when the institution has it and the
                  institution head when it does not.
                */}
                <div className="mt-[4px] text-[12.5px] text-ink">
                  {decision.outcome === 'endorsed'
                    ? `Endorsed — now with ${nextSeatFor(endorsedStateFor())}`
                    : 'Rejected'}
                </div>
                <div className="mt-[1px] text-[11.5px] text-ink-faint">
                  You · {seatTitle(HOD_L3)} ·{' '}
                  {decision.at.toLocaleString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </div>
                {decision.note && <div className="mt-[3px] text-[12px] text-ink-muted">{decision.note}</div>}
              </div>
            )}
          </div>

          {canDecide ? (
            <DrawerRail
              meta={
                <span className="text-[11.5px] text-ink-faint">
                  Endorsement is not final approval — it routes this revision to {nextSeatFor(endorsedStateFor())}.
                </span>
              }
            >
              <button type="button" className={GHOST_BTN} onClick={() => onDecide(version.id, 'rejected', note)}>
                Reject
              </button>
              <button type="button" className={PRIMARY_BTN} onClick={() => onDecide(version.id, 'endorsed', note)}>
                Endorse
              </button>
            </DrawerRail>
          ) : (
            <DrawerRail
              meta={
                <span className="text-[11.5px] text-ink-faint">
                  {version.endorsement === 'conflict_identified'
                    ? 'This revision cannot be endorsed until its conflicts are resolved.'
                    : decided
                      ? 'This revision has been decided and can no longer be changed here.'
                      : 'A draft is decided once its author submits it for review.'}
                </span>
              }
            />
          )}
        </>
      )}
    </DrawerShell>
  );
}

export function DepartmentTimetableView() {
  const [tab, setTab] = useState('current');
  const [day, setDay] = useState(DAYS[0]);
  const [openId, setOpenId] = useState(null);
  const [decisions, setDecisions] = useState({});

  const versions = useMemo(
    () =>
      TIMETABLE_VERSIONS.map((v) => {
        const local = decisions[v.id];
        const base = { ...v, endorsement: endorsementStateOf(v, { liveVersionId: LIVE_VERSION_ID }) };
        if (!local) return base;

        /*
         * An endorsement never lands on "approved". It moves the revision to the
         * next seat on the chain — the delegated one when the institution
         * provisioned it, the institution head when it did not — and the
         * timeline says which, rather than implying the decision is finished.
         */
        const endorsed = local.outcome === 'endorsed';
        return {
          ...base,
          status: endorsed ? 'endorsed' : 'rejected',
          endorsement: endorsed ? endorsedStateFor() : 'rejected',
          timeline: [
            ...v.timeline.filter((s) => s.state === 'done'),
            {
              label: endorsed ? `Endorsed by ${seatTitle(HOD_L3)}` : 'Rejected',
              state: 'done',
              at: local.at,
              by: 'You',
            },
            ...(endorsed
              ? [
                  ...(HAS_LEVEL_2
                    ? [{ label: `${seatTitle(LEVEL_2)} review`, state: 'current', at: null, by: null }]
                    : []),
                  {
                    label: `${seatTitle(PRINCIPAL_L1)} final approval`,
                    state: HAS_LEVEL_2 ? 'pending' : 'current',
                    at: null,
                    by: null,
                  },
                  { label: 'Locked', state: 'pending', at: null, by: null },
                ]
              : []),
          ],
        };
      }),
    [decisions],
  );

  /*
   * The live version is read from the untouched source, not from `versions`.
   * Endorsing a revision in this prototype sends it on — it does not make it
   * live, and the department is still following the locked version until the
   * final approval lands. Reading the live grid from the decision-aware list
   * would quietly swap the timetable on endorsement, which is exactly the thing
   * this screen exists to prevent.
   */
  const pendingRevision = versions.find((v) => canEndorse(v.endorsement)) ?? null;
  const open = openId ? versions.find((v) => v.id === openId) : null;

  function decide(id, outcome, note) {
    setDecisions((prev) => ({ ...prev, [id]: { outcome, note, at: new Date() } }));
    setOpenId(null);
    toast.success(
      outcome === 'endorsed' ? `Revision endorsed — sent to ${nextSeatFor(endorsedStateFor())}` : 'Revision rejected',
    );
  }

  if (!DEPARTMENT) {
    return (
      <div className={PANE}>
        <DepartmentScopeHeader dept={null} />
        <StickyTableShell>
          <NoAssignedDepartment />
        </StickyTableShell>
      </div>
    );
  }

  return (
    <div className={PANE}>
      <DepartmentScopeHeader />

      <div className="flex-none flex items-center gap-[8px] flex-wrap mb-[12px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Timetable</h1>

        <div role="tablist" aria-label="Timetable views" className="flex items-center gap-[4px] ml-[4px]">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex-none h-[27px] px-[10px] border-0 rounded-[8px] bg-transparent font-sans text-[12.5px] cursor-pointer transition-colors duration-200',
                tab === t.key
                  ? 'bg-accent-soft text-accent font-[600]'
                  : 'text-ink-muted font-[500] hover:text-ink hover:bg-tint2',
              )}
            >
              {t.label}
              {t.key === 'conflicts' && CONFLICTS.length > 0 && (
                <span className="ml-[5px] text-[11px] tabular-nums text-ink-faint">{CONFLICTS.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {tab === 'current' && (
          <div role="tablist" aria-label="Day" className="flex items-center gap-[3px] flex-wrap">
            {DAYS.map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={day === d}
                onClick={() => setDay(d)}
                className={cn(
                  'flex-none h-[26px] px-[9px] border rounded-[8px] font-sans text-[12px] cursor-pointer transition-colors duration-200',
                  day === d
                    ? 'border-accent-line bg-accent-soft text-accent font-[600]'
                    : 'border-line bg-paper text-ink-muted font-[500] hover:bg-tint2 hover:text-ink',
                )}
              >
                {d}
              </button>
            ))}
          </div>
        )}

        {tab === 'current' && (
          <div className="flex items-center gap-[7px]">
            <span className="text-[11.5px] text-ink-faint">{LIVE_VERSION.label}</span>
            <Pill state="approved_locked" />
          </div>
        )}
      </div>

      {tab === 'current' && (
        <>
          {/*
            The notice belongs on the **live** timetable, not on the pending one.
            This tab always shows what the department is actually following; that
            a revision is in review is context the reader needs right here, since
            this is the grid they are about to act on.
          */}
          {pendingRevision && (
            <div className="flex-none flex items-start gap-[7px] mb-[10px] px-[11px] py-[8px] border border-line rounded-[12px] bg-pending-soft">
              <AlertTriangle
                size={13}
                strokeWidth={1.9}
                className="mt-[1px] flex-none text-pending"
                aria-hidden="true"
              />
              <p className="m-0 text-[12px] text-pending">
                {pendingRevision.label} is waiting on your endorsement. Endorsing it sends it to{' '}
                {nextSeatFor(endorsedStateFor())} — until it is finally approved and locked, every class continues to
                follow the live timetable below.
              </p>
            </div>
          )}

          {LIVE_VERSION ? (
            <DepartmentGrid version={LIVE_VERSION} day={day} conflicts={CONFLICTS} />
          ) : (
            <StickyTableShell>
              <NoTimetable />
            </StickyTableShell>
          )}

          <p className="flex-none m-0 mt-[8px] text-[11.5px] text-ink-faint">
            {DEPT_CLASSES.length} classes · {HOURS.length} teaching hours a day · highlighted slots carry a conflict.
          </p>
        </>
      )}

      {tab === 'revisions' && <RevisionsTab versions={versions} onOpen={setOpenId} />}

      {tab === 'conflicts' && <ConflictsTab conflicts={CONFLICTS} />}

      <RevisionDrawer
        version={open}
        decision={openId ? (decisions[openId] ?? null) : null}
        onClose={() => setOpenId(null)}
        onDecide={decide}
      />
    </div>
  );
}
