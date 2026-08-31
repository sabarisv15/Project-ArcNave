import { useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { DrawerShell, DrawerRail, PRIMARY_BTN, GHOST_BTN } from './AttendanceActionDrawer';
import { TYPE_LABELS, percentageFor } from '../lib/assessmentsData';
import { downloadTextFile, printReport, rowsToCsv } from '../lib/reportBuilder';
import { formatDateDMY, formatTime12IST, istDayKey } from '../lib/ist';

/**
 * Every column the report can carry. `Result / status` is included because
 * absence is genuinely recorded; there is no pass/fail column, since no pass
 * mark is defined anywhere in the product and inventing one in a report would
 * be asserting a rule that doesn't exist.
 */
const COLUMNS = [
  ['sNo', 'S.No'],
  ['rollNumber', 'Roll number'],
  ['registerNumber', 'Register number'],
  ['studentName', 'Student name'],
  ['assessmentName', 'Assessment name'],
  ['assessmentType', 'Assessment type'],
  ['subject', 'Subject'],
  ['classCode', 'Class / section'],
  ['assessmentDate', 'Assessment date'],
  ['maxMarks', 'Maximum marks'],
  ['marksObtained', 'Marks obtained'],
  ['percentage', 'Percentage'],
  ['status', 'Result / status'],
];

const DEFAULT_COLUMNS = [
  'sNo',
  'rollNumber',
  'registerNumber',
  'studentName',
  'maxMarks',
  'marksObtained',
  'percentage',
  'status',
];

function buildRows(assessment, students) {
  return students.map((s, i) => {
    const entry = assessment.marks[s.id];
    const pct = percentageFor(entry, assessment.maxMarks);
    return {
      sNo: i + 1,
      rollNumber: s.roll,
      registerNumber: s.registerNumber,
      studentName: s.name,
      assessmentName: assessment.name,
      assessmentType: TYPE_LABELS[assessment.type],
      subject: assessment.subject,
      classCode: assessment.code,
      // DD/MM/YYYY here too — an export must not disagree with the screen it came from.
      assessmentDate: formatDateDMY(assessment.date),
      maxMarks: assessment.maxMarks,
      marksObtained: entry?.absent ? '—' : (entry?.value ?? ''),
      percentage: pct === null ? '—' : `${pct}%`,
      status: entry?.absent ? 'Absent' : typeof entry?.value === 'number' ? 'Recorded' : 'Not entered',
    };
  });
}

function slug(text) {
  return String(text || 'assessment')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Report for one assessment — CSV with a column picker, or a print-formatted PDF. */
export function AssessmentReportDrawer({ assessment, students, onClose }) {
  const [selected, setSelected] = useState(DEFAULT_COLUMNS);
  const [previewOpen, setPreviewOpen] = useState(true);

  const rows = useMemo(() => (assessment ? buildRows(assessment, students) : []), [assessment, students]);

  if (!assessment) return null;

  const toggle = (key) =>
    setSelected((prev) =>
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : COLUMNS.map(([k]) => k).filter((k) => prev.includes(k) || k === key),
    );

  const marked = rows.filter((r) => r.status !== 'Not entered');
  const numeric = rows.filter((r) => typeof r.marksObtained === 'number');
  const average = numeric.length
    ? Math.round((numeric.reduce((sum, r) => sum + r.marksObtained, 0) / numeric.length) * 10) / 10
    : 0;

  const scopeLines = [
    `${assessment.name} · ${TYPE_LABELS[assessment.type]}`,
    `${assessment.subject} · ${assessment.code}`,
    `Assessment date ${formatDateDMY(assessment.date)} · Maximum marks ${assessment.maxMarks}`,
  ];

  const filename = (ext) =>
    `assessment-report_${slug(assessment.name)}_${slug(assessment.code)}_${istDayKey(new Date())}.${ext}`;

  const exportCsv = () => {
    downloadTextFile(filename('csv'), rowsToCsv(rows, selected, COLUMNS));
  };

  const exportPdf = () => {
    printReport({
      title: `Assessment report — ${assessment.name}`,
      generatedAt: `${formatDateDMY(new Date())} · ${formatTime12IST(new Date())} IST`,
      scopeLines,
      filterLines: [],
      columns: selected,
      columnDefs: COLUMNS,
      rows,
      summary: {
        title: 'Summary',
        rows: [
          ['Students', String(rows.length)],
          ['Marks entered', `${marked.length} / ${rows.length}`],
          ['Absent', String(rows.filter((r) => r.status === 'Absent').length)],
          ['Average marks', `${average} / ${assessment.maxMarks}`],
        ],
      },
      landscape: selected.length > 8,
    });
  };

  return (
    <DrawerShell
      open={!!assessment}
      onOpenChange={(v) => !v && onClose()}
      title="Assessment report"
      contextLine={`${assessment.name} · ${assessment.subject} · ${assessment.code} · ${formatDateDMY(assessment.date)}`}
      description={`Export the marks report for ${assessment.name}`}
      width="sm:w-[560px]"
    >
      <div className="flex-none px-[18px] pt-[13px] pb-[10px]">
        <div className="flex items-center gap-[8px] mb-[8px]">
          <span className="text-[10.5px] font-[500] uppercase tracking-[.06em] text-ink-faint">Choose columns</span>
          <span className="text-[11px] text-ink-faint tabular-nums">
            {selected.length}/{COLUMNS.length}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSelected(COLUMNS.map(([k]) => k))}
            className="h-[24px] px-[8px] border-0 bg-transparent rounded-[7px] font-sans text-[11px] font-[500] text-ink-muted cursor-pointer hover:bg-tint2 hover:text-ink"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelected([])}
            className="h-[24px] px-[8px] border-0 bg-transparent rounded-[7px] font-sans text-[11px] font-[500] text-ink-muted cursor-pointer hover:bg-tint2 hover:text-ink"
          >
            Clear all
          </button>
        </div>

        <div className="flex flex-wrap gap-[6px]">
          {COLUMNS.map(([key, label]) => {
            const on = selected.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                aria-pressed={on}
                className={cn(
                  'h-[26px] px-[9px] rounded-[8px] font-sans text-[11.5px] cursor-pointer transition-colors duration-200',
                  on
                    ? 'bg-accent-soft border border-accent-line text-accent font-[600]'
                    : 'bg-tint2 border border-transparent text-ink-soft font-[500] hover:bg-hoverline',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-none flex items-center gap-[8px] px-[18px] pb-[8px]">
        <span className="text-[10.5px] font-[500] uppercase tracking-[.06em] text-ink-faint">Preview</span>
        <span className="text-[11px] text-ink-faint tabular-nums">{rows.length} rows</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          aria-pressed={previewOpen}
          className="inline-flex items-center gap-[5px] h-[26px] px-[9px] border border-line rounded-[8px] bg-paper font-sans text-[11px] font-[500] text-ink-muted cursor-pointer hover:bg-tint2"
        >
          {previewOpen ? <EyeOff size={12} strokeWidth={1.9} /> : <Eye size={12} strokeWidth={1.9} />}
          {previewOpen ? 'Hide preview' : 'Show preview'}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto scroll-quiet bg-paper border-y border-line">
        {previewOpen ? (
          selected.length === 0 ? (
            <p className="py-[18px] text-[12px] text-ink-faint text-center">Select at least one column to preview.</p>
          ) : (
            <div className="min-w-max">
              <div
                className="sticky top-0 z-[46] flex bg-paper shadow-[inset_0_-1px_0_theme(colors.line.DEFAULT)]"
                style={{ minWidth: 'max-content' }}
              >
                {selected.map((key) => (
                  <span
                    key={key}
                    className="flex-none w-[132px] px-[10px] h-[30px] flex items-center text-[10px] font-[500] tracking-[.05em] uppercase text-ink-muted"
                  >
                    {Object.fromEntries(COLUMNS)[key]}
                  </span>
                ))}
              </div>
              {rows.map((r, i) => (
                <div key={i} className="flex border-t border-line-light">
                  {selected.map((key) => (
                    <span
                      key={key}
                      className="flex-none w-[132px] px-[10px] h-[32px] flex items-center text-[11.5px] text-ink-soft truncate"
                      title={String(r[key])}
                    >
                      {String(r[key])}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )
        ) : (
          <p className="py-[18px] text-[12px] text-ink-faint text-center">Preview hidden.</p>
        )}
      </div>

      <DrawerRail
        meta={
          <span className="text-[11px] text-ink-faint tabular-nums">
            {marked.length}/{rows.length} entered · avg {average}/{assessment.maxMarks}
          </span>
        }
      >
        <button type="button" className={GHOST_BTN} disabled={selected.length === 0} onClick={exportCsv}>
          Export CSV
        </button>
        <button type="button" className={PRIMARY_BTN} onClick={exportPdf}>
          Export PDF
        </button>
      </DrawerRail>
    </DrawerShell>
  );
}
