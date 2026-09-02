import { useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Dialog from '@radix-ui/react-dialog';
import { BookOpenText, Calendar, Check, ChevronDown, ClipboardList, Download, Eye, EyeOff, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { FILTER_SURFACE, FilterPopover, FilterSelect } from '../components/FilterPopover';
import { SearchPopoverField } from '../components/ToolbarIcons';
import { PANE, TABLE_HEAD, TableEmptyState } from '../components/WorkspaceLayout';
import { formatFullDate, formatTime } from '@/features/attendance/lib/attendanceData';
import { getISTParts } from '../lib/ist';
import {
  REPORT_SUBJECTS,
  REPORT_CLASS_CODES,
  REPORT_PROGRAMMES,
  REPORT_SEMESTERS,
  REPORT_ACADEMIC_YEARS,
  REPORT_SESSIONS,
} from '../lib/reportsData';
import {
  ATTENDANCE_REPORT_COLUMNS,
  ATTENDANCE_REPORT_DEFAULT_COLUMNS,
  CLASS_LOG_REPORT_COLUMNS,
  CLASS_LOG_REPORT_DEFAULT_COLUMNS,
  attendanceReportFilename,
  classLogReportFilename,
  buildAttendanceReportRows,
  buildClassLogReportRows,
  downloadTextFile,
  filterReportSessions,
  printReport,
  resolvePeriodRange,
  rowsToCsv,
  subjectHoursSummary,
} from '../lib/reportBuilder';

const CONTROL =
  'inline-flex items-center gap-[7px] h-[34px] px-[11px] rounded-[10px] border border-line bg-paper font-sans text-[12.5px] text-ink-soft cursor-pointer whitespace-nowrap transition-colors duration-200 hover:bg-tint2';
const CONTROL_ON = 'border-accent-line bg-accent-soft text-accent';
const ICON_BTN =
  'relative w-[34px] h-[34px] grid place-items-center rounded-[9px] cursor-pointer transition-colors duration-200';

/** Attendance report / Class log report — a compact segmented choice, never two large cards. */
function ReportTypeSegment({ value, onChange }) {
  const opts = [
    { key: 'attendance', label: 'Attendance report', Icon: ClipboardList },
    { key: 'classlog', label: 'Class log report', Icon: BookOpenText },
  ];
  return (
    <div role="tablist" aria-label="Report type" className="flex gap-[2px] p-[2px] bg-frame rounded-[11px] flex-none">
      {opts.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'flex items-center gap-[6px] h-[30px] px-[12px] border-0 rounded-[9px] font-sans text-[12.5px] cursor-pointer transition-colors duration-200 whitespace-nowrap',
            value === key
              ? 'bg-paper text-ink font-[600] shadow-seg'
              : 'bg-transparent text-ink-muted font-[500] hover:text-ink',
          )}
        >
          <Icon size={13} strokeWidth={1.9} />
          {label}
        </button>
      ))}
    </div>
  );
}

/** Compact icon+label dropdown trigger shared by Subject and Hours period. */
function IconDropdown({ Icon, label, active, children, width = 200 }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={cn(CONTROL, (open || active) && CONTROL_ON)}>
          <Icon size={14} strokeWidth={1.8} />
          <span className="max-w-[140px] truncate">{label}</span>
          <ChevronDown size={12} strokeWidth={2} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} style={{ width }} className={cn(FILTER_SURFACE, 'p-[10px]')}>
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SubjectDropdown({ value, onChange }) {
  return (
    <IconDropdown Icon={BookOpenText} label={value || 'All subjects'} active={!!value} width={210}>
      {({ close }) => (
        <div className="max-h-[260px] overflow-y-auto scroll-quiet -m-[5px] p-[5px]">
          {[['', 'All subjects'], ...REPORT_SUBJECTS.map((s) => [s, s])].map(([v, label]) => (
            <button
              key={v || 'all'}
              type="button"
              onClick={() => {
                onChange(v);
                close();
              }}
              className={cn(
                'flex items-center justify-between w-full h-[30px] px-[9px] border-0 bg-transparent rounded-[8px] font-sans text-[12.5px] cursor-pointer text-left hover:bg-tint2',
                v === value ? 'text-accent font-[600]' : 'text-ink-soft font-[500]',
              )}
            >
              <span className="truncate">{label}</span>
              {v === value && <Check size={12} strokeWidth={2.4} className="text-accent flex-none" />}
            </button>
          ))}
        </div>
      )}
    </IconDropdown>
  );
}

