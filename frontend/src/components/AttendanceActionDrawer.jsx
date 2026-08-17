import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Search, X } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  PERIOD_BY_ID,
  canActOnPeriod,
  canLockClassLog,
  formatDateLabel,
  formatDurationHM,
  formatFullDate,
  formatTime,
  formatTime12,
  markingWindowStatusText,
  periodContextLine,
  TOPIC_TAUGHT_MAX_LENGTH,
} from '../lib/attendanceData';
import { useAttendanceStore } from '../store/AttendanceProvider';
import { AutosaveStatus, DraftRestoredNote } from './AutosaveStatus';
import { CELL_DEBOUNCE_MS, useAutosave, useRestoredDraft } from '../hooks/useAutosave';
import { draftKey } from '../lib/draftStore';
import { ME as ATTENDANCE_ME } from '../lib/substituteData';
import { PresentAbsentPill } from './PresentAbsentPill';
import { CorrectionRequestDrawer } from './CorrectionRequestDrawer';

/**
 * One drawer chrome for every right-side workflow in the Attendance
 * workspace — attendance actions here, substitute workflows in the Substitute
 * tab. Opens from the right over a soft backdrop with the schedule still
 * visible behind it; closes on the close button, backdrop click and Escape
 * (the last two are Radix-native). The AppShell and sidebar never move.
 */
export function DrawerShell({ open, onOpenChange, title, contextLine, description, width = 'sm:w-[540px]', children }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-overlay/20 animate-fadeUp motion-reduce:animate-none" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 right-0 z-[121] w-full flex flex-col bg-raised border-l border-line-strong rounded-l-[20px] shadow-dialog outline-none overflow-hidden',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 data-[state=open]:fade-in duration-200 ease-out motion-reduce:animate-none',
            width
          )}
        >
          {/* Compact context header — one line of context, never a title block plus a paragraph. */}
          <div className="flex-none flex items-start justify-between gap-[12px] pt-[15px] px-[18px] pb-[12px] border-b border-line">
            <div className="min-w-0">
              <Dialog.Title className="m-0 text-[14.5px] font-[600] tracking-[-.01em] text-ink truncate">{title}</Dialog.Title>
              {contextLine && (
                <div className="mt-[3px] text-[11.5px] text-ink-muted truncate tabular-nums" title={contextLine}>
                  {contextLine}
                </div>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                title="Close"
                className="flex-none w-[30px] h-[30px] grid place-items-center border-0 bg-transparent rounded-[9px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent"
              >
                <X size={17} strokeWidth={1.9} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{description || title}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Sticky bottom action rail — the drawer's only place for commit actions. */
export function DrawerRail({ children, meta }) {
  return (
    <div className="flex-none flex items-center gap-[10px] px-[18px] py-[11px] border-t border-line bg-surface">
      <div className="min-w-0 flex-1">{meta}</div>
      {children}
    </div>
  );
}

export const PRIMARY_BTN =
  'flex-none h-[34px] px-[15px] border-0 rounded-[10px] bg-accent text-white font-sans text-[12.5px] font-[500] cursor-pointer transition-colors duration-200 hover:bg-accent-hover active:bg-accent-press';
export const GHOST_BTN =
  'flex-none h-[34px] px-[13px] border border-line rounded-[10px] bg-paper font-sans text-[12.5px] font-[500] text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-tint2';
const DISABLED_BTN = 'flex-none h-[34px] px-[15px] border-0 rounded-[10px] bg-frame text-ink-disabled font-sans text-[12.5px] font-[500] cursor-not-allowed';

const FIELD =
  'w-full font-sans text-[12.5px] text-ink bg-paper border border-line rounded-[10px] px-[11px] py-[8px] outline-none transition-colors duration-200 placeholder:text-ink-faint focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]';

/** Quiet inline save state — never a repeated "Attendance updated" toast. */
function SavedState({ savedAt, now }) {
  if (!savedAt) return <span className="text-[11px] text-ink-faint">Not saved yet</span>;
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  return (
    <span className="inline-flex items-center gap-[4px] text-[11px] text-ink-faint">
      <Check size={11} strokeWidth={2.2} className="text-success" aria-hidden="true" />
      {seconds < 45 ? 'Saved' : `Saved ${Math.round(seconds / 60)} min ago`}
    </span>
  );
}

/** A short state note — one line, no explanatory paragraph. */
function Note({ children, danger }) {
  return (
    <div
      className={cn(
        'flex-none mx-[18px] mt-[14px] px-[13px] py-[10px] rounded-[11px] border text-[12px] leading-[1.5]',
        danger ? 'border-line bg-danger-soft text-danger' : 'border-line bg-paper text-ink-muted'
      )}
    >
      {children}
    </div>
  );
}

function StudentRow({ student, present, onToggle, disabled }) {
  return (
    <div className="flex items-center justify-between gap-[10px] px-[18px] py-[7px] border-t border-line-light first:border-t-0">
      <div className="min-w-0">
        <span className="text-[12.5px] font-[500] text-ink">{student.name}</span>
        <span className="ml-[8px] text-[11px] text-ink-faint tabular-nums">Roll {student.roll}</span>
      </div>
      <PresentAbsentPill size="sm" present={present} onToggle={onToggle} disabled={disabled} />
    </div>
  );
}

/** Read-only roster — the dominant element of every view-only drawer state. */
function RosterReadOnly({ period, session }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet bg-paper border-y border-line mt-[14px]">
      {period.students.map((s) => (
        <StudentRow key={s.id} student={s} present={session.presentIds.has(s.id)} disabled />
      ))}
    </div>
  );
}

/** The class log's mandatory field, compact — visible but never competing with the marking list. */
function TopicField({ value, onChange, error, inputRef, disabled }) {
  return (
    <div className="flex-none px-[18px] pt-[10px]">
      <label htmlFor="drawer-topic" className="flex items-baseline gap-[6px] text-[11px] font-[500] uppercase tracking-[.05em] text-ink-faint mb-[5px]">
        Topic taught<span className="text-danger">*</span>
        {error && <span className="normal-case tracking-normal font-[500] text-[11px] text-danger">{error}</span>}
      </label>
      <textarea
        id="drawer-topic"
        ref={inputRef}
        rows={2}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.slice(0, TOPIC_TAUGHT_MAX_LENGTH))}
        placeholder="e.g. Binary search trees: insertion and traversal"
        aria-required="true"
        aria-invalid={!!error}
        className={cn(FIELD, 'resize-none min-h-[46px]', error && 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(180,69,60,.1)]')}
      />
    </div>
  );
}

