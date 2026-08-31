import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ALL_REQUESTS, REQUEST_KINDS } from '../lib/approvalsData';
import { OWNED_CLASS } from '../lib/classTutorData';
import { ClassScopeHeader } from '../components/ClassScopeHeader';
import { ApprovalInbox } from '../components/ApprovalInbox';
import { DecisionDrawer } from '../components/DecisionDrawer';
import { NoAssignedClass, NoResults } from '../components/InstitutionalState';
import { PANE, StickyTableShell } from '../components/WorkspaceLayout';
import { cn } from '../lib/utils';

/**
 * Curriculum → Approvals, for the Class Tutor seat.
 *
 * Two axes, deliberately separated: **Pending / Decided** is the primary split,
 * because "what needs me" and "what did I do" are different jobs; request type
 * is a filter within them, not a second set of tabs. A tutor's queue is small
 * enough that splitting it four ways by type would leave four near-empty lists.
 */

const VIEWS = [
  { key: 'pending', label: 'Pending' },
  { key: 'decided', label: 'Decided' },
];

const KIND_FILTERS = [
  { key: '', label: 'All types' },
  ...Object.entries(REQUEST_KINDS).map(([key, meta]) => ({ key, label: meta.short })),
];

export function ClassApprovalsView() {
  const [view, setView] = useState('pending');
  const [kind, setKind] = useState('');
  const [openId, setOpenId] = useState(null);
  // Decisions live here for the session so the queue actually responds to being
  // worked — the mock data stays the starting state, not a frozen one.
  const [decided, setDecided] = useState({});

  const requests = useMemo(
    () =>
      ALL_REQUESTS.map((r) => {
        const local = decided[r.id];
        if (!local) return r;
        return {
          ...r,
          status: local.outcome,
          decision: { by: 'You', position: 'Class Tutor', at: local.at, outcome: local.outcome, note: local.note },
          timeline: [
            ...r.timeline.filter((s) => s.state === 'done'),
            {
              label: local.outcome === 'approved' ? 'Approved' : 'Rejected',
              state: 'done',
              at: local.at,
              by: 'You',
            },
            ...(local.outcome === 'approved'
              ? [{ label: 'Applied to record', state: 'done', at: local.at, by: null }]
              : []),
          ],
        };
      }),
    [decided],
  );

  const visible = useMemo(
    () =>
      requests.filter((r) => {
        const isPending = r.status === 'pending';
        if (view === 'pending' && !isPending) return false;
        if (view === 'decided' && isPending) return false;
        if (kind && r.kind !== kind) return false;
        return true;
      }),
    [requests, view, kind],
  );

  const pendingCount = requests.filter((r) => r.status === 'pending').length;
  const open = openId ? requests.find((r) => r.id === openId) : null;

  function decide(id, outcome, note) {
    setDecided((prev) => ({ ...prev, [id]: { outcome, note, at: new Date() } }));
    setOpenId(null);
    toast.success(outcome === 'approved' ? 'Request approved' : 'Request rejected');
  }

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

  return (
    <div className={PANE}>
      <ClassScopeHeader />

      <div className="flex-none flex items-center gap-[8px] flex-wrap mb-[12px]">
        <h1 className="m-0 text-[17px] font-[600] tracking-[-.01em]">Approvals</h1>

        <div role="tablist" aria-label="Approval views" className="flex items-center gap-[4px] ml-[4px]">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={cn(
                'flex-none h-[27px] px-[10px] border-0 rounded-[8px] bg-transparent font-sans text-[12.5px] cursor-pointer transition-colors duration-200',
                view === v.key
                  ? 'bg-accent-soft text-accent font-[600]'
                  : 'text-ink-muted font-[500] hover:text-ink hover:bg-tint2',
              )}
            >
              {v.label}
              {v.key === 'pending' && pendingCount > 0 && (
                <span className="ml-[5px] text-[11px] tabular-nums text-ink-faint">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-[4px] flex-wrap">
          {KIND_FILTERS.map((k) => (
            <button
              key={k.key}
              type="button"
              aria-pressed={kind === k.key}
              onClick={() => setKind(k.key)}
              className={cn(
                'flex-none h-[26px] px-[9px] border rounded-[8px] font-sans text-[12px] cursor-pointer transition-colors duration-200',
                kind === k.key
                  ? 'border-accent-line bg-accent-soft text-accent font-[600]'
                  : 'border-line bg-paper text-ink-muted font-[500] hover:bg-tint2 hover:text-ink',
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <ApprovalInbox
        requests={visible}
        onOpen={setOpenId}
        emptyState={view === 'decided' ? <NoResults what="decided requests" /> : undefined}
      />

      <DecisionDrawer request={open} onClose={() => setOpenId(null)} onDecide={decide} />
    </div>
  );
}