function HoursPeriodDropdown({ period, setPeriod }) {
  const nowIST = getISTParts(new Date());
  const monthValue = `${period.year ?? nowIST.year}-${String((period.month ?? nowIST.month) + 1).padStart(2, '0')}`;
  const label = period.mode === 'weekly' ? 'Weekly' : 'Monthly';

  return (
    <IconDropdown Icon={Calendar} label={label} active width={230}>
      <div className="flex items-center gap-[6px] mb-[10px]">
        {['weekly', 'monthly'].map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setPeriod((p) => ({ ...p, mode }))}
            className={cn(
              'h-[28px] px-[12px] rounded-[9px] font-sans text-[11.5px] font-[500] cursor-pointer transition-colors duration-200',
              period.mode === mode
                ? 'bg-accent-soft border border-accent-line text-accent'
                : 'bg-tint2 border border-transparent text-ink-soft hover:bg-hoverline',
            )}
          >
            {mode === 'weekly' ? 'Weekly' : 'Monthly'}
          </button>
        ))}
      </div>
      {period.mode === 'weekly' ? (
        <label className="block">
          <span className="block text-[10.5px] text-ink-faint mb-[5px]">Any date within the week</span>
          <input
            type="date"
            value={period.weekOf ?? ''}
            onChange={(e) => setPeriod((p) => ({ ...p, weekOf: e.target.value }))}
            className="w-full h-[32px] border border-line rounded-[9px] bg-paper font-sans text-[12px] text-ink px-[8px] outline-none focus:border-accent-line"
          />
        </label>
      ) : (
        <label className="block">
          <span className="block text-[10.5px] text-ink-faint mb-[5px]">Month and year</span>
          <input
            type="month"
            value={monthValue}
            onChange={(e) => {
              const [y, m] = e.target.value.split('-').map(Number);
              setPeriod((p) => ({ ...p, year: y, month: m - 1 }));
            }}
            className="w-full h-[32px] border border-line rounded-[9px] bg-paper font-sans text-[12px] text-ink px-[8px] outline-none focus:border-accent-line"
          />
        </label>
      )}
    </IconDropdown>
  );
}

function AdvancedFiltersPopover({ scope, setScope }) {
  const [open, setOpen] = useState(false);
  const opts = (all, list) => [{ value: '', label: all }, ...list.map((v) => ({ value: v, label: v }))];
  const activeCount = ['classCode', 'programme', 'semester', 'academicYear'].filter((k) => scope[k]).length;

  return (
    <FilterPopover
      open={open}
      onOpenChange={setOpen}
      activeCount={activeCount}
      iconOnly
      label="More filters"
      width={280}
      onClear={() => setScope((s) => ({ ...s, classCode: '', programme: '', semester: '', academicYear: '' }))}
    >
      <div className="grid grid-cols-1 gap-[12px]">
        <FilterSelect
          label="Class"
          value={scope.classCode}
          onChange={(v) => setScope((s) => ({ ...s, classCode: v }))}
          options={opts('All classes', REPORT_CLASS_CODES)}
        />
        <FilterSelect
          label="Programme"
          value={scope.programme}
          onChange={(v) => setScope((s) => ({ ...s, programme: v }))}
          options={opts('All programmes', REPORT_PROGRAMMES)}
        />
        <FilterSelect
          label="Semester"
          value={scope.semester}
          onChange={(v) => setScope((s) => ({ ...s, semester: v }))}
          options={opts('All semesters', REPORT_SEMESTERS)}
        />
        <FilterSelect
          label="Academic year"
          value={scope.academicYear}
          onChange={(v) => setScope((s) => ({ ...s, academicYear: v }))}
          options={opts('All years', REPORT_ACADEMIC_YEARS)}
        />
      </div>
    </FilterPopover>
  );
}