/** Inline confirmation — Lock and Submit confirm inside this drawer, never in a separate modal. */
function ConfirmRail({ title, body, confirmLabel, onConfirm, onCancel }) {
  return (
    <div className="flex-none px-[18px] py-[12px] border-t border-line bg-paper">
      <div className="text-[12.5px] font-[500] text-ink">{title}</div>
      <p className="mt-[3px] mb-[10px] text-[11.5px] leading-[1.5] text-ink-muted">{body}</p>
      <div className="flex items-center justify-end gap-[8px]">
        <button type="button" className={GHOST_BTN} onClick={onCancel}>Cancel</button>
        <button type="button" className={PRIMARY_BTN} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  );
}

/**
 * The marking workspace, as a drawer body: the student list is the dominant
 * region, search and Mark all present live in that list's own header, the
 * mandatory topic stays compact underneath, and every commit action sits on
 * one sticky rail.
 */
function MarkingBody({ period, session, now, saveDraft, lockAttendance, submitAttendance, canSubmit, onDone }) {
  const [query, setQuery] = useState('');
  const [absentIds, setAbsentIds] = useState(() => new Set(session.absentIds));
  const [topic, setTopic] = useState(session.classLog.topicTaught);
  const [topicError, setTopicError] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const topicRef = useRef(null);

  /**
   * Toggles and topic text land in the record immediately — that write *is*
   * the draft, which is why marking survives a close and reopen. The debounced
   * autosave behind it mirrors the same state to session storage and drives
   * the quiet Saving…/Saved/Retry line, so an accidental close or a failed
   * sync never costs the selections or the topic. Lock and Submit stay
   * explicit, confirmed actions; nothing here can reach them.
   */
  const key = draftKey(ATTENDANCE_ME.id, 'attendance-marking', period.id);
  const restored = useRestoredDraft(key, true);
  const autosave = useAutosave({
    value: { absentIds: Array.from(absentIds), topic },
    storageKey: key,
    delay: CELL_DEBOUNCE_MS,
    onSave: () => {},
  });
  const usedDraft = !!restored?.value?.topic && restored.value.topic !== session.classLog.topicTaught;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return period.students;
    return period.students.filter((s) => s.name.toLowerCase().includes(term) || s.roll.includes(term));
  }, [period.students, query]);

  const commit = (nextAbsent, nextTopic) => {
    saveDraft(period.id, {
      presentIds: period.students.map((s) => s.id).filter((id) => !nextAbsent.has(id)),
      absentIds: Array.from(nextAbsent),
      classLog: { topicTaught: nextTopic },
    });
    autosave.schedule();
  };

  const toggle = (id) => {
    const next = new Set(absentIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAbsentIds(next);
    commit(next, topic);
  };

  const markAllPresent = () => {
    const next = new Set();
    setAbsentIds(next);
    commit(next, topic);
  };

  const handleTopic = (value) => {
    setTopic(value);
    if (topicError && value.trim()) setTopicError(null);
    commit(absentIds, value);
  };

  const requireTopic = () => {
    if (canLockClassLog({ topicTaught: topic })) return true;
    setTopicError('Required before locking');
    topicRef.current?.focus();
    return false;
  };

  const presentCount = period.students.length - absentIds.size;
  const hasEntries = !!session.lastSavedAt;

  return (
    <>
      <div className="flex-none flex items-center gap-[8px] px-[18px] pt-[12px] pb-[10px]">
        <div className="relative flex-1 min-w-0">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or roll…"
            aria-label="Search students in this class"
            className="w-full h-[32px] pl-[30px] pr-[10px] border border-line rounded-[9px] bg-paper font-sans text-[12.5px] text-ink outline-none focus:border-accent-line focus:shadow-[0_0_0_3px_rgba(11,114,133,.1)]"
          />
          <span className="absolute left-[9px] top-0 bottom-0 flex items-center text-ink-ghost pointer-events-none">
            <Search size={13} strokeWidth={1.9} />
          </span>
        </div>
        <button
          type="button"
          onClick={markAllPresent}
          disabled={absentIds.size === 0}
          className={cn(
            'flex-none h-[32px] px-[11px] border rounded-[9px] font-sans text-[11.5px] font-[500] whitespace-nowrap transition-colors duration-200',
            absentIds.size === 0
              ? 'border-line bg-tint2 text-ink-disabled cursor-not-allowed'
              : 'border-line bg-paper text-ink-soft cursor-pointer hover:bg-tint2'
          )}
        >
          Mark all present
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet bg-paper border-y border-line">
        {filtered.map((s) => (
          <StudentRow key={s.id} student={s} present={!absentIds.has(s.id)} onToggle={() => toggle(s.id)} />
        ))}
        {filtered.length === 0 && <p className="py-[16px] text-[12px] text-ink-faint text-center">No students found for “{query}”.</p>}
      </div>

      <TopicField value={topic} onChange={handleTopic} error={topicError} inputRef={topicRef} />

      {confirm === 'lock' ? (
        <ConfirmRail
          title="Lock this attendance record?"
          body="Locking makes it visible in the Class login. It isn't counted in attendance % until submitted."
          confirmLabel="Lock attendance"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { autosave.markClean(); lockAttendance(period.id); setConfirm(null); onDone(); }}
        />
      ) : confirm === 'submit' ? (
        <ConfirmRail
          title="Submit this attendance record?"
          body="Submitted attendance is included in the attendance percentage. Changes after this need Class Tutor approval."
          confirmLabel="Submit attendance"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { autosave.markClean(); submitAttendance(period.id); setConfirm(null); onDone(); }}
        />
      ) : (
        <DrawerRail
          meta={
            <span className="block text-[11px] text-ink-faint tabular-nums" aria-live="polite">
              {presentCount} present · {absentIds.size} absent
              <span className="mx-[5px] text-ink-faint" aria-hidden="true">·</span>
              {autosave.status === 'error' || autosave.status === 'saving' ? (
                <AutosaveStatus status={autosave.status} onRetry={autosave.retry} />
              ) : usedDraft && !session.lastSavedAt ? (
                <DraftRestoredNote show />
              ) : (
                <SavedState savedAt={session.lastSavedAt} now={now} />
              )}
            </span>
          }
        >
          <button type="button" className={GHOST_BTN} onClick={() => commit(absentIds, topic)}>Save draft</button>
          <button
            type="button"
            className={hasEntries ? PRIMARY_BTN : DISABLED_BTN}
            disabled={!hasEntries}
            onClick={() => requireTopic() && setConfirm('lock')}
          >
            Lock attendance
          </button>
          {canSubmit && (
            <button type="button" className={PRIMARY_BTN} onClick={() => setConfirm('submit')}>
              Submit attendance
            </button>
          )}
        </DrawerRail>
      )}
    </>
  );
}

