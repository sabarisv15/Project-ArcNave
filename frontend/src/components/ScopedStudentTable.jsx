import { useMemo } from 'react';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Check, MoreHorizontal, X } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  TREND_GLYPHS,
  TREND_TITLES,
  academicLabel,
  academicToneClass,
  attendanceTone,
  feeTone,
  semesterSummary,
} from '../lib/studentsData';

const helper = createColumnHelper();

const GRID_SCOPED = 'grid-cols-[34px_1.8fr_1.25fr_1.1fr_1.25fr_.85fr_.8fr_34px]';
const GRID_ALL = 'grid-cols-[34px_1.6fr_1.25fr_1.1fr_1.05fr_1.15fr_.8fr_.75fr_34px]';

function Checkbox({ checked, indeterminate, onClick, label }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'w-[18px] h-[18px] p-0 rounded-[6px] grid place-items-center border cursor-pointer transition-colors duration-200',
        checked ? 'bg-accent border-accent text-white' : indeterminate ? 'bg-accent-soft border-line' : 'bg-paper border-line'
      )}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  );
}

/**
 * The roster for the selected class scope. Selection, popovers and the row menu
 * all act on the visible scope only.
 */
export function ScopedStudentTable({ s }) {
  const columns = useMemo(() => {
    const cols = [
      helper.display({
        id: 'select',
        header: () => (
          <Checkbox
            checked={s.allSelected}
            indeterminate={s.someSelected && !s.allSelected}
            onClick={s.toggleSelectAll}
            label="Select all students"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={!!s.selected[row.original.id]}
            onClick={() => s.toggleRow(row.original.id)}
            label={`Select ${row.original.name}`}
          />
        ),
      }),
      helper.accessor('name', {
        header: 'Name / Roll no / Reg no',
        cell: ({ row }) => {
          const st = row.original;
          return (
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => s.openDetail(st.id)}
                className="block max-w-full p-0 border-0 bg-transparent font-sans text-[13.5px] font-[500] text-ink whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer text-left transition-colors duration-200 hover:text-accent"
              >
                {st.name}
              </button>
              <div className="text-[11px] tabular-nums text-ink-faint mt-[2px] truncate">Roll {st.rollNo}</div>
              <div className="text-[11px] tabular-nums text-ink-faint mt-px truncate">{st.roll}</div>
            </div>
          );
        },
      }),
    ];

    // In "All my students" every row stays identifiable by class + teaching context.
    if (s.scopeIsAll) {
      cols.push(
        helper.display({
          id: 'classes',
          header: 'Class & subject',
          cell: ({ row }) => {
            const st = row.original;
            return (
              <div className="min-w-0 pr-[8px]">
                <div className="text-[12px] font-[500] text-ink leading-[1.3] break-words">
                  {st.classIds.map((id) => s.classes.find((c) => c.id === id).code).join(' · ')}
                </div>
                <div className="text-[11px] text-ink-faint mt-[2px] break-words">
                  {st.classIds.map((id) => s.classes.find((c) => c.id === id).subject).join(' · ')}
                </div>
              </div>
            );
          },
        })
      );
    }

    cols.push(
      helper.accessor('dept', {
        header: 'Dept / Year',
        cell: ({ row }) => {
          const st = row.original;
          return (
            <div className="min-w-0 pr-[8px]">
              <div className="text-[12.5px] font-[500] text-ink leading-[1.3] break-words">{st.dept}</div>
              <div className="text-[11px] text-ink-faint mt-[2px] whitespace-nowrap">
                Year {st.year} · Sem {st.currentSem} · {st.section}
              </div>
            </div>
          );
        },
      }),
      helper.display({
        id: 'academic',
        header: 'Academic status',
        cell: ({ row }) => {
          const st = row.original;
          const open = s.statusPopoverId === st.id;
          return (
            <div className="relative inline-flex items-center">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => s.setStatusPopoverId(open ? null : st.id)}
                className={cn(
                  'h-[26px] px-[8px] rounded-[9px] font-sans text-[12px] font-[500] cursor-pointer border transition-colors duration-200 hover:bg-tint2',
                  academicToneClass(st),
                  open ? 'bg-accent-soft border-accent-line' : 'bg-transparent border-transparent'
                )}
              >
                {academicLabel(st)}
              </button>
              {open && (
                <div
                  role="dialog"
                  aria-label="Academic status detail"
                  className="absolute left-0 top-[calc(100%+6px)] z-[60] w-[262px] py-[13px] px-[15px] bg-raised border border-line-strong rounded-[14px] text-ink-soft text-[11.5px] shadow-pop animate-fadeUp"
                >
                  <div className="text-[9.5px] tracking-[.08em] uppercase text-ink-faint mb-[8px]">Academic status</div>
                  {st.semesters.map((sem) => {
                    const summary = semesterSummary(sem);
                    return (
                      <div key={sem.label} className="py-[4px] border-b border-line-light">
                        <div className="flex justify-between gap-[10px]">
                          <span className="text-ink-soft">{sem.label}</span>
                          <span className={cn('text-[11.5px] font-[500]', summary.className)}>{summary.text}</span>
                        </div>
                        {sem.subjects.map((subj, i) => (
                          <div key={`${subj}-${i}`} className="text-danger pl-[4px] mt-[2px]">
                            ✗ {subj}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  <div className="mt-[8px] font-[600] text-ink">Total active backlogs: {st.backlogCount}</div>
                </div>
              )}
            </div>
          );
        },
      }),
      helper.accessor('attendance', {
        header: 'Attendance',
        cell: ({ row }) => {
          const st = row.original;
          const tone = attendanceTone(st.attendance);
          return (
            <div className="flex items-center gap-[9px]">
              <div className="w-[48px] h-[6px] rounded-[4px] bg-frame overflow-hidden flex-none">
                <div
                  className={cn('h-full rounded-[4px] transition-[width] duration-200', tone.bar)}
                  style={{ width: `${st.attendance}%` }}
                />
              </div>
              <div className={cn('flex items-baseline gap-[4px] whitespace-nowrap text-[12.5px] font-[500] tabular-nums', tone.text)}>
                <span>{st.attendance}%</span>
                <span
                  title={TREND_TITLES[st.trend]}
                  className={cn(
                    'text-[11px]',
                    st.trend === 'up' ? 'text-success' : st.trend === 'down' ? 'text-danger' : 'text-ink-faint'
                  )}
                >
                  {TREND_GLYPHS[st.trend]}
                </span>
              </div>
            </div>
          );
        },
      }),
      helper.accessor('feeTier', {
        header: 'Fee status',
        cell: ({ row }) => {
          const fee = feeTone(row.original.feeTier);
          return (
            <span className={cn('inline-block text-[11px] font-[500] py-[3px] px-[9px] rounded-[9px] whitespace-nowrap', fee.className)}>
              {fee.label}
            </span>
          );
        },
      }),
      helper.accessor('status', {
        header: 'Status',
        cell: ({ row }) => {
          const suspended = row.original.status === 'Suspended';
          return (
            <span
              className={cn(
                'inline-block text-[11px] font-[500] py-[3px] px-[9px] rounded-[9px] whitespace-nowrap',
                suspended ? 'text-danger bg-danger-soft' : 'text-ink-muted bg-tint2'
              )}
            >
              {row.original.status}
            </span>
          );
        },
      }),
      helper.display({
        id: 'menu',
        header: '',
        cell: ({ row }) => {
          const st = row.original;
          const open = s.rowMenuId === st.id;
          return (
            <div className="relative">
              <button
                type="button"
                aria-label={`Contact details for ${st.name}`}
                aria-expanded={open}
                onClick={() => s.setRowMenuId(open ? null : st.id)}
                className={cn(
                  'w-[26px] h-[26px] grid place-items-center border-0 rounded-[9px] cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent',
                  open ? 'bg-accent-soft text-accent' : 'bg-transparent text-ink-faint'
                )}
              >
                <MoreHorizontal size={15} strokeWidth={2} />
              </button>
              {open && (
                <div className="absolute right-0 top-[calc(100%+5px)] z-[40] py-[12px] px-[14px] bg-raised border border-line-strong rounded-[14px] shadow-pop text-[11.5px] whitespace-nowrap animate-fadeUp">
                  <div className="text-[9.5px] tracking-[.06em] uppercase text-ink-faint mb-[5px]">Contact</div>
                  <div className="text-ink-soft tabular-nums">Student · {st.phone}</div>
                  <div className="text-ink-soft tabular-nums mt-[2px]">Guardian · {st.guardianPhone}</div>
                </div>
              )}
            </div>
          );
        },
      })
    );

    return cols;
  }, [s]);

  const table = useReactTable({ data: s.rows, columns, getCoreRowModel: getCoreRowModel() });
  const grid = s.scopeIsAll ? GRID_ALL : GRID_SCOPED;

  return (
    <div className="relative border border-line rounded-[16px] bg-paper">
      {s.notifyHintOpen && (
        <div className="absolute top-[52px] left-[12px] z-[50] flex items-start gap-[8px] w-[214px] bg-ink text-sidebar text-[11.5px] font-[500] leading-[1.4] rounded-[12px] py-[9px] pl-[13px] pr-[8px] shadow-pop animate-fadeUp">
          <span className="absolute -top-[4px] left-[16px] w-[9px] h-[9px] bg-ink rotate-45 rounded-[1px]" />
          <span className="pt-[1px]">Select students to notify</span>
          <button
            type="button"
            aria-label="Dismiss tip"
            onClick={s.dismissNotifyHint}
            className="flex-none w-[20px] h-[20px] grid place-items-center border-0 bg-transparent rounded-[6px] text-[#B7C7CE] cursor-pointer transition-colors duration-200 hover:bg-[rgba(255,255,255,.12)] hover:text-white"
          >
            <X size={12} strokeWidth={2.2} />
          </button>
        </div>
      )}
      <div key={s.scopeTick} className="min-w-[1040px] animate-viewIn">
        {table.getHeaderGroups().map((hg) => (
          <div
            key={hg.id}
            className={cn(
              'grid gap-x-[14px] items-center sticky top-0 z-[45] py-[12px] px-[16px] bg-tint border-b border-line rounded-t-[15px] text-[10.5px] font-[500] tracking-[.07em] uppercase text-ink-muted',
              grid
            )}
          >
            {hg.headers.map((header) => (
              <div key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</div>
            ))}
          </div>
        ))}

        {table.getRowModel().rows.map((row, i) => {
          const isSelected = !!s.selected[row.original.id];
          return (
            <div
              key={row.id}
              style={s.settling ? { animationDelay: `${Math.min(i, 10) * 16}ms` } : undefined}
              className={cn(
                'grid gap-x-[14px] items-center py-[12px] px-[16px] border-t border-line-light transition-[background-color,box-shadow] duration-200 hover:bg-tint2',
                grid,
                isSelected ? 'bg-accent-soft shadow-[inset_3px_0_0_rgb(var(--c-accent))]' : 'bg-transparent',
                s.settling && 'animate-rowIn'
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <div key={cell.id} className="min-w-0">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          );
        })}

        {s.rows.length === 0 && (
          <div className="py-[56px] px-[20px] text-center">
            <div className="text-[14px] font-[600] text-ink">No results found</div>
            <div className="mt-[6px] text-[12.5px] text-ink-faint">
              Try clearing a filter, or switch to All my students to look across your classes.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