function useExportColumns(storageKey, allColumns, defaultKeys) {
  const [columns, setColumns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (Array.isArray(saved) && saved.length) return saved;
    } catch {
      // ignore malformed storage
    }
    return defaultKeys;
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(columns));
    } catch {
      /* ignore quota errors */
    }
  }, [columns, storageKey]);

  const toggle = (key) => setColumns((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const selectAll = () => setColumns(allColumns.map(([key]) => key));
  const clearAll = () => setColumns([]);
  const orderedSelected = allColumns.map(([key]) => key).filter((key) => columns.includes(key));

  return { columns: orderedSelected, toggle, selectAll, clearAll, isChecked: (key) => columns.includes(key) };
}

function ColumnSelector({ allColumns, cols }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-[8px]">
        <span className="text-[11px] tracking-[.05em] uppercase text-ink-faint">
          Choose columns · {cols.columns.length} selected
        </span>
        <div className="flex items-center gap-[10px]">
          <button
            type="button"
            onClick={cols.selectAll}
            className="text-[11.5px] font-[500] text-accent bg-transparent border-0 cursor-pointer hover:underline"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={cols.clearAll}
            className="text-[11.5px] font-[500] text-ink-muted bg-transparent border-0 cursor-pointer hover:underline"
          >
            Clear all
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-[10px] gap-y-[2px]">
        {allColumns.map(([key, label]) => {
          const checked = cols.isChecked(key);
          return (
            <button
              key={key}
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() => cols.toggle(key)}
              className="flex items-center gap-[8px] w-full p-[6px] border-0 bg-transparent rounded-[10px] font-sans text-[12.5px] text-ink-soft cursor-pointer text-left hover:bg-tint2"
            >
              <span
                className={cn(
                  'w-[17px] h-[17px] rounded-[5px] flex-none grid place-items-center border transition-colors duration-200',
                  checked ? 'bg-accent border-accent text-white' : 'bg-paper border-line',
                )}
              >
                {checked && <Check size={10} strokeWidth={3} />}
              </span>
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Icon-only export trigger — opens the compact CSV/PDF + column-picker dialog. */
function ExportDialog({ allColumns, cols, format, setFormat, onGenerate, disabled }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Export report"
          title="Export"
          className={cn(ICON_BTN, 'text-ink-soft hover:bg-tint2')}
        >
          <Download size={15} strokeWidth={1.9} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-overlay/20 animate-fadeUp" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[121] w-[min(92vw,420px)] max-h-[85vh] overflow-y-auto scroll-quiet bg-paper border border-line rounded-[18px] shadow-dialog outline-none p-[20px] animate-fadeUp">
          <div className="flex items-center justify-between mb-[14px]">
            <Dialog.Title className="m-0 text-[15px] font-[600] text-ink">Export report</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="w-[28px] h-[28px] grid place-items-center border-0 bg-transparent rounded-[9px] text-ink-faint cursor-pointer hover:bg-tint2 hover:text-ink"
              >
                <X size={16} strokeWidth={1.9} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Choose an export format and, for CSV, which columns to include.
          </Dialog.Description>

          <div className="flex gap-[8px] mb-[16px]">
            {['csv', 'pdf'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={cn(
                  'flex-1 h-[34px] border rounded-[11px] font-sans text-[12.5px] font-[500] cursor-pointer transition-colors duration-200',
                  format === f
                    ? 'border-accent-line bg-accent-soft text-accent'
                    : 'border-line bg-paper text-ink-soft hover:bg-tint2',
                )}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>

          {format === 'csv' && <ColumnSelector allColumns={allColumns} cols={cols} />}

          <button
            type="button"
            onClick={() => {
              onGenerate();
              setOpen(false);
            }}
            disabled={disabled}
            className={cn(
              'mt-[16px] w-full h-[38px] border-0 rounded-[11px] font-sans text-[13px] font-[500] inline-flex items-center justify-center gap-[7px]',
              disabled
                ? 'bg-frame text-ink-disabled cursor-not-allowed'
                : 'bg-accent text-white cursor-pointer hover:bg-accent-hover active:bg-accent-press',
            )}
          >
            <Download size={15} strokeWidth={1.9} />
            {format === 'csv' ? 'Download CSV' : 'Download PDF'}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Report preview — the full result set scrolls inside its own rounded
 * container with the column header stuck to the top, rather than truncating
 * to a handful of rows and pushing the rest onto the page scroll.
 */
function PreviewTable({ columns, rows, query = '' }) {
  const term = query.trim().toLowerCase();
  const filtered = term
    ? rows.filter((row) =>
        columns.some(([key]) =>
          String(row[key] ?? '')
            .toLowerCase()
            .includes(term),
        ),
      )
    : rows;

  if (columns.length === 0) {
    return <p className="flex-none text-[12px] text-ink-faint">Select at least one column to preview.</p>;
  }
  return (
    <div className="flex-1 min-h-0 border border-line rounded-[14px] bg-paper overflow-hidden">
      <div className="h-full overflow-auto scroll-quiet">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <th
                  key={key}
                  className={cn(
                    'sticky top-0 z-[46] text-left bg-tint border-b border-line py-[9px] px-[12px] whitespace-nowrap',
                    TABLE_HEAD,
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={i} className="border-t border-line-light">
                {columns.map(([key]) => (
                  <td key={key} className="py-[9px] px-[12px] text-ink-soft whitespace-nowrap">
                    {key === 'attendancePercentage' ? `${row[key]}%` : String(row[key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <TableEmptyState title={rows.length === 0 ? 'No records in this scope' : 'No results found'} />
        )}
      </div>
    </div>
  );
}

function scopeLabel(scope) {
  return scope.classCode || scope.subject || scope.programme || 'all-classes';
}

/**
 * Curriculum → Attendance → Reports — its own adjacent section
 * (`AttendanceTabsLayout` supplies the shared scroll shell). One compact
 * control row (report type · subject · hours period · advanced filters ·
 * export · Preview), never a generic analytics dashboard or a
 * report-builder page of cards. Preserves the underlying rules: Submitted-
 * only attendance %, Locked+Submitted class-log hours, CSV/PDF export with
 * a working column picker.
 */
export function ReportsView() {
  const [reportType, setReportType] = useState('attendance');
  const [scope, setScope] = useState({ subject: '', classCode: '', programme: '', semester: '', academicYear: '' });
  const [period, setPeriod] = useState({ mode: 'weekly', weekOf: '' });
  const [format, setFormat] = useState('csv');
  // Open by default: the preview *is* the report, so it should never take a
  // click to see. Collapsing is opt-in, for when the controls need the room.
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewQuery, setPreviewQuery] = useState('');

  const attendanceCols = useExportColumns(
    'arcnave.report.columns.attendance',
    ATTENDANCE_REPORT_COLUMNS,
    ATTENDANCE_REPORT_DEFAULT_COLUMNS,
  );
  const classLogCols = useExportColumns(
    'arcnave.report.columns.classlog',
    CLASS_LOG_REPORT_COLUMNS,
    CLASS_LOG_REPORT_DEFAULT_COLUMNS,
  );
  const cols = reportType === 'attendance' ? attendanceCols : classLogCols;
  const columnDefs = reportType === 'attendance' ? ATTENDANCE_REPORT_COLUMNS : CLASS_LOG_REPORT_COLUMNS;

  const range = resolvePeriodRange(period);
  const scoped = useMemo(
    () => filterReportSessions(REPORT_SESSIONS, { ...scope, ...range }),
    [scope, range.dateFrom, range.dateTo],
  );
  const rows = useMemo(
    () => (reportType === 'attendance' ? buildAttendanceReportRows(scoped) : buildClassLogReportRows(scoped)),
    [reportType, scoped],
  );
  const summary = useMemo(() => (reportType === 'classlog' ? subjectHoursSummary(scoped) : []), [reportType, scoped]);
  const submittedCount = scoped.filter((s) => s.status === 'submitted').length;
  const excludedCount = scoped.length - submittedCount;

  const generate = () => {
    const label = scopeLabel(scope);
    if (reportType === 'attendance') {
      if (format === 'csv') {
        downloadTextFile(
          attendanceReportFilename(label, period.mode, 'csv'),
          rowsToCsv(rows, cols.columns, ATTENDANCE_REPORT_COLUMNS),
        );
      } else {
        printReport({
          title: 'Attendance report',
          generatedAt: `${formatFullDate(new Date())} · ${formatTime(new Date())} IST`,
          scopeLines: [
            `Period: ${period.mode === 'weekly' ? 'Weekly' : 'Monthly'} (${range.dateFrom} to ${range.dateTo})`,
            'Only submitted attendance is included in these calculations.',
          ],
          filterLines: [],
          columns: ATTENDANCE_REPORT_COLUMNS.map(([k]) => k),
          columnDefs: ATTENDANCE_REPORT_COLUMNS,
          rows,
          landscape: true,
        });
      }
    } else {
      if (format === 'csv') {
        downloadTextFile(
          classLogReportFilename(label, range.dateFrom, range.dateTo, 'csv'),
          rowsToCsv(rows, cols.columns, CLASS_LOG_REPORT_COLUMNS),
        );
        const summaryCsv = rowsToCsv(
          summary.map((r, i) => ({ sNo: i + 1, subject: r.subject, hours: r.hours })),
          ['sNo', 'subject', 'hours'],
          [
            ['sNo', 'S.No'],
            ['subject', 'Subject'],
            ['hours', 'Total teaching hours'],
          ],
        );
        downloadTextFile(
          classLogReportFilename(`${label}-subject-hours-summary`, range.dateFrom, range.dateTo, 'csv'),
          summaryCsv,
        );
      } else {
        printReport({
          title: 'Class log report',
          generatedAt: `${formatFullDate(new Date())} · ${formatTime(new Date())} IST`,
          scopeLines: [`Range: ${range.dateFrom} to ${range.dateTo}`],
          filterLines: [],
          columns: CLASS_LOG_REPORT_COLUMNS.map(([k]) => k),
          columnDefs: CLASS_LOG_REPORT_COLUMNS,
          rows,
          landscape: true,
          summary: {
            title: 'Total teaching hours by subject',
            rows: summary.map((r) => [r.subject, `${r.hours} hours`]),
          },
        });
      }
    }
  };

  return (
    <div className={PANE}>
      {/* One compact control row: report type · subject · hours period · filters · export · preview toggle. */}
      <div className="flex-none flex items-center gap-[8px] flex-wrap mb-[14px]">
        <ReportTypeSegment value={reportType} onChange={setReportType} />
        <SubjectDropdown value={scope.subject} onChange={(v) => setScope((s) => ({ ...s, subject: v }))} />
        <HoursPeriodDropdown period={period} setPeriod={setPeriod} />
        <AdvancedFiltersPopover scope={scope} setScope={setScope} />
        <div className="flex-1" />
        <ExportDialog
          allColumns={columnDefs}
          cols={cols}
          format={format}
          setFormat={setFormat}
          onGenerate={generate}
          disabled={format === 'csv' && cols.columns.length === 0}
        />
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          aria-expanded={previewOpen}
          aria-label={previewOpen ? 'Hide preview' : 'Show preview'}
          title={previewOpen ? 'Hide preview' : 'Show preview'}
          className={cn(ICON_BTN, previewOpen ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-tint2')}
        >
          {previewOpen ? <Eye size={15} strokeWidth={1.9} /> : <EyeOff size={15} strokeWidth={1.9} />}
        </button>
      </div>

      {reportType === 'attendance' && (
        <p className="flex-none mt-0 mb-[14px] text-[11.5px] text-ink-faint leading-[1.5]">
          Only submitted attendance is included in attendance calculations.
          {excludedCount > 0 &&
            ` ${excludedCount} locked-but-unsubmitted session${excludedCount === 1 ? '' : 's'} in this scope ${excludedCount === 1 ? 'is' : 'are'} excluded.`}
        </p>
      )}

      {reportType === 'classlog' && summary.length > 0 && (
        <div className="flex-none flex flex-wrap gap-[8px] mb-[14px]">
          {summary.map((r) => (
            <span
              key={r.subject}
              className="inline-flex items-center gap-[6px] h-[26px] px-[10px] rounded-[9px] bg-tint2 text-[11.5px] font-[500] text-ink-soft"
            >
              {r.subject} <span className="text-accent">— {r.hours}h</span>
            </span>
          ))}
        </div>
      )}

      {previewOpen && (
        <>
          <div className="flex-none flex items-center gap-[8px] mb-[10px] flex-wrap">
            <span className="text-[13px] font-[500] text-ink">Preview</span>
            <span className="text-[11.5px] text-ink-faint whitespace-nowrap">
              {rows.length} row{rows.length === 1 ? '' : 's'} · {range.dateFrom} to {range.dateTo}
            </span>
            <div className="flex-1" />
            <SearchPopoverField
              value={previewQuery}
              onChange={setPreviewQuery}
              placeholder="Search preview…"
              ariaLabel="Search report preview"
            />
          </div>
          <PreviewTable
            columns={columnDefs.filter(([k]) => cols.columns.includes(k))}
            rows={rows}
            query={previewQuery}
          />
        </>
      )}
    </div>
  );
}
