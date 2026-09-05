import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { INST_REQUESTS, INST_REQUEST_KINDS, INST_TABS } from '../lib/institutionApprovalsData';
import { InstitutionScopeHeader } from '../components/InstitutionScopeHeader';
import { ApprovalInbox } from '../components/ApprovalInbox';
import { DecisionDrawer } from '../components/DecisionDrawer';
import { NoResults, NothingToEndorse } from '../components/InstitutionalState';
import { PANE } from '../components/WorkspaceLayout';
import { cn } from '../lib/utils';

/**
 * Institution → Approvals.
 *
 * Two axes, deliberately separated. **Pending / Decided** is the primary split,
 * because "what needs me" and "what did I do" are different jobs; request type is
 * a set of tabs within them, because a Principal's queue is genuinely mixed — an
 * endorsed timetable revision and a leadership appointment have nothing to do
 * with each other and are never worked in the same sitting.
 *
 * What is **not** here is as deliberate as what is: routine attendance, marks and
 * fee corrections stay with the class tutor, and substitutes, publications and
 * in-department allocation stay with the head of department. Only what a
 * department has already endorsed, or cannot settle by itself, reaches this seat.
 *
 * The shared `ApprovalInbox` and `DecisionDrawer` are reused as-is, with this
 * seat's own `kinds` map passed in rather than merged into theirs.
 *
 * **Approving a revision does not make it live.** The endorsement moves it to the
 * next step of its own workflow — `Locked` — and the department's live timetable
 * stays in force until that happens. The recorded outcome says so, and the diff
 * the drawer shows states it as an unchanged row rather than leaving it implied.
 */

const VIEWS = [
  { key: 'pending', label: 'Pending' },
  { key: 'decided', label: 'Decided' },
];

export function InstitutionApprovalsView() {
  const [view, setView] = useState('pending');
  const [tab, setTab] = useState('all');
  const [openId, setOpenId] = useState(null);
  // Decisions live here for the session so the queue actually responds to being
  // worked — the mock data stays the starting state, not a frozen one.
  const [decided, setDecided] = useState({});

  const requests = useMemo(
    () =>
      INST_REQUESTS.map((r) => {
        const local = decided[r.id];
        if (!local) return r;
        return {
          ...r,
          status: local.outcome,
          decision: {
            by: 'You',
            position: 'Principal',
            at: local.at,
            outcome: local.outcome,
            note: local.note,
          },
          timeline: [
            ...r.timeline.filter((s) => s.state === 'done'),
            {
              label: local.outcome === 'approved' ? 'Approved by Principal' : 'Rejected',
              state: 'done',
              at: local.at,
              by: 'You',
            },
            /*
             * An approved revision becomes *ready to lock*, not live. The step
             * that follows is still pending, because locking a grid is an act
             * the department performs against its own timetable — a Principal
             * who approved a revision has not replaced anything yet.
             */
            ...(local.outcome === 'approved'
              ? [
                  r.kind === 'timetable_endorsement'
                    ? { label: 'Locked', state: 'pending', at: null, by: null }
                    : { label: 'Applied to record', state: 'done', at: local.at, by: null },
                ]
              : []),
          ],
        };
      }),
    [decided],
  );

  const activeTab = INST_TABS.find((t) => t.key === tab) ?? INST_TABS[0];

  const visible = useMemo(
    () =>
      requests.filter((r) => {
        const isPending = r.status === 'pending';
        if (view === 'pending' && !isPending) return false;
        if (view === 'decided' && isPending) return false;
        if (activeTab.kinds && !activeTab.kinds.includes(r.kind)) return false;
        return true;
      }),
    [requests, view, activeTab],
  );

  const pendingCount = requests.filter((r) => r.status === 'pending').length;
  const open = openId ? requests.find((r) => r.id === openId) : null;

  /** Pending count per tab, so a tab says how much work is behind it. */
  function tabCount(t) {
    return requests.filter((r) => r.status === 'pending' && (!t.kinds || t.kinds.includes(r.kind))).length;
  }

  function decide(id, outcome, note) {
    setDecided((prev) => ({ ...prev, [id]: { outcome, note, at: new Date() } }));
    setOpenId(null);
    toast.success(outcome === 'approved' ? 'Request approved' : 'Request rejected');
  }

  return (
    <div className={PANE}>
      <InstitutionScopeHeader />

      <div className="flex-none flex items-center gap-[8px] flex-wrap mb-[10px]">
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
      </div>

      {/* Type tabs — a second row, so a narrow workspace wraps them rather than
          crushing the view switch above. */}
      <div
        role="tablist"
        aria-label="Approval types"
        className="flex-none flex items-center gap-[4px] flex-wrap mb-[12px]"
      >
        {INST_TABS.map((t) => {
          const count = tabCount(t);
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex-none h-[26px] px-[9px] border rounded-[8px] font-sans text-[12px] cursor-pointer transition-colors duration-200',
                tab === t.key
                  ? 'border-accent-line bg-accent-soft text-accent font-[600]'
                  : 'border-line bg-paper text-ink-muted font-[500] hover:bg-tint2 hover:text-ink',
              )}
            >
              {t.label}
              {count > 0 && <span className="ml-[5px] text-[11px] tabular-nums text-ink-faint">{count}</span>}
            </button>
          );
        })}
      </div>

      <ApprovalInbox
        requests={visible}
        onOpen={setOpenId}
        kinds={INST_REQUEST_KINDS}
        emptyState={
          view === 'decided' ? (
            <NoResults what="decided requests" />
          ) : tab !== 'all' ? (
            <NoResults what={`${activeTab.label.toLowerCase()} requests`} />
          ) : (
            <NothingToEndorse />
          )
        }
      />

      <DecisionDrawer
        request={open}
        onClose={() => setOpenId(null)}
        onDecide={decide}
        kinds={INST_REQUEST_KINDS}
        deciderPosition="Principal"
      />
    </div>
  );
}
