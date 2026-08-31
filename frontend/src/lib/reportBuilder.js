import { formatFullDate, formatTime } from './attendanceData';
import { DAY_MS, getISTParts, istDayKey, parseISTDateBounds, startOfWeekIST } from './ist';
import { sessionDurationHours } from './reportsData';

/** Shared scope filter for both report builders — subject/class/programme/year/semester/academic year + IST date range. */
export function filterReportSessions(sessions, scope) {
  return sessions.filter((s) => {
    if (scope.subject && s.subject !== scope.subject) return false;
    if (scope.classCode && s.classCode !== scope.classCode) return false;
    if (scope.programme && s.programme !== scope.programme) return false;
    if (scope.semester && s.semester !== scope.semester) return false;
    if (scope.academicYear && s.academicYear !== scope.academicYear) return false;
    if (scope.dateFrom && s.date < parseISTDateBounds(scope.dateFrom).start) return false;
    if (scope.dateTo && s.date > parseISTDateBounds(scope.dateTo).end) return false;
    return true;
  });
}

/** Weekly/monthly period → a concrete { dateFrom, dateTo } (YYYY-MM-DD, IST calendar), computed from the current IST clock. */
export function resolvePeriodRange({ mode, weekOf, month, year }) {
  if (mode === 'weekly') {
    const base = weekOf ? parseISTDateBounds(weekOf).start : new Date();
    const from = startOfWeekIST(base);
    const to = new Date(from.getTime() + 6 * DAY_MS);
    return { dateFrom: istDayKey(from), dateTo: istDayKey(to) };
  }
  // monthly
  const nowParts = getISTParts(new Date());
  const y = year ?? nowParts.year;
  const m = month ?? nowParts.month;
  const from = parseISTDateBounds(`${y}-${String(m + 1).padStart(2, '0')}-01`).start;
  const to = new Date(startOfNextMonthIST(y, m).getTime() - 1);
  return { dateFrom: istDayKey(from), dateTo: istDayKey(to) };
}

function startOfNextMonthIST(year, month) {
  const y = month === 11 ? year + 1 : year;
  const m = month === 11 ? 0 : month + 1;
  return parseISTDateBounds(`${y}-${String(m + 1).padStart(2, '0')}-01`).start;
}

/**
 * Attendance report — Submitted sessions only (§6 rule: locked-but-unsubmitted
 * never contributes to totals/present hours/percentage). One row per student
 * per class present in scope.
 */
export function buildAttendanceReportRows(sessions) {
  const submitted = sessions.filter((s) => s.status === 'submitted');
  const byStudent = new Map();

  for (const session of submitted) {
    const hours = sessionDurationHours(session);
    for (const student of session.roster) {
      const key = `${session.classCode}|${student.id}`;
      if (!byStudent.has(key)) {
        byStudent.set(key, {
          classCode: session.classCode,
          subject: session.subject,
          rollNumber: student.roll,
          registerNumber: student.registerNumber,
          studentName: student.name,
          semester: session.semester,
          academicYear: session.academicYear,
          totalHours: 0,
          presentHours: 0,
        });
      }
      const row = byStudent.get(key);
      row.totalHours += hours;
      if (session.presentIds.has(student.id)) row.presentHours += hours;
    }
  }

  return [...byStudent.values()]
    .sort((a, b) => a.studentName.localeCompare(b.studentName))
    .map((r, i) => ({
      sNo: i + 1,
      ...r,
      totalHours: round1(r.totalHours),
      presentHours: round1(r.presentHours),
      attendancePercentage: r.totalHours > 0 ? round1((r.presentHours / r.totalHours) * 100) : 0,
    }));
}

/**
 * Class log report — Locked and Submitted sessions both count as valid
 * teaching-hour records (a class-log hour is not the same measurement as an
 * attendance-percentage hour, which is Submitted-only — §7 rule).
 */
export function buildClassLogReportRows(sessions) {
  return [...sessions]
    .sort((a, b) => b.startTime - a.startTime)
    .map((s, i) => ({
      sNo: i + 1,
      date: formatFullDate(s.date),
      time: `${formatTime(s.startTime)}–${formatTime(s.endTime)}`,
      subject: s.subject,
      topicTaught: s.topicTaught,
      classCode: s.classCode,
      ownership: s.ownership === 'own' ? 'My class' : 'Substitute',
      status: s.status === 'submitted' ? 'Submitted' : 'Locked',
      hours: round1(sessionDurationHours(s)),
    }));
}

