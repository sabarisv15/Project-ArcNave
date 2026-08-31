import { useState } from 'react';
import { cn } from '../lib/utils';
import { DrawerShell, DrawerRail, PRIMARY_BTN, GHOST_BTN } from './AttendanceActionDrawer';
import { SubstituteRequestDrawer } from './SubstituteRequestDrawer';
import { SearchPopoverField, SortIconPopover } from './ToolbarIcons';
import { FilterPopover, FilterSelect, FilterField, FilterFieldLabel, FILTER_FIELD_INPUT } from './FilterPopover';
import { TABLE_HEAD, TableEmptyState } from './WorkspaceLayout';
import { DATE_PRESETS } from '../lib/dateFilters';
import { LOG_SORTS } from '../hooks/useSubstitute';
import { useAttendanceStore } from '../store/AttendanceProvider';
import {
  COLLEAGUE_BY_ID,
  LOG_ATTENDANCE_LABELS,
  REQUEST_STATUS_LABELS,
  dateFromDayKey,
  slotTimeRange,
} from '../lib/substituteData';
import { formatDateDMY } from '../lib/ist';
import { formatTime, timeRange } from '../lib/attendanceData';

const SECTIONS = [
  { key: 'log', label: 'My substitute log' },
  { key: 'incoming', label: 'Incoming requests' },
  { key: 'mine', label: 'My requests' },
];

/** Tone-carrying state text — the word always carries the meaning, the dot only reinforces it. */
function StateText({ label, tone = 'muted' }) {
  const tones = {
    muted: ['bg-ink-disabled', 'text-ink-muted'],
    accent: ['bg-accent', 'text-accent'],
    good: ['bg-success', 'text-success'],
    warn: ['bg-pending', 'text-pending'],
    danger: ['bg-danger', 'text-danger'],
  };
  const [dot, text] = tones[tone] ?? tones.muted;
  return (
    <span className={cn('inline-flex items-center gap-[6px] text-[12px] font-[500] whitespace-nowrap', text)}>
      <span className={cn('flex-none w-[6px] h-[6px] rounded-full', dot)} aria-hidden="true" />
      {label}
    </span>
  );
}

const ATTENDANCE_TONE = {
  submitted: 'good',
  locked: 'muted',
  ready: 'accent',
  open: 'accent',
  draft: 'accent',
  upcoming: 'muted',
  window_closed: 'danger',
  not_marked: 'muted',
};

const REQUEST_TONE = {
  pending: 'warn',
  accepted: 'good',
  declined: 'danger',
  cancelled: 'muted',
  expired: 'muted',
};

