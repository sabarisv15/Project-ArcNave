import { useState } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import { OWNED_CLASS, TODAY_HOURS } from '../lib/classTutorData';
import { CLASS_TIMETABLE, SUBSTITUTE_REQUESTS, TIMETABLE_VERSIONS } from '../lib/classTimetableData';
import { ClassScopeHeader } from '../components/ClassScopeHeader';
import { WorkflowTimeline } from '../components/WorkflowTimeline';
import { NoAssignedClass, NoResults } from '../components/InstitutionalState';
import { PANE, STICKY_HEAD, TABLE_HEAD, StickyTableShell, TableEmptyState } from '../components/WorkspaceLayout';
import { cn } from '../lib/utils';

/**
 * Curriculum → Timetable, for the Class Tutor seat.
 *
 * The seat prepares and submits its class's timetable; it does not approve it.
 * That distinction is the screen: the lifecycle strip says where the draft is,
 * an approved version is marked **locked** rather than merely "done", and the
 * revision under review never replaces the version the class is actually
 * following — **the live timetable stays visible the entire time a revision is
 * pending**, because students and staff are still turning up to it.
 */

const TABS = [
  { key: 'timetable', label: 'Timetable' },
  { key: 'versions', label: 'Versions' },
  { key: 'substitutes', label: 'Substitutes' },
];

const STATUS_TONE = {
  draft: 'text-ink-muted bg-tint2',
  pending: 'text-pending bg-pending-soft',
  approved: 'text-success bg-success-soft',
  locked: 'text-success bg-success-soft',
  rejected: 'text-danger bg-danger-soft',
  acknowledged: 'text-success bg-success-soft',
  overdue: 'text-danger bg-danger-soft',
  requested: 'text-ink-muted bg-tint2',
};

const STATUS_LABEL = {
  draft: 'Draft',
  pending: 'Pending HOD review',
  approved: 'Approved',
  locked: 'Locked',
  rejected: 'Rejected',
  acknowledged: 'Acknowledged',
  overdue: 'Overdue follow-up',
  requested: 'Requested',
};

