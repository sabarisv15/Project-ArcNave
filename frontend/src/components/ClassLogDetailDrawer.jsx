import * as Dialog from '@radix-ui/react-dialog';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { PERIOD_BY_ID, canActOnPeriod, classLine, formatFullDate, formatTime } from '../lib/attendanceData';
import { useAttendanceStore } from '../store/AttendanceProvider';
import { OwnershipBadge } from './AttendanceStatus';
import { ClassLogEditable } from './ClassLogSection';
import { cn } from '../lib/utils';

function Stat({ label, value }) {
  return (
    <div className="bg-surface border border-line rounded-[12px] py-[10px] px-[12px]">
      <div className="text-[9.5px] tracking-[.06em] uppercase text-ink-faint mb-[3px]">{label}</div>
      <div className="text-[13px] font-[500] text-ink">{value}</div>
    </div>
  );
}

/**
 * Right-side detail drawer for a Class Log row — the topic taught is
 * editable here regardless of the attendance record's own lock/submit
 * state (attendance status and class log editability are independent);
 * only ownership gates editing.
 */
export function ClassLogDetailDrawer({ periodId, session, onClose }) {
  const { now, updateClassLog } = useAttendanceStore();
  const period = periodId ? PERIOD_BY_ID[periodId] : null;
  const canEdit = !!period && canActOnPeriod(period);

  return (
    <Dialog.Root open={!!period} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-overlay/20 animate-fadeUp" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-[121] w-full sm:w-[452px] flex flex-col bg-raised border-l border-line-strong rounded-l-[22px] shadow-dialog outline-none overflow-hidden data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 data-[state=open]:fade-in duration-200 ease-out motion-reduce:animate-none">
          {period && session && (
            <>
              <div className="flex items-start justify-between gap-[12px] pt-[18px] px-[18px] pb-[14px] border-b border-line">
                <div className="min-w-0">
                  <Dialog.Title className="m-0 text-[17px] font-[600] tracking-[-.01em]">{period.subject}</Dialog.Title>
                  <div className="mt-[3px] flex items-center gap-[7px] flex-wrap">
                    <span className="text-[11.5px] text-ink-faint">{period.code} · {classLine(period)}</span>
                    <OwnershipBadge ownership={period.ownership} />
                  </div>
                </div>
                <Dialog.Close asChild>
                  <button type="button" aria-label="Close class log detail" title="Close" className="flex-none w-[30px] h-[30px] grid place-items-center border-0 bg-transparent rounded-[9px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent">
                    <X size={17} strokeWidth={1.9} />
                  </button>
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">Class log and attendance detail for {period.subject} on {formatFullDate(period.date)}.</Dialog.Description>

              <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet py-[16px] px-[18px]">
                {period.ownership === 'substitute' && (
                  <p className="mt-0 mb-[12px] text-[12px] text-ink-faint">Covering for {period.substituteFor}.</p>
                )}

                <div className="grid grid-cols-2 gap-[8px] mb-[14px]">
                  <Stat label="Date" value={formatFullDate(period.date)} />
                  <Stat label="Period time" value={`${formatTime(period.startTime)}–${formatTime(period.endTime)}`} />
                  <Stat label="Present" value={session.presentIds.size} />
                  <Stat label="Absent" value={session.absentIds.size} />
                </div>

                {canEdit ? (
                  <ClassLogEditable
                    periodId={period.id}
                    classLog={session.classLog}
                    onChange={(patch) => updateClassLog(period.id, patch)}
                    savedAt={session.classLogSavedAt}
                    now={now}
                  />
                ) : (
                  <div className="mt-[16px] pt-[14px] border-t border-line">
                    <div className="text-[11px] font-[500] uppercase tracking-[.06em] text-ink-faint mb-[8px]">Class log</div>
                    <div className="text-[13px] leading-[1.5] text-ink whitespace-pre-wrap">{session.classLog.topicTaught || '—'}</div>
                  </div>
                )}

                {session.lockedAt && (
                  <p className="mt-[12px] mb-0 text-[11.5px] text-ink-faint">Locked {formatTime(session.lockedAt)} by {session.lockedBy}.</p>
                )}
                {session.submittedAt && (
                  <p className="mt-[4px] mb-0 text-[11.5px] text-ink-faint">Submitted {formatTime(session.submittedAt)} by {session.submittedBy}. Included in attendance percentage.</p>
                )}
                {!session.lockedAt && (
                  <p className="mt-[12px] mb-0 text-[11.5px] text-ink-faint">Still a draft. Not locked, and not yet visible in the Class login.</p>
                )}
              </div>

              <div className="flex-none p-[16px] border-t border-line">
                <Link
                  to={`/curriculum/attendance/${period.id}`}
                  className={cn(
                    'flex items-center justify-center w-full h-[38px] rounded-[11px] no-underline hover:no-underline font-sans text-[13px] font-[500] cursor-pointer',
                    canEdit
                      ? 'border-0 bg-accent text-white hover:bg-accent-hover'
                      : 'border border-line bg-paper text-ink-soft hover:bg-tint2'
                  )}
                >
                  {canEdit ? 'Open full attendance record' : 'View full attendance record'}
                </Link>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