/** A section's own compact controls row — always adjacent to the section switcher, never a second toolbar. */
function SectionBar({ s, onNewRequest }) {
  return (
    <div className="flex-none flex items-center gap-[8px] mb-[12px]">
      <div
        role="tablist"
        aria-label="Substitute sections"
        className="flex items-center gap-[2px] p-[2px] bg-frame rounded-[10px]"
      >
        {SECTIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={s.section === key}
            onClick={() => s.setSection(key)}
            className={cn(
              'flex-none h-[28px] px-[12px] border-0 rounded-[8px] font-sans text-[12px] whitespace-nowrap cursor-pointer transition-colors duration-200',
              s.section === key
                ? 'bg-paper text-ink font-[600] shadow-seg'
                : 'bg-transparent text-ink-muted font-[500] hover:text-ink',
            )}
          >
            {label}
            {key === 'incoming' && s.pendingIncomingCount + s.pendingAckCount > 0 && (
              <span className="ml-[6px] inline-flex items-center h-[15px] min-w-[15px] px-[4px] rounded-full bg-accent text-white text-[9.5px] font-[600] leading-none tabular-nums">
                {s.pendingIncomingCount + s.pendingAckCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {s.section === 'log' && (
        <>
          <SearchPopoverField
            value={s.query}
            onChange={s.setQuery}
            placeholder="Search subject, class, staff…"
            ariaLabel="Search substitute log"
          />
          <SortIconPopover options={LOG_SORTS} value={s.sortKey} onChange={s.setSortKey} label="Sort substitute log" />
          <LogFilters s={s} />
        </>
      )}

      {s.section === 'mine' && (
        <button type="button" className={PRIMARY_BTN} onClick={onNewRequest}>
          Request substitute
        </button>
      )}
    </div>
  );
}

function LogFilters({ s }) {
  return (
    <FilterPopover
      open={s.filtersOpen}
      onOpenChange={s.setFiltersOpen}
      activeCount={s.activeFilterCount}
      onClear={s.clearFilters}
      width={300}
      iconOnly
      align="end"
      label="Filter substitute log"
    >
      <div className="mb-[14px]">
        <FilterFieldLabel>Date range</FilterFieldLabel>
        <div className="flex flex-wrap gap-[6px]">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => s.setDatePreset(p.key)}
              className={cn(
                'h-[28px] px-[10px] rounded-[9px] font-sans text-[11.5px] cursor-pointer transition-colors duration-200',
                s.datePreset === p.key
                  ? 'bg-accent-soft border border-accent-line text-accent font-[600]'
                  : 'bg-tint2 border border-transparent text-ink-soft font-[500] hover:bg-hoverline',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {s.datePreset === 'custom' && (
          <div className="grid grid-cols-2 gap-[8px] mt-[8px]">
            <FilterField label="From">
              <input
                type="date"
                aria-label="Custom range from"
                value={s.customFrom}
                onChange={(e) => s.setCustomFrom(e.target.value)}
                className={FILTER_FIELD_INPUT}
              />
            </FilterField>
            <FilterField label="To">
              <input
                type="date"
                aria-label="Custom range to"
                value={s.customTo}
                onChange={(e) => s.setCustomTo(e.target.value)}
                className={FILTER_FIELD_INPUT}
              />
            </FilterField>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-[14px]">
        <FilterSelect
          label="Subject"
          value={s.filters.subject}
          onChange={(v) => s.setFilter('subject', v)}
          options={[{ value: '', label: 'All' }, ...s.options.subjects.map((x) => ({ value: x, label: x }))]}
        />
        <FilterSelect
          label="Class / section"
          value={s.filters.classCode}
          onChange={(v) => s.setFilter('classCode', v)}
          options={[{ value: '', label: 'All' }, ...s.options.classes.map((x) => ({ value: x, label: x }))]}
        />
        <FilterSelect
          label="Original staff"
          value={s.filters.originalStaff}
          onChange={(v) => s.setFilter('originalStaff', v)}
          options={[{ value: '', label: 'All' }, ...s.options.originalStaff.map((x) => ({ value: x, label: x }))]}
        />
        <FilterSelect
          label="Acknowledgement"
          value={s.filters.ack}
          onChange={(v) => s.setFilter('ack', v)}
          options={[
            { value: '', label: 'All' },
            { value: 'yes', label: 'Acknowledged' },
            { value: 'no', label: 'Acknowledgement required' },
          ]}
        />
        <FilterSelect
          label="Attendance state"
          value={s.filters.state}
          onChange={(v) => s.setFilter('state', v)}
          options={[
            { value: '', label: 'All' },
            ...Object.entries(LOG_ATTENDANCE_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
      </div>
    </FilterPopover>
  );
}

const LOG_GRID = 'grid grid-cols-[104px_150px_1.1fr_1fr_1.05fr_130px_150px_64px] gap-x-[12px] items-center px-[16px]';

/**
 * The periods this staff member actually covered — never a request queue.
 * Newest first by default; there is no generic "Status" column, only the two
 * states that genuinely differ here (attendance lifecycle, acknowledgement).
 */
function SubstituteLog({ s, onOpenEntry }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col border border-line rounded-[16px] bg-paper overflow-hidden">
      <div className="flex-1 min-h-0 overflow-auto scroll-quiet">
        <div className="min-w-[1080px]">
          <div className={cn(LOG_GRID, TABLE_HEAD, 'sticky top-0 z-[46] h-[36px] bg-tint border-b border-line')}>
            <span>Date</span>
            <span>Time</span>
            <span>Subject</span>
            <span>Class / section</span>
            <span>Original staff</span>
            <span>Attendance</span>
            <span>Acknowledgement</span>
            <span className="text-right">Action</span>
          </div>

          {s.entries.map((e) => (
            <div
              key={e.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenEntry(e)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  onOpenEntry(e);
                }
              }}
              className={cn(
                LOG_GRID,
                'h-[46px] border-t border-line-light cursor-pointer transition-colors duration-200 hover:bg-tint2 outline-none focus-visible:bg-tint2',
              )}
            >
              <span className="text-[12.5px] font-[500] text-ink tabular-nums whitespace-nowrap">
                {formatDateDMY(e.date)}
              </span>
              <span className="text-[12px] text-ink-muted tabular-nums whitespace-nowrap">
                {e.period ? timeRange(e.period) : e.timeRange}
              </span>
              <span className="min-w-0 text-[13px] text-ink truncate" title={e.subject}>
                {e.subject}
              </span>
              <span className="min-w-0 text-[12.5px] text-ink-muted truncate" title={e.classCode}>
                {e.classCode}
              </span>
              <span className="min-w-0 text-[12.5px] text-ink-muted truncate" title={e.originalStaff}>
                {e.originalStaff}
              </span>
              <span className="min-w-0">
                <StateText label={LOG_ATTENDANCE_LABELS[e.attendanceState]} tone={ATTENDANCE_TONE[e.attendanceState]} />
              </span>
              <span className="min-w-0">
                <StateText
                  label={e.acknowledged ? 'Acknowledged' : 'Acknowledgement required'}
                  tone={e.acknowledged ? 'good' : 'warn'}
                />
              </span>
              <span className="flex justify-end">
                <span className="inline-flex items-center h-[26px] px-[10px] rounded-[8px] border border-line bg-paper text-[12px] font-[500] text-accent">
                  View
                </span>
              </span>
            </div>
          ))}

          {s.entries.length === 0 && (
            <TableEmptyState
              title={s.totalEntries ? 'No results found' : 'You have not covered any periods as a substitute yet.'}
              hint={s.totalEntries ? 'Try clearing a filter or search term.' : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** One request, incoming or outgoing — same compact shape, different action set. */
function RequestRow({ request, children, secondary }) {
  const scopeLabel = request.scope === 'day' ? 'Full day' : 'One period';
  return (
    <div className="border-t border-line-light first:border-t-0 px-[16px] py-[11px]">
      <div className="flex items-start gap-[12px]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[8px] flex-wrap">
            <span className="text-[13px] font-[500] text-ink">{secondary}</span>
            <span className="text-ink-faint" aria-hidden="true">
              ·
            </span>
            <span className="text-[12.5px] text-ink-muted tabular-nums whitespace-nowrap">
              {formatDateDMY(dateFromDayKey(request.dateKey))}
            </span>
            <span className="text-ink-faint" aria-hidden="true">
              ·
            </span>
            <span className="text-[12px] text-ink-muted">
              {scopeLabel} · {request.slots.length} period{request.slots.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="mt-[5px] flex flex-wrap gap-x-[10px] gap-y-[3px]">
            {request.slots.map((slot) => (
              <span key={slot.slotKey} className="text-[11.5px] text-ink-soft whitespace-nowrap">
                <span className="tabular-nums text-ink-faint">{slotTimeRange(slot)}</span>
                {' · '}
                {slot.subject}
                <span className="text-ink-faint"> · {slot.code}</span>
              </span>
            ))}
          </div>

          {request.reason && (
            <div className="mt-[5px] text-[11.5px] text-ink-faint truncate" title={request.reason}>
              {request.reason}
            </div>
          )}
        </div>

        <div className="flex-none flex flex-col items-end gap-[7px]">
          <StateText label={REQUEST_STATUS_LABELS[request.status]} tone={REQUEST_TONE[request.status]} />
          <div className="flex items-center gap-[7px]">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ListShell({ children, empty }) {
  return (
    <div className="flex-1 min-h-0 border border-line rounded-[16px] bg-paper overflow-hidden">
      <div className="h-full overflow-y-auto scroll-quiet">
        {children}
        {empty}
      </div>
    </div>
  );
}

/**
 * Requests sent to this staff member. An accepted duty is not yet a workable
 * duty: until it is acknowledged, the row says so and Mark attendance stays
 * disabled everywhere — this is the same acknowledgement record Today's
 * schedule reads, so the two can never disagree.
 */
function IncomingRequests({ s }) {
  const { acceptRequest, declineRequest, acknowledgeRequest } = useAttendanceStore();

  return (
    <ListShell
      empty={s.incoming.length === 0 && <TableEmptyState title="No substitute requests have been sent to you." />}
    >
      {s.incoming.map((r) => (
        <RequestRow key={r.id} request={r} secondary={r.fromStaff}>
          {r.status === 'pending' && (
            <>
              <button type="button" className={GHOST_BTN} onClick={() => declineRequest(r.id)}>
                Decline
              </button>
              <button type="button" className={PRIMARY_BTN} onClick={() => acceptRequest(r.id)}>
                Accept
              </button>
            </>
          )}
          {r.status === 'accepted' && !r.acknowledgedAt && (
            <button type="button" className={PRIMARY_BTN} onClick={() => acknowledgeRequest(r.id)}>
              Acknowledge duty
            </button>
          )}
          {r.status === 'accepted' && r.acknowledgedAt && (
            <span className="text-[11.5px] font-[500] text-success whitespace-nowrap">
              Acknowledged · {formatTime(r.acknowledgedAt)}
            </span>
          )}
        </RequestRow>
      ))}
    </ListShell>
  );
}

/** Requests this staff member raised. A pending request changes nothing — the period is still theirs. */
function MyRequests({ s }) {
  const { cancelRequest } = useAttendanceStore();

  return (
    <ListShell
      empty={
        s.outgoing.length === 0 && (
          <TableEmptyState
            title="You have not requested substitute cover yet."
            hint="Use Request substitute to raise one."
          />
        )
      }
    >
      {s.outgoing.map((r) => (
        <RequestRow
          key={r.id}
          request={r}
          secondary={
            r.recipientMode === 'specific'
              ? (COLLEAGUE_BY_ID[r.toStaffId]?.name ?? 'Specific staff')
              : `${r.recipientCount} available staff`
          }
        >
          {r.status === 'accepted' && r.acceptedBy && (
            <span className="text-[11.5px] text-ink-muted whitespace-nowrap">Covered by {r.acceptedBy}</span>
          )}
          {r.status === 'pending' && (
            <button type="button" className={GHOST_BTN} onClick={() => cancelRequest(r.id)}>
              Cancel
            </button>
          )}
        </RequestRow>
      ))}
    </ListShell>
  );
}

/** Read-only detail for one covered period — the log's row-click destination. */
function LogDetailDrawer({ entry, onClose, onMarkAttendance }) {
  const canMark = !!entry?.period && entry.acknowledged && ['open', 'draft'].includes(entry.attendanceState);

  return (
    <DrawerShell
      open={!!entry}
      onOpenChange={(v) => !v && onClose()}
      title="Substitute duty"
      contextLine={
        entry
          ? `${formatDateDMY(entry.date)} · ${entry.period ? timeRange(entry.period) : entry.timeRange} · ${entry.subject} · ${entry.classCode}`
          : ''
      }
      description="Details of a period covered as a substitute."
      width="sm:w-[440px]"
    >
      {entry && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] py-[14px]">
            <dl className="grid grid-cols-2 gap-x-[14px] gap-y-[12px] m-0">
              {[
                ['Original staff', entry.originalStaff],
                ['Class / section', entry.classCode],
                ['Attendance', LOG_ATTENDANCE_LABELS[entry.attendanceState]],
                [
                  'Acknowledgement',
                  entry.acknowledged
                    ? `Acknowledged${entry.acknowledgedAt ? ` · ${formatTime(entry.acknowledgedAt)}` : ''}`
                    : 'Required',
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[10px] tracking-[.05em] uppercase text-ink-faint mb-[3px]">{label}</dt>
                  <dd className="m-0 text-[12.5px] text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <DrawerRail meta={<span className="text-[11px] text-ink-faint">Covered as an approved substitute.</span>}>
            {canMark && (
              <button type="button" className={PRIMARY_BTN} onClick={() => onMarkAttendance(entry.periodId)}>
                Mark attendance
              </button>
            )}
          </DrawerRail>
        </>
      )}
    </DrawerShell>
  );
}

/**
 * The Substitute secondary tab: the cover log, incoming requests, and the
 * staff member's own requests — one compact section switcher, never a
 * dashboard, and every detail/creation flow stays in a right-side drawer.
 */
export function SubstitutePane({ s, onOpenPeriod }) {
  const [entry, setEntry] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);

  return (
    <>
      <SectionBar s={s} onNewRequest={() => setRequestOpen(true)} />

      {s.section === 'log' && <SubstituteLog s={s} onOpenEntry={setEntry} />}
      {s.section === 'incoming' && <IncomingRequests s={s} />}
      {s.section === 'mine' && <MyRequests s={s} />}

      <LogDetailDrawer
        entry={entry}
        onClose={() => setEntry(null)}
        onMarkAttendance={(periodId) => {
          setEntry(null);
          onOpenPeriod(periodId);
        }}
      />

      <SubstituteRequestDrawer open={requestOpen} onClose={() => setRequestOpen(false)} />
    </>
  );
}
