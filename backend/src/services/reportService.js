'use strict';

// Business logic for Module 7 (Reports) — orchestrates other
// services' data into a ReportModel, hands it to a Generator for
// bytes, stores those bytes via DocumentService (never Storage
// directly — CLAUDE.md rule 2), then writes the outcome to
// generatedReportRepository (the ledger — ADR-018, not a domain
// repository this service "owns" the way FinanceService owns
// feePaymentRepository).
//
// Flow per Architecture.md 2.6/ADR-008: ReportModel -> Generator ->
// bytes -> DocumentService -> Storage. ReportService itself never
// generates bytes and never touches storage — csvGenerator.generate
// and documentService.uploadDocument do those two jobs respectively.
//
// No separate audit_log entry here: generated_reports IS the audit
// record for this action (richer than a generic audit_log row —
// report_type/format/document_id/error_message), not something that
// also needs a duplicate entry alongside it (see ADR-018).
//
// Only one report type this slice — student_export, now with all four
// tabular output formats (csv/pdf/xlsx/docx). This completes the
// Generator Module's tabular lineup; PPT stays parked (no real ask for
// it), and any second report type is still deferred until a real
// screen asks for one, same restraint every other module's first
// slice applies to unbuilt capability.

const studentService = require('./studentService');
const documentService = require('./documentService');
const generatedReportRepository = require('../repositories/generatedReportRepository');
const attendanceRepository = require('../repositories/attendanceRepository');
const feePaymentRepository = require('../repositories/feePaymentRepository');
const assessmentService = require('./assessmentService');
const csvGenerator = require('../generators/csvGenerator');
const pdfGenerator = require('../generators/pdfGenerator');
const excelGenerator = require('../generators/excelGenerator');
const wordGenerator = require('../generators/wordGenerator');

// Missing collegeId or actorUserId — nothing downstream (documentService,
// the ledger write) can proceed without either, same guard shape every
// other service's own top-level validation error gives.
class ReportValidationError extends Error {}

// format isn't one of GENERATORS' known keys — same "known-value,
// service-enforced, no DB CHECK" shape documentService's
// DocumentReviewStatusError already uses for reviewDocument's status.
class ReportFormatError extends Error {}

// All four generators return Promise<Buffer> (ADR-019) so this map
// can await any of them identically regardless of format.
const GENERATORS = {
  csv: { generate: csvGenerator.generate, mimeType: 'text/csv', extension: 'csv' },
  pdf: { generate: pdfGenerator.generate, mimeType: 'application/pdf', extension: 'pdf' },
  xlsx: {
    generate: excelGenerator.generate,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  },
  docx: {
    generate: wordGenerator.generate,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
  },
};

// students table columns worth exporting, real column names (not
// frontend/src/components/CsvExportModal.jsx's own stale MongoDB-era
// aliases — roll_number/name/etc. — since that modal already carries
// its own fallback-alias logic for exactly this old-vs-new mismatch).
// Its "Attendance" section (attendance %, blood_group, dob) is
// dropped entirely: none of those three exist as real students
// columns anywhere in this schema — not fabricated here either.
const STUDENT_EXPORT_COLUMNS = [
  ['roll_no', 'Roll Number'],
  ['full_name', 'Full Name'],
  ['department', 'Department'],
  ['batch', 'Batch'],
  ['admission_year', 'Admission Year'],
  ['current_semester', 'Current Semester'],
  ['section', 'Section'],
  ['lifecycle_status', 'Status'],
  ['attendance_percentage', 'Attendance %'],
  ['fee_status', 'Fee Status'],
  ['gender', 'Gender'],
  ['entry_type', 'Entry Type'],
  ['emis_number', 'EMIS Number'],
  ['umis_number', 'UMIS Number'],
  ['email', 'Email Address'],
  ['phone', 'Phone Number'],
  ['parent_name', 'Parent Name'],
  ['parent_phone', 'Parent Phone'],
  ['address', 'Home Address'],
  ['pincode', 'Pincode'],
  ['mark_10th', '10th Mark'],
  ['mark_12th', '12th Mark'],
  ['mark_iti', 'ITI Mark'],
  ['accommodation', 'Accommodation'],
  ['club', 'Club'],
  ['internship', 'Internship'],
  ['career_plan', 'Career Plan'],
  ['notes', 'Notes'],
  ['license_number', 'License Number'],
  ['bike_number', 'Bike Number'],
];

const STUDENT_EXPORT_COLUMN_IDS = new Set(STUDENT_EXPORT_COLUMNS.map(([id]) => id));

