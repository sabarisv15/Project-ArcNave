import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { formatDateDMY } from '../lib/ist';
import { formatTime } from '@/features/attendance/lib/attendanceData';
import { ATTENDANCE_THRESHOLD } from '@/features/attendance/lib/attendanceLedger';
import { inDateRange } from '../lib/dateFilters';
import { cn } from '../lib/utils';

const RANGES = [
  { key: 'all', label: 'All' },
  { key: 'month', label: 'This month' },
  { key: 'week', label: 'This week' },
];

/** Compact labelled figure for the drawer's summary row. */
function Figure({ label, value, tone }) {
  return (
    <div>
      <div className="text-[10px] tracking-[.05em] uppercase text-ink-faint mb-[3px]">{label}</div>
      <div className={cn('text-[15px] font-[600] tabular-nums', tone || 'text-ink')}>{value}</div>
    </div>
  );
}

/**
 * Read-only absence detail for one student in the selected subject. Opens as a
 * right-side drawer over the workspace — the AppShell and sidebar stay
 * visible, and nothing here navigates away.
 *
 * Every figure comes from the ledger's submitted-only numbers, so the drawer
 * can never disagree with the table that opened it.
 */
export function StudentAbsenceDrawer({ student, subject, now, onClose }) {
  const [range, setRange] = useState('all');

  const absences = useMemo(() => {
    if (!student) return [];
    if (range === 'all') return student.absences;
    return student.absences.filter((a) => inDateRange(a.date, now, range));
  }, [student, range, now]);

  const atRisk = student && student.percentage < ATTENDANCE_THRESHOLD;
  // Only worth offering a range filter once the list is genuinely long.
  const showRangeFilter = (student?.absences.length ?? 0) > 12;

  return (
    <Dialog.Root open={!!student} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-overlay/20 animate-fadeUp" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-[121] w-full sm:w-[428px] flex flex-col bg-raised border-l border-line-strong rounded-l-[22px] shadow-dialog outline-none overflow-hidden data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 data-[state=open]:fade-in duration-200 ease-out motion-reduce:animate-none">
          {student && subject && (
            <>
              <div className="flex-none flex items-start justify-between gap-[12px] pt-[18px] px-[18px] pb-[14px] border-b border-line">
                <div className="min-w-0">
                  <Dialog.Title className="m-0 text-[17px] font-[600] tracking-[-.01em] truncate">
                    {student.name}
                  </Dialog.Title>
                  <div className="mt-[2px] text-[11.5px] text-ink-faint truncate">
                    Roll {student.roll} · {student.registerNumber}
                  </div>
                  <div className="mt-[5px] text-[12px] text-ink-muted truncate">
                    {subject.subject} · {subject.classCode}
                  </div>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Close attendance detail"
                    title="Close"
                    className="flex-none w-[30px] h-[30px] grid place-items-center border-0 bg-transparent rounded-[9px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent"
                  >
                    <X size={17} strokeWidth={1.9} />
                  </button>
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">
                Submitted attendance and absence dates for {student.name} in {subject.subject}.
              </Dialog.Description>

              <div className="flex-none grid grid-cols-3 gap-[10px] px-[18px] py-[14px] border-b border-line bg-paper">
                <Figure label="Present" value={`${student.presentHours} / ${student.submittedHours}`} />
                <Figure label="Absent" value={student.absentHours} />
                <Figure label="Attendance" value={`${student.percentage}%`} tone={atRisk ? 'text-danger' : undefined} />
              </div>

              <div className="flex-none flex items-center gap-[8px] px-[18px] pt-[14px] pb-[10px]">
                <span className="text-[11px] font-[500] uppercase tracking-[.06em] text-ink-faint">Absence dates</span>
                <span className="text-[11.5px] text-ink-faint">{absences.length}</span>
                <div className="flex-1" />
                {showRangeFilter && (
                  <div className="flex items-center gap-[3px]">
                    {RANGES.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => setRange(r.key)}
                        className={cn(
                          'h-[24px] px-[9px] rounded-[7px] font-sans text-[11px] cursor-pointer transition-colors duration-200',
                          range === r.key
                            ? 'bg-accent-soft text-accent font-[600]'
                            : 'bg-transparent text-ink-muted font-[500] hover:bg-tint2',
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] pb-[18px]">
                {absences.length === 0 ? (
                  <p className="mt-[6px] text-[12.5px] text-ink-faint">
                    {student.absences.length === 0
                      ? 'Present for every submitted hour in this subject.'
                      : 'No absences in this range.'}
                  </p>
                ) : (
                  <div className="border border-line rounded-[14px] bg-paper overflow-hidden">
                    {absences.map((a) => (
                      <div key={a.id} className="px-[13px] py-[9px] border-t border-line-light first:border-t-0">
                        <div className="flex items-baseline gap-[8px] text-[12.5px]">
                          <span className="font-[600] text-ink whitespace-nowrap">{formatDateDMY(a.date)}</span>
                          <span className="text-ink-faint" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-ink-muted tabular-nums whitespace-nowrap">
                            {formatTime(a.startTime)}–{formatTime(a.endTime)} IST
                          </span>
                          <div className="flex-1" />
                          <span className="flex-none text-[11.5px] font-[500] text-danger">Absent</span>
                        </div>
                        {a.topicTaught && (
                          <div className="mt-[2px] text-[11px] text-ink-faint truncate" title={a.topicTaught}>
                            {a.topicTaught}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