const TITLES = {
  not_approved: 'Attendance unavailable',
  upcoming: 'Upcoming period',
  open: 'Mark attendance',
  marking_missed: 'Marking window closed',
  locked_before_window: 'Attendance locked',
  locked_ready: 'Submit attendance',
  submitted: 'Attendance record',
  submission_expired: 'Submission window closed',
};

/**
 * Every operational action from Today's schedule opens here — Mark, Continue,
 * Lock, Submit, View, Acknowledge — so nothing in the attendance workflow
 * navigates away from the workspace. The drawer picks its own body from the
 * record's phase rather than from which button was pressed, so the same period
 * can never present two different truths.
 *
 * Permission is re-derived here, not trusted from the row: a substitute duty
 * that hasn't been acknowledged shows the acknowledgement step and nothing
 * else, and a period this staff member doesn't own is read-only.
 */
export function AttendanceActionDrawer({ periodId, onClose }) {
  const {
    now, sessions, phaseFor, acknowledged, acknowledgeDuty,
    saveDraft, lockAttendance, submitAttendance, requestLateSubmission, requestCorrection,
  } = useAttendanceStore();
  const [correctionOpen, setCorrectionOpen] = useState(false);

  useEffect(() => { setCorrectionOpen(false); }, [periodId]);

  const period = periodId ? PERIOD_BY_ID[periodId] : null;
  const session = periodId ? sessions[periodId] : null;
  if (!period || !session) return null;

  const phase = phaseFor(periodId);
  const owned = canActOnPeriod(period);
  const needsAck = owned && period.ownership === 'substitute' && !acknowledged[periodId];
  const canAct = owned && !needsAck;
  const correction = session.correction;

  const title = !owned ? 'View only' : needsAck ? 'Acknowledge duty' : TITLES[phase];

  return (
    <>
      <DrawerShell
        open={!!periodId}
        onOpenChange={(open) => !open && onClose()}
        title={title}
        contextLine={periodContextLine(period)}
        description={`${title} — ${period.subject}, ${period.code}`}
      >
        {!owned && (
          <>
            <Note>View only · assigned to {period.ownerName ?? 'another staff member'}. Marking is restricted to the period's owner or an approved substitute.</Note>
            <RosterReadOnly period={period} session={session} />
          </>
        )}

        {needsAck && (
          <>
            <Note>Cover duty for {period.substituteFor}. Acknowledge it to enable attendance marking for this period.</Note>
            <div className="flex-1" />
            <DrawerRail meta={<span className="text-[11px] text-ink-faint">Marking stays disabled until you acknowledge this duty.</span>}>
              <button type="button" className={PRIMARY_BTN} onClick={() => acknowledgeDuty(period.id)}>Acknowledge duty</button>
            </DrawerRail>
          </>
        )}

        {canAct && phase === 'not_approved' && (
          <>
            <Note>Timetable not yet approved. Attendance opens once the timetable is approved — no override is available.</Note>
            <div className="flex-1" />
          </>
        )}

        {canAct && phase === 'upcoming' && (
          <>
            <Note>{markingWindowStatusText('upcoming', period, now)} · marking stays open for 30 min from the start.</Note>
            <RosterReadOnly period={period} session={session} />
          </>
        )}

        {canAct && phase === 'open' && (
          <MarkingBody
            period={period}
            session={session}
            now={now}
            saveDraft={saveDraft}
            lockAttendance={lockAttendance}
            submitAttendance={submitAttendance}
            canSubmit={false}
            onDone={onClose}
          />
        )}

        {canAct && phase === 'marking_missed' && (
          <>
            <Note danger>The marking window has closed. Submitting this period now requires an approval request.</Note>
            <RosterReadOnly period={period} session={session} />
            <DrawerRail meta={<span className="text-[11px] text-ink-faint">{session.classLog.topicTaught || 'No topic recorded'}</span>}>
              {session.lateSubmissionRequested ? (
                <span className="text-[12px] font-[500] text-ink-muted">Late submission requested</span>
              ) : (
                <button type="button" className={GHOST_BTN} onClick={() => requestLateSubmission(period.id)}>Request late submission</button>
              )}
            </DrawerRail>
          </>
        )}

        {canAct && phase === 'locked_before_window' && (
          <>
            <Note>Locked · submission opens at {formatTime12(session.submissionWindowOpensAt)}. Visible in the Class login, not yet counted in attendance %.</Note>
            <RosterReadOnly period={period} session={session} />
          </>
        )}

        {canAct && phase === 'locked_ready' && (
          <LockedReadyBody period={period} session={session} now={now} onSubmit={() => { submitAttendance(period.id); onClose(); }} />
        )}

        {canAct && phase === 'submitted' && (
          <>
            {correction?.status === 'pending' && <Note>Correction requested. Pending Class Tutor approval.</Note>}
            {correction?.status === 'approved' && <Note>Correction approved. This record shows the corrected values.</Note>}
            {correction?.status === 'rejected' && <Note>Correction rejected. The recorded attendance stands.</Note>}
            {!correction && (
              <Note>Submitted {formatDateLabel(session.submittedAt, now)} · {formatTime(session.submittedAt)} · included in attendance %.</Note>
            )}
            <RosterReadOnly period={period} session={session} />
            <DrawerRail meta={<span className="text-[11px] text-ink-faint truncate block">{session.classLog.topicTaught}</span>}>
              {(!correction || correction.status !== 'pending') && (
                <button type="button" className={GHOST_BTN} onClick={() => setCorrectionOpen(true)}>Request a correction</button>
              )}
            </DrawerRail>
          </>
        )}

        {canAct && phase === 'submission_expired' && (
          <>
            <Note danger>
              Not submitted before {formatTime12(session.submissionWindowClosesAt)} on {formatFullDate(session.submissionWindowClosesAt)}.
            </Note>
            <RosterReadOnly period={period} session={session} />
            <DrawerRail meta={<span className="text-[11px] text-ink-faint">Approval is required before you can submit.</span>}>
              {session.lateSubmissionRequested ? (
                <span className="text-[12px] font-[500] text-ink-muted">Late submission requested</span>
              ) : (
                <button type="button" className={GHOST_BTN} onClick={() => requestLateSubmission(period.id)}>Request late submission</button>
              )}
            </DrawerRail>
          </>
        )}
      </DrawerShell>

      {canAct && phase === 'submitted' && (
        <CorrectionRequestDrawer
          open={correctionOpen}
          onOpenChange={setCorrectionOpen}
          period={period}
          session={session}
          onSubmit={({ reason, items }) => requestCorrection(period.id, { reason, items })}
        />
      )}
    </>
  );
}

/** Submit confirms inside this same drawer — the rail swaps to the confirmation, nothing new opens. */
function LockedReadyBody({ period, session, now, onSubmit }) {
  const [confirming, setConfirming] = useState(false);
  const closesAt = session.submissionWindowClosesAt;

  return (
    <>
      <Note>
        Ready to submit · closes in {formatDurationHM(closesAt - now)} ({formatTime12(closesAt)}, {formatFullDate(closesAt)}).
      </Note>
      <RosterReadOnly period={period} session={session} />
      {confirming ? (
        <ConfirmRail
          title="Submit this attendance record?"
          body="Submitted attendance is included in the attendance percentage. Changes after this need Class Tutor approval."
          confirmLabel="Submit attendance"
          onCancel={() => setConfirming(false)}
          onConfirm={onSubmit}
        />
      ) : (
        <DrawerRail
          meta={
            <span className="text-[11px] text-ink-faint tabular-nums">
              {session.presentIds.size} present · {session.absentIds.size} absent
            </span>
          }
        >
          <button type="button" className={PRIMARY_BTN} onClick={() => setConfirming(true)}>Submit attendance</button>
        </DrawerRail>
      )}
    </>
  );
}