// Frontend sends whichever subset/order the user picked in the export
// dialog (column checklist + drag-reorder); unknown ids are dropped
// rather than rejected so a stale saved template (columns renamed
// since) degrades gracefully instead of failing the whole export.
function resolveExportColumns(requested) {
  if (!Array.isArray(requested) || requested.length === 0) {
    return STUDENT_EXPORT_COLUMNS;
  }
  const picked = requested.filter((id) => STUDENT_EXPORT_COLUMN_IDS.has(id));
  return picked.length > 0
    ? picked.map((id) => [id, STUDENT_EXPORT_COLUMNS.find(([colId]) => colId === id)[1]])
    : STUDENT_EXPORT_COLUMNS;
}

// studentRepository.list has no "all, unpaginated" mode, and students
// has no class_id column anywhere in this schema yet (checked before
// assuming a class-scoped export was possible — TutorClass.jsx's own
// "student roster" has no real class filter to call either). A tenant
// with more students than this gets a truncated export — a flagged
// gap, not a real pagination story, same pragmatic hardcoded-limit
// shape PrincipalDashboard.jsx's own `?limit=200` fetches already use
// elsewhere in this codebase.
const STUDENT_EXPORT_LIMIT = 5000;
const REPORT_LIMIT = 5000;

function buildStudentExportReportModel(students, columns) {
  return {
    title: 'Student Export',
    columns: columns.map(([id, label]) => ({ id, label })),
    rows: students,
  };
}

function buildAttendanceReportModel(rows) {
  return {
    title: 'Attendance Report',
    columns: [
      { id: 'session_date', label: 'Date' },
      { id: 'class_id', label: 'Class' },
      { id: 'hour_index', label: 'Hour' },
      { id: 'total_students', label: 'Total' },
      { id: 'absent_count', label: 'Absent' },
      { id: 'present_count', label: 'Present' },
    ],
    rows: rows.map((row) => {
      const absentCount = Array.isArray(row.absent_student_ids) ? row.absent_student_ids.length : 0;
      return { ...row, absent_count: absentCount, present_count: Number(row.total_students) - absentCount };
    }),
  };
}

// RS-FIN-001/004 (D4, Stage 4): no fee-structure/amount concept left —
// one row per student's own fee status, never a per-fee-line
// breakdown.
function buildFinanceReportModel(feePayments) {
  return {
    title: 'Finance Report',
    columns: [
      { id: 'student_id', label: 'Student' },
      { id: 'status', label: 'Status' },
    ],
    rows: feePayments.map((row) => ({
      student_id: row.student_id,
      status: row.status,
    })),
  };
}

async function generateStudentExportReport(client, {
  collegeId, format = 'csv', columns: requestedColumns, studentIds,
}, { actorUserId, actorRole } = {}) {
  if (!collegeId || !actorUserId) {
    throw new ReportValidationError('collegeId and actorUserId are required');
  }
  const generator = GENERATORS[format];
  if (!generator) {
    throw new ReportFormatError(`format ${JSON.stringify(format)} is not supported`);
  }
  const columns = resolveExportColumns(requestedColumns);

  try {
    // RS-CLS-005 ("any timetable-linked staff member MAY export that
    // class's student data; staff with no timetable link have zero
    // access"): forwards the real actor context into
    // studentService.listStudents instead of an unscoped college-wide
    // read, the exact same scoping GET /students already applies (own
    // class + faculty_allocation classes for staff, department for
    // hod, unrestricted for principal) — one shared resolution, not a
    // second copy of it here.
    let students = await studentService.listStudents(
      client,
      { limit: STUDENT_EXPORT_LIMIT },
      { actorUserId, actorRole, collegeId },
    );
    // Row-scoping ("current page" vs "all filtered rows" in the export
    // dialog) happens client-side against the same /students payload,
    // so the dialog already knows exactly which ids it wants — re-fetch
    // here (not trust client-supplied rows) and filter+reorder to match,
    // same "never trust client data for what goes in a stored file"
    // reasoning documentService.uploadDocument's own callers follow.
    if (Array.isArray(studentIds) && studentIds.length > 0) {
      const byId = new Map(students.map((s) => [String(s.id), s]));
      students = studentIds.map((id) => byId.get(String(id))).filter(Boolean);
    }
    const bytes = await generator.generate(buildStudentExportReportModel(students, columns));

    // studentId omitted — this file belongs to no single student
    // (documents.student_id is nullable as of 1752800000000, exactly
    // for this case).
    const document = await documentService.uploadDocument(
      client,
      { collegeId, docType: 'generated_report', fileName: `student_export_${Date.now()}.${generator.extension}`, mimeType: generator.mimeType, fileBuffer: bytes },
      { actorUserId },
    );

    return await generatedReportRepository.create(client, {
      collegeId,
      requestedByUserId: actorUserId,
      reportType: 'student_export',
      format,
      // RS-CLS-005 ("every export is logged — who, which class, when"):
      // requested_by_user_id + created_at already cover who/when
      // (ADR-018 — generated_reports IS the audit record, no duplicate
      // audit_log entry). "which class" still doesn't apply as a single
      // value — export scoping is now per-actor (may span several
      // visible classes for staff/hod, or the whole college for
      // principal), not one fixed classId — so studentCount is the
      // fact that actually reflects what was exported.
      parameters: { columnCount: columns.length, studentCount: students.length },
      status: 'completed',
      documentId: document.id,
    });
  } catch (err) {
    if (err instanceof ReportValidationError || err instanceof ReportFormatError) {
      throw err;
    }
    // Returned, not re-thrown: this whole function runs inside the
    // caller's request-scoped transaction (req.dbClient), and every
    // other route in this codebase rolls that transaction back
    // whenever a handler throws. Re-throwing here would undo the very
    // 'failed' row this catch block is trying to preserve — the
    // ledger write would commute with the request's own rollback and
    // vanish. Resolving with the failed row instead lets the
    // transaction commit normally; the caller checks `.status` to
    // know the outcome, same as markFeePayment's plain-return contract
    // for a result that isn't itself an error.
    return generatedReportRepository.create(client, {
      collegeId,
      requestedByUserId: actorUserId,
      reportType: 'student_export',
      format,
      parameters: {},
      status: 'failed',
      errorMessage: err.message,
    });
  }
}