export function subjectHoursSummary(sessions) {
  const totals = new Map();
  for (const s of sessions) {
    totals.set(s.subject, (totals.get(s.subject) || 0) + sessionDurationHours(s));
  }
  return [...totals.entries()]
    .map(([subject, hours]) => ({ subject, hours: round1(hours) }))
    .sort((a, b) => b.hours - a.hours);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export const ATTENDANCE_REPORT_COLUMNS = [
  ['sNo', 'S.No'],
  ['rollNumber', 'Roll number'],
  ['registerNumber', 'Register number'],
  ['studentName', 'Student name'],
  ['semester', 'Semester'],
  ['academicYear', 'Academic year'],
  ['totalHours', 'Total hours'],
  ['presentHours', 'Present hours'],
  ['attendancePercentage', 'Attendance %'],
];

export const ATTENDANCE_REPORT_DEFAULT_COLUMNS = [
  'rollNumber',
  'registerNumber',
  'studentName',
  'semester',
  'academicYear',
  'totalHours',
  'presentHours',
  'attendancePercentage',
];

export const CLASS_LOG_REPORT_COLUMNS = [
  ['sNo', 'S.No'],
  ['date', 'Date'],
  ['time', 'Time'],
  ['subject', 'Subject / course'],
  ['topicTaught', 'Topic taught'],
  ['classCode', 'Class'],
  ['ownership', 'Ownership'],
  ['status', 'Status'],
];

export const CLASS_LOG_REPORT_DEFAULT_COLUMNS = ['date', 'time', 'subject', 'topicTaught', 'classCode', 'status'];

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows, columns, columnDefs) {
  const labelFor = Object.fromEntries(columnDefs);
  const header = columns.map((k) => csvCell(labelFor[k])).join(',');
  const lines = rows.map((r) => columns.map((k) => csvCell(r[k])).join(','));
  return [header, ...lines].join('\r\n');
}

export function downloadTextFile(filename, content, mime = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function slug(text) {
  return (
    String(text || 'scope')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'scope'
  );
}

export function attendanceReportFilename(scopeLabel, periodMode, ext) {
  const today = istDayKey(new Date());
  return `attendance-report_${slug(scopeLabel)}_${periodMode}_${today}.${ext}`;
}

export function classLogReportFilename(scopeLabel, dateFrom, dateTo, ext) {
  return `class-log-report_${slug(scopeLabel)}_${dateFrom}_to_${dateTo}.${ext}`;
}

/** Opens a print-formatted window and triggers the browser print dialog (user chooses "Save as PDF"). No client PDF library needed. */
export function printReport({
  title,
  generatedAt,
  scopeLines,
  filterLines,
  columns,
  columnDefs,
  rows,
  summary,
  landscape,
}) {
  const labelFor = Object.fromEntries(columnDefs);
  const win = window.open('', '_blank', 'width=1000,height=800');
  if (!win) return;

  const headCells = columns.map((k) => `<th>${escapeHtml(labelFor[k])}</th>`).join('');
  const bodyRows = rows.map((r) => `<tr>${columns.map((k) => `<td>${escapeHtml(r[k])}</td>`).join('')}</tr>`).join('');

  const summaryHtml = summary
    ? `<h2>${escapeHtml(summary.title)}</h2><table class="summary"><tbody>${summary.rows
        .map((r) => `<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td></tr>`)
        .join('')}</tbody></table>`
    : '';

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: ${landscape ? 'A4 landscape' : 'A4 portrait'}; margin: 16mm; }
  /* The print window is its own document, so it cannot read the app's CSS
     variables — these literals are the same neutral ramp, written out. */
  body { font-family: 'DM Sans', Arial, sans-serif; color: #000000; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 11px; color: #616161; margin-bottom: 2px; }
  .scope { font-size: 12px; color: #333333; margin: 10px 0 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 11px; }
  table.report thead { display: table-header-group; }
  table.report tr { break-inside: avoid; }
  th, td { border: 1px solid #E0E0E0; padding: 5px 8px; text-align: left; }
  th { background: #F8F8F8; text-transform: uppercase; letter-spacing: .04em; font-size: 9.5px; color: #616161; }
  h2 { font-size: 13px; margin: 18px 0 6px; }
  table.summary { width: auto; min-width: 260px; }
  .note { margin-top: 14px; font-size: 10.5px; color: #757575; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">Generated ${escapeHtml(generatedAt)}</div>
  ${scopeLines.map((l) => `<div class="scope">${escapeHtml(l)}</div>`).join('')}
  ${filterLines.length ? `<div class="scope">Filters: ${escapeHtml(filterLines.join(' · '))}</div>` : ''}
  ${summaryHtml}
  <table class="report">
    <thead><tr>${headCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
