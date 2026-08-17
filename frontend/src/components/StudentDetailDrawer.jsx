import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  academicLabel,
  academicToneClass,
  attendanceTone,
  feeTone,
  semesterSummary,
} from '../lib/studentsData';

function Stat({ label, value, tone }) {
  return (
    <div className="bg-surface border border-line rounded-[14px] py-[12px] px-[14px]">
      <div className="text-[9.5px] tracking-[.06em] uppercase text-ink-faint mb-[4px]">{label}</div>
      <div className={cn('text-[15px] font-[600]', tone)}>{value}</div>
    </div>
  );
}

/**
 * Teaching context: how this student reaches the signed-in staff member — the
 * class, programme, section and subject of every shared class.
 */
function TeachingContextBlock({ student, classes, scope }) {
  return (
    <div className="mt-[14px] py-[12px] px-[14px] bg-accent-soft border border-accent-line rounded-[14px]">
      <div className="text-[9.5px] tracking-[.06em] uppercase text-accent font-[600] mb-[8px]">Teaching context</div>
      <div className="flex flex-col gap-[7px]">
        {student.classIds.map((id) => {
          const c = classes.find((x) => x.id === id);
          const current = c.id === scope;
          return (
            <div
              key={id}
              className={cn('bg-paper rounded-[11px] py-[9px] px-[11px] border', current ? 'border-accent-line' : 'border-line')}
            >
              <div className="text-[12.5px] font-[500] text-ink">{c.code}</div>
              <div className="mt-[2px] text-[11.5px] text-ink-muted">
                {c.programme} · Section {c.section} · {c.subject}
                {current ? ' · current view' : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Right-side student sheet — 452px desktop, near-full width on mobile. */
export function StudentDetailDrawer({ s }) {
  const st = s.detailStudent;
  return (
    <Dialog.Root open={!!st} onOpenChange={(open) => !open && s.closeDetail()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-overlay/20 animate-fadeUp" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-[121] w-full sm:w-[452px] flex flex-col bg-raised border-l border-line-strong rounded-l-[22px] shadow-dialog outline-none overflow-hidden data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 data-[state=open]:fade-in duration-200 ease-out motion-reduce:animate-none">
          {st && (
            <>
              <div className="flex items-start justify-between gap-[12px] pt-[18px] px-[18px] pb-[14px] border-b border-line">
                <div className="min-w-0">
                  <Dialog.Title className="m-0 text-[18px] font-[600] tracking-[-.01em]">{st.name}</Dialog.Title>
                  <div className="mt-[3px] text-[11.5px] tabular-nums text-ink-faint">
                    Roll {st.rollNo} · {st.roll}
                  </div>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Close student detail"
                    title="Close"
                    className="flex-none w-[30px] h-[30px] grid place-items-center border-0 bg-transparent rounded-[9px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent"
                  >
                    <X size={17} strokeWidth={1.9} />
                  </button>
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">
                Academic, attendance, fee and contact detail for {st.name}.
              </Dialog.Description>

              <div className="flex-1 overflow-y-auto scroll-quiet pt-[16px] px-[18px] pb-[22px]">
                <div className="text-[13px] font-[500] text-ink">{st.dept}</div>
                <div className="mt-[2px] text-[12px] text-ink-faint">
                  Year {st.year} · Sem {st.currentSem} · Section {st.section}
                </div>

                <TeachingContextBlock student={st} classes={s.classes} scope={s.scope} />

                <div className="grid grid-cols-2 gap-[10px] mt-[16px]">
                  <Stat label="Academic status" value={academicLabel(st)} tone={academicToneClass(st)} />
                  <Stat label="Attendance" value={`${st.attendance}%`} tone={attendanceTone(st.attendance).text} />
                  <Stat label="Fee status" value={feeTone(st.feeTier).label} tone={feeTone(st.feeTier).className.split(' ')[0]} />
                  <Stat label="Overall status" value={st.status} tone={st.status === 'Suspended' ? 'text-danger' : 'text-ink'} />
                </div>

                <div className="grid grid-cols-3 gap-[10px] mt-[16px] bg-surface border border-line rounded-[14px] py-[12px] px-[14px]">
                  <div>
                    <div className="text-[9.5px] tracking-[.06em] uppercase text-ink-faint">CGPA</div>
                    <div className="mt-[3px] text-[13.5px] font-[500]">{st.cgpa}</div>
                  </div>
                  <div>
                    <div className="text-[9.5px] tracking-[.06em] uppercase text-ink-faint">Active backlogs</div>
                    <div className="mt-[3px] text-[13.5px] font-[500]">{st.backlogCount}</div>
                  </div>
                  <div>
                    <div className="text-[9.5px] tracking-[.06em] uppercase text-ink-faint">Batch</div>
                    <div className="mt-[3px] text-[13.5px] font-[500]">{st.batch}</div>
                  </div>
                </div>

                <div className="mt-[16px] bg-surface border border-line rounded-[14px] py-[12px] px-[14px]">
                  <div className="text-[9.5px] tracking-[.06em] uppercase text-ink-faint mb-[8px]">Semester breakdown</div>
                  {st.semesters.map((sem) => {
                    const summary = semesterSummary(sem);
                    return (
                      <div key={sem.label} className="py-[5px] border-b border-line-light last:border-b-0">
                        <div className="flex justify-between gap-[10px] text-[12px]">
                          <span className="text-ink-soft">{sem.label}</span>
                          <span className={cn('font-[600]', summary.className)}>{summary.text}</span>
                        </div>
                        {sem.subjects.map((subj, i) => (
                          <div key={`${subj}-${i}`} className="text-[11.5px] text-danger pl-[4px] mt-[2px]">
                            ✗ {subj}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-[16px] bg-surface border border-line rounded-[14px] py-[12px] px-[14px]">
                  <div className="text-[9.5px] tracking-[.06em] uppercase text-ink-faint mb-[8px]">Contact</div>
                  <div className="flex justify-between gap-[12px] text-[12.5px]">
                    <span className="text-ink-faint">Student</span>
                    <span className="text-ink tabular-nums">{st.phone}</span>
                  </div>
                  <div className="h-px bg-line-light my-[9px]" />
                  <div className="flex justify-between gap-[12px] text-[12.5px]">
                    <span className="text-ink-faint">Guardian</span>
                    <span className="text-ink tabular-nums">{st.guardianPhone}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