async function generateSimpleReport(client, { collegeId, format = 'csv', reportType, titleBuilder, loadRows }, { actorUserId } = {}) {
  if (!collegeId || !actorUserId) {
    throw new ReportValidationError('collegeId and actorUserId are required');
  }
  const generator = GENERATORS[format];
  if (!generator) {
    throw new ReportFormatError(`format ${JSON.stringify(format)} is not supported`);
  }

  try {
    const bytes = await generator.generate(titleBuilder(await loadRows()));
    const document = await documentService.uploadDocument(
      client,
      { collegeId, docType: 'generated_report', fileName: `${reportType}_${Date.now()}.${generator.extension}`, mimeType: generator.mimeType, fileBuffer: bytes },
      { actorUserId },
    );
    return await generatedReportRepository.create(client, {
      collegeId,
      requestedByUserId: actorUserId,
      reportType,
      format,
      parameters: {},
      status: 'completed',
      documentId: document.id,
    });
  } catch (err) {
    if (err instanceof ReportValidationError || err instanceof ReportFormatError) throw err;
    return generatedReportRepository.create(client, {
      collegeId,
      requestedByUserId: actorUserId,
      reportType,
      format,
      parameters: {},
      status: 'failed',
      errorMessage: err.message,
    });
  }
}

async function generateAttendanceReport(client, { collegeId, format = 'csv' }, opts = {}) {
  return generateSimpleReport(client, {
    collegeId,
    format,
    reportType: 'attendance_report',
    titleBuilder: buildAttendanceReportModel,
    loadRows: () => attendanceRepository.list(client, { limit: REPORT_LIMIT }),
  }, opts);
}

async function generateFinanceReport(client, { collegeId, format = 'csv' }, opts = {}) {
  return generateSimpleReport(client, {
    collegeId,
    format,
    reportType: 'finance_report',
    titleBuilder: buildFinanceReportModel,
    loadRows: () => feePaymentRepository.list(client, { limit: REPORT_LIMIT }),
  }, opts);
}

// BusinessRules.md Assessment marks: "marks can be exported using
// selected filters; CSV is the primary supported export format." No
// grade/weightage column here either — the raw stored value only,
// same "no automatic calculation" rule this codebase's own
// assessmentService.recordMark already follows; a Generator Module
// export must not silently introduce a calculation the entry path
// itself deliberately doesn't perform (ADR-008: the Generator Module
// is a pure formatter, never a second place business rules could
// diverge).
function buildAssessmentMarksReportModel(rows) {
  return {
    title: 'Assessment Marks',
    columns: [
      { id: 'academic_year', label: 'Academic Year' },
      { id: 'class_id', label: 'Class' },
      { id: 'subject', label: 'Subject' },
      { id: 'assessment_type_id', label: 'Assessment Type' },
      { id: 'student_id', label: 'Student' },
      { id: 'marks_obtained', label: 'Marks Obtained' },
    ],
    rows: rows.map((row) => ({
      academic_year: row.academic_year,
      class_id: row.class_id,
      subject: row.subject,
      assessment_type_id: row.assessment_type_id,
      student_id: row.student_id,
      marks_obtained: row.marks_obtained,
    })),
  };
}

async function generateAssessmentMarksReport(client, { collegeId, format = 'csv', filters = {} }, opts = {}) {
  return generateSimpleReport(client, {
    collegeId,
    format,
    reportType: 'assessment_marks_report',
    titleBuilder: buildAssessmentMarksReportModel,
    loadRows: () => assessmentService.listMarksForFilters(client, filters),
  }, opts);
}

module.exports = {
  ReportValidationError,
  ReportFormatError,
  generateStudentExportReport,
  generateAttendanceReport,
  generateFinanceReport,
  generateAssessmentMarksReport,
};
