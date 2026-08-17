import { useMemo } from 'react';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Check, Copy } from 'lucide-react';
import { CopyFailureNote, useCopyState } from './ui/CopyButton';
import { cn } from '../lib/utils';
import { initials } from '../lib/staffData';

const helper = createColumnHelper();

// Department and Email are demoted on narrow screens (move into the detail
// drawer); the grid template changes at the same breakpoint the cells hide at.
//
// Every track is `minmax(0, …fr)` on purpose. A bare `fr` track keeps an
// implicit `auto` minimum, so the header grid and the row grid each resolve
// their widths from their *own* content and drift apart — which is what put
// the sticky header out of alignment with its rows once space got tight.
// Flooring the minimum at 0 makes both grids resolve identically at every
// width.
const GRID =
  'grid-cols-[minmax(0,1.8fr)_minmax(0,1.2fr)_minmax(0,1.3fr)] md:grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.3fr)]';

/**
 * Columns demoted at `<md` (their detail lives in the drawer instead). The
 * *wrapper* carries `hidden md:block`, not just the cell content — a hidden
 * child still occupies a grid track, which would push five items through a
 * three-column template and wrap the header out of alignment with its rows.
 */
const DEMOTED = new Set(['department', 'email']);
const demoteClass = (id) => (DEMOTED.has(id) ? 'hidden md:block' : '');

function EmailCell({ email }) {
  // The app's one copy behaviour — icon becomes a check, label becomes
  // "Copied", no toast. See `ui/CopyButton`.
  const { copied, failed, copy } = useCopyState({ getText: () => email });
  return (
    <div className="flex items-center gap-[7px] min-w-0">
      <a
        href={`mailto:${email}`}
        title={email}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 text-[12.5px] text-ink-soft truncate whitespace-nowrap overflow-hidden hover:text-accent hover:underline"
      >
        {email}
      </a>
      <button
        type="button"
        aria-label={copied ? 'Copied' : `Copy email address ${email}`}
        title={copied ? 'Copied' : 'Copy email address'}
        onClick={(e) => {
          e.stopPropagation(); // the row itself opens the staff drawer
          copy();
        }}
        className="flex-none w-[22px] h-[22px] grid place-items-center border-0 bg-transparent rounded-[6px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        {copied ? <Check size={12} strokeWidth={2.4} className="text-accent" /> : <Copy size={12} strokeWidth={1.9} />}
      </button>
      <CopyFailureNote failed={failed} />
    </div>
  );
}

/** The staff directory table — same rounded/sticky-header/hover pattern as Students. */
export function StaffTable({ s }) {
  const columns = useMemo(
    () => [
      helper.accessor('name', {
        header: 'Staff member',
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex items-center gap-[10px] min-w-0">
              <span className="flex-none w-[30px] h-[30px] grid place-items-center rounded-full bg-accent-soft text-accent text-[11.5px] font-[500]">
                {initials(p.name)}
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-[500] text-ink whitespace-nowrap overflow-hidden text-ellipsis">
                  {p.name}
                </span>
                <span className="block text-[11px] tabular-nums text-ink-faint mt-px truncate">{p.employeeId}</span>
              </span>
            </div>
          );
        },
      }),
      helper.accessor('designation', {
        header: 'Designation',
        cell: (info) => <span className="block text-[12.5px] text-ink-soft break-words">{info.getValue()}</span>,
      }),
      helper.accessor('department', {
        header: 'Department',
        cell: (info) => <span className="block text-[12.5px] text-ink-muted break-words">{info.getValue()}</span>,
      }),
      helper.accessor('phone', {
        header: 'Contact number',
        cell: (info) => <span className="block text-[12.5px] tabular-nums text-ink-soft truncate">{info.getValue()}</span>,
      }),
      helper.accessor('email', {
        header: 'Email',
        cell: (info) => <EmailCell email={info.getValue()} />,
      }),
    ],
    []
  );

  const table = useReactTable({ data: s.rows, columns, getCoreRowModel: getCoreRowModel() });

  return (
    /*
      Rounding + clipping live on the outer shell; the single scroll region is
      the element inside it. The header is sticky against *that* scroller, and
      it is fully opaque (never a translucent tint) so rows cannot bleed
      through as they pass underneath. Header and body cells share the one
      `GRID` template, so alignment holds through search, filter, sort,
      sidebar collapse and every breakpoint.
    */
    <div className="flex-1 min-h-0 border border-line rounded-[16px] bg-paper overflow-hidden">
      <div className="h-full overflow-auto scroll-quiet">
        {table.getHeaderGroups().map((hg) => (
          <div
            key={hg.id}
            className={cn(
              'grid gap-x-[10px] items-center sticky top-0 z-[46] py-[12px] px-[14px] bg-tint shadow-[inset_0_-1px_0_theme(colors.line.DEFAULT)] text-[10.5px] font-[500] tracking-[.07em] uppercase text-ink-muted',
              GRID
            )}
          >
            {hg.headers.map((header) => (
              <div key={header.id} className={demoteClass(header.column.id)}>
                {flexRender(header.column.columnDef.header, header.getContext())}
              </div>
            ))}
          </div>
        ))}

        {table.getRowModel().rows.map((row) => {
          const p = row.original;
          return (
            <div
              key={row.id}
              role="button"
              tabIndex={0}
              aria-label={`Open staff detail for ${p.name}`}
              onClick={() => s.openDetail(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  s.openDetail(p.id);
                }
              }}
              className={cn(
                'grid gap-x-[10px] items-center py-[12px] px-[14px] border-t border-line-light cursor-pointer transition-colors duration-200 hover:bg-tint2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
                GRID
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <div key={cell.id} className={cn('min-w-0', demoteClass(cell.column.id))}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          );
        })}

        {s.rows.length === 0 && (
          <div className="py-[56px] px-[20px] text-center">
            <div className="text-[14px] font-[600] text-ink">No results found</div>
            <div className="mt-[6px] text-[12.5px] text-ink-faint">Clear a filter or change the search term to see staff.</div>
          </div>
        )}
      </div>
    </div>
  );
}