function Pill({ status }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[4px] h-[20px] px-[7px] rounded-[6px] text-[11px] font-[500]',
        STATUS_TONE[status]
      )}
    >
      {status === 'locked' && <Lock size={10} strokeWidth={2.1} aria-hidden="true" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const GRID_COLS = 'grid grid-cols-[64px_repeat(5,minmax(0,1fr))] gap-x-[8px] items-stretch px-[16px]';

function TimetableGrid({ version, revisionPending }) {
  return (
    <>
      {/*
        The notice belongs on the **live** timetable, not on the pending one.
        This tab always shows what the class is actually following; the fact
        that a revision is in review is context the reader needs *here*, since
        this is the grid they are about to act on. Keying it off the displayed
        version's own status meant it never appeared at all — the displayed
        version is approved by definition.
      */}
      {revisionPending && (
        <div className="flex-none flex items-start gap-[7px] mb-[10px] px-[11px] py-[8px] border border-line rounded-[12px] bg-pending-soft">
          <AlertTriangle size={13} strokeWidth={1.9} className="mt-[1px] flex-none text-pending" aria-hidden="true" />
          <p className="m-0 text-[12px] text-pending">
            {revisionPending.label} is with the HOD. Until it is approved, the class continues to follow the live
            timetable below.
          </p>
        </div>
      )}

      <StickyTableShell minWidth={820}>
        <div className={cn(GRID_COLS, STICKY_HEAD, TABLE_HEAD, 'h-[38px] items-center')}>
          <span>Hour</span>
          {DAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>

        {version.rows.map((row) => (
          <div key={row.hour} className={cn(GRID_COLS, 'border-t border-line-light py-[6px]')}>
            <span className="flex items-center text-[12px] text-ink-muted tabular-nums">{row.hour}</span>
            {DAYS.map((d) => {
              const cell = row.cells[d];
              return (
                <span key={d} className="min-w-0 rounded-[8px] bg-tint px-[8px] py-[6px]">
                  {cell ? (
                    <>
                      <span className="block text-[12px] text-ink truncate" title={cell.subject}>
                        {cell.subject}
                      </span>
                      <span className="block text-[11px] text-ink-faint truncate">{cell.staff}</span>
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
    </>
  );
}

const SUB_GRID = 'grid grid-cols-[120px_1.2fr_1.2fr_1fr_140px] gap-x-[12px] items-center px-[16px]';

function Substitutes() {
  if (SUBSTITUTE_REQUESTS.length === 0) {
    return (
      <StickyTableShell>
        <TableEmptyState
          title="No substitute requests for this class."
          hint="Requests raised for this class's periods will appear here."
        />
      </StickyTableShell>
    );
  }

  return (
    <>
      <StickyTableShell minWidth={800}>
        <div className={cn(SUB_GRID, STICKY_HEAD, TABLE_HEAD, 'h-[38px]')}>
          <span>Date</span>
          <span>Period</span>
          <span>Substitute</span>
          <span>Raised by</span>
          <span>Status</span>
        </div>

        {SUBSTITUTE_REQUESTS.map((r) => (
          <div key={r.id} className={cn(SUB_GRID, 'h-[50px] border-t border-line-light')}>
            <span className="text-[12.5px] text-ink tabular-nums">{r.date}</span>
            <span className="min-w-0">
              <span className="block text-[12.5px] text-ink truncate">{r.subject}</span>
              <span className="block text-[11px] text-ink-faint truncate">{r.slot}</span>
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] text-ink truncate">{r.substitute ?? 'Not assigned'}</span>
              {r.substitute && <span className="block text-[11px] text-ink-faint truncate">{r.substituteDept}</span>}
            </span>
            <span className="min-w-0 text-[12px] text-ink-muted truncate">{r.raisedBy}</span>
            <span>
              <Pill status={r.status} />
              {r.status === 'overdue' && (
                <span className="block mt-[1px] text-[10.5px] text-ink-faint">Not acknowledged in 24 h</span>
              )}
            </span>
          </div>
        ))}
      </StickyTableShell>

      {/*
        Said plainly rather than left as an absence. This screen shows what has
        been requested and where it stands; it does not claim to know who is
        free, because nothing here records staff availability.
      */}
      <p className="flex-none m-0 mt-[8px] text-[11.5px] text-ink-faint">
        Substitute availability is decided by the HOD — this seat raises the request and tracks its status.
      </p>
    </>
  );
}

export function ClassTimetableView() {
  const [tab, setTab] = useState('timetable');
  const [versionId, setVersionId] = useState(CLASS_TIMETABLE.liveVersionId);

  if (!OWNED_CLASS) {
    return (
      <div className={PANE}>
        <ClassScopeHeader cls={null} />
        <StickyTableShell>
          <NoAssignedClass />
        </StickyTableShell>
      </div>
    );
  }

  const version = TIMETABLE_VERSIONS.find((v) => v.id === versionId) ?? TIMETABLE_VERSIONS[0];
  const live = TIMETABLE_VERSIONS.find((v) => v.id === CLASS_TIMETABLE.liveVersionId);
  const revisionPending = TIMETABLE_VERSIONS.find((v) => v.status === 'pending') ?? null;

  return (
    <div className={PANE}>
      <ClassScopeHeader />

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
                  : 'text-ink-muted font-[500] hover:text-ink hover:bg-tint2'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {tab !== 'substitutes' && (
          <div className="flex items-center gap-[7px]">
            <span className="text-[11.5px] text-ink-faint">{version.label}</span>
            <Pill status={version.status} />
          </div>
        )}
      </div>

      {tab === 'timetable' && <TimetableGrid version={live} revisionPending={revisionPending} />}

      {tab === 'versions' && (
        <StickyTableShell minWidth={620}>
          <div className="grid grid-cols-[1.4fr_140px_1fr] gap-x-[12px] items-center px-[16px] h-[38px] sticky top-0 z-[46] bg-tint border-b border-line text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
            <span>Version</span>
            <span>Status</span>
            <span>Progress</span>
          </div>

          {TIMETABLE_VERSIONS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVersionId(v.id)}
              aria-pressed={v.id === versionId}
              className={cn(
                'w-full grid grid-cols-[1.4fr_140px_1fr] gap-x-[12px] items-start px-[16px] py-[11px] border-0 border-t border-line-light bg-transparent text-left cursor-pointer transition-colors duration-200 hover:bg-tint2',
                v.id === versionId && 'bg-accent-soft/40'
              )}
            >
              <span className="min-w-0">
                <span className="block text-[13px] text-ink truncate">{v.label}</span>
                <span className="block mt-[1px] text-[11px] text-ink-faint">
                  {v.id === CLASS_TIMETABLE.liveVersionId ? 'Currently followed by the class' : v.effectiveFrom}
                </span>
                {v.conflicts > 0 && (
                  <span className="mt-[4px] inline-flex items-center gap-[4px] text-[11.5px] text-danger">
                    <AlertTriangle size={11} strokeWidth={2} aria-hidden="true" />
                    {v.conflicts} unresolved conflict{v.conflicts > 1 ? 's' : ''}
                  </span>
                )}
              </span>
              <span>
                <Pill status={v.status} />
              </span>
              <span>
                <WorkflowTimeline steps={v.timeline} />
              </span>
            </button>
          ))}

          {TIMETABLE_VERSIONS.length === 0 && <NoResults what="versions" />}
        </StickyTableShell>
      )}

      {tab === 'substitutes' && <Substitutes />}

      {tab === 'timetable' && (
        <p className="flex-none m-0 mt-[8px] text-[11.5px] text-ink-faint">
          {TODAY_HOURS.length} teaching hours a day · this seat prepares and submits the timetable; the HOD reviews it and
          the Principal gives final approval.
        </p>
      )}
    </div>
  );
}
