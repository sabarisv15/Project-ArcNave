import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { CURRICULUM } from '../lib/mockData';
import { StudentsView } from './StudentsView';
import { StaffView } from './StaffView';

const helper = createColumnHelper();

/** Curriculum uses the same rounded workspace shell and the same quiet visual language. */
export function CurriculumView() {
  const { section = 'students' } = useParams();
  const data = CURRICULUM[section] ?? CURRICULUM.students;

  const columns = useMemo(
    () =>
      ['a', 'b', 'c', 'd'].map((key, i) =>
        helper.accessor(key, {
          header: data.cols[i],
          cell: (info) => info.getValue(),
        }),
      ),
    [data],
  );

  const table = useReactTable({ data: data.rows, columns, getCoreRowModel: getCoreRowModel() });
  const cellTone = ['font-[600]', 'text-ink-muted', 'text-ink-muted', 'text-accent'];

  // Students and Staff have their own dedicated screens; the other sections keep the generic table.
  if (section === 'students') return <StudentsView />;
  if (section === 'staff') return <StaffView />;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet pt-[26px] px-[32px] pb-[32px] animate-viewIn">
      <div className="max-w-[960px] mx-auto">
        <h1 className="m-0 text-[24px] font-[600] tracking-[-.015em]">{data.title}</h1>
        <p className="mt-[6px] mb-[22px] text-[13.5px] text-ink-muted">{data.sub}</p>
        <div className="border border-line rounded-[12px] overflow-hidden">
          {table.getHeaderGroups().map((hg) => (
            <div
              key={hg.id}
              className="grid grid-cols-[2fr_1.2fr_1.2fr_1fr] gap-[12px] py-[10px] px-[16px] bg-tint border-b border-line-light text-[11.5px] font-[500] tracking-[.05em] uppercase text-ink-faint"
            >
              {hg.headers.map((header) => (
                <span key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</span>
              ))}
            </div>
          ))}
          {table.getRowModel().rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[2fr_1.2fr_1.2fr_1fr] gap-[12px] py-[12px] px-[16px] border-b border-line-lighter text-[13px] hover:bg-tint2"
            >
              {row.getVisibleCells().map((cell, i) => (
                <span key={cell.id} className={cellTone[i]}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
