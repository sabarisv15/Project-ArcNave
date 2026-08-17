'use strict';

// Unit tests for ReportService's business-logic paths — no live
// Postgres, no real filesystem: studentService, documentService, and
// generatedReportRepository are stubbed via node:test's built-in mock,
// same technique as document-service.test.js/finance-service.test.js.
//
// What's deliberately NOT here: a real CSV byte round-trip through the
// filesystem, or a real documents.student_id-nullable INSERT — both
// already live-verified this slice (see .ai/RESULT.md) against a real
// DB/filesystem via a throwaway script, deleted after use per this
// project's own convention. csvGenerator itself (a pure function, no
// DB/storage) is exercised directly below, not mocked.

const test = require('node:test');
const assert = require('node:assert/strict');
const studentService = require('../src/services/studentService');
const documentService = require('../src/services/documentService');
const generatedReportRepository = require('../src/repositories/generatedReportRepository');
const csvGenerator = require('../src/generators/csvGenerator');
const pdfGenerator = require('../src/generators/pdfGenerator');
const excelGenerator = require('../src/generators/excelGenerator');
const wordGenerator = require('../src/generators/wordGenerator');
const reportService = require('../src/services/reportService');

test('csvGenerator.generate (pure function)', async (t) => {
  await t.test('produces a UTF-8-BOM-prefixed, quoted, header+rows CSV', async () => {
    const bytes = await csvGenerator.generate({
      columns: [{ id: 'a', label: 'Col "A"' }, { id: 'b', label: 'Col B' }],
      rows: [{ a: 'v1', b: null }, { a: 'has "quotes"', b: 42 }],
    });
    const text = bytes.toString('utf8');
    assert.equal(text.charCodeAt(0), 0xFEFF);
    const lines = text.slice(1).split('\n');
    assert.equal(lines[0], '"Col ""A""","Col B"');
    assert.equal(lines[1], '"v1",""');
    assert.equal(lines[2], '"has ""quotes""","42"');
  });
});

test('pdfGenerator.generate (pure function)', async (t) => {
  await t.test('produces real PDF bytes for a small ReportModel', async () => {
    const bytes = await pdfGenerator.generate({
      title: 'Test Report',
      columns: [{ id: 'a', label: 'Col A' }, { id: 'b', label: 'Col B' }],
      rows: [{ a: 'v1', b: 42 }, { a: null, b: 'v2' }],
    });
    assert.ok(Buffer.isBuffer(bytes));
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  await t.test('paginates when rows exceed one page', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ a: `row${i}`, b: i }));
    const bytes = await pdfGenerator.generate({
      title: 'Big Report',
      columns: [{ id: 'a', label: 'Col A' }, { id: 'b', label: 'Col B' }],
      rows,
    });
    // A real second page shows up as a second "/Type /Page" object in
    // the PDF's own object table — a mechanical property of the file
    // pdfkit wrote, not an assumption about its internals.
    const pageCount = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.ok(pageCount >= 2, `expected multiple pages, found ${pageCount}`);
  });
});

test('excelGenerator.generate (pure function)', async (t) => {
  await t.test('produces a real, readable .xlsx workbook with a header row and data rows', async () => {
    const ExcelJS = require('exceljs');
    const bytes = await excelGenerator.generate({
      title: 'Test Report',
      columns: [{ id: 'a', label: 'Col A' }, { id: 'b', label: 'Col B' }],
      rows: [{ a: 'v1', b: 42 }, { a: 'v2', b: 7 }],
    });
    assert.ok(Buffer.isBuffer(bytes));
    assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK'); // .xlsx is a zip archive

    // Read it back for real, not just sniff magic bytes — same rigor
    // pdfGenerator's own test applies via the PDF's own object table.
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheet = workbook.worksheets[0];
    assert.deepEqual(sheet.getRow(1).values.slice(1), ['Col A', 'Col B']);
    assert.deepEqual(sheet.getRow(2).values.slice(1), ['v1', 42]);
    assert.deepEqual(sheet.getRow(3).values.slice(1), ['v2', 7]);
  });

  await t.test('truncates a title longer than Excel\'s 31-char sheet-name limit', async () => {
    const ExcelJS = require('exceljs');
    const bytes = await excelGenerator.generate({
      title: 'A'.repeat(50),
      columns: [{ id: 'a', label: 'Col A' }],
      rows: [],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    assert.ok(workbook.worksheets[0].name.length <= 31);
  });
});

test('wordGenerator.generate (pure function)', async (t) => {
  await t.test('produces a real .docx (OOXML zip) containing the title and row text', async () => {
    const JSZip = require('jszip'); // devDependency, test-only — see .ai/RESULT.md
    const bytes = await wordGenerator.generate({
      title: 'Test Report',
      columns: [{ id: 'a', label: 'Col A' }, { id: 'b', label: 'Col B' }],
      rows: [{ a: 'v1', b: 42 }, { a: null, b: 'v2' }],
    });
    assert.ok(Buffer.isBuffer(bytes));
    assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK'); // .docx is a zip archive

    // Unzip for real and read the actual document XML — not just
    // sniffing magic bytes, same rigor excelGenerator's test applies
    // via a real ExcelJS.Workbook.load.
    const zip = await JSZip.loadAsync(bytes);
    assert.ok(zip.file('word/document.xml'), 'a real docx has a word/document.xml part');
    const xml = await zip.file('word/document.xml').async('string');
    assert.ok(xml.includes('Test Report'), 'document.xml contains the report title');
    assert.ok(xml.includes('Col A') && xml.includes('Col B'), 'document.xml contains the column headers');
    assert.ok(xml.includes('v1') && xml.includes('v2'), 'document.xml contains the row values');
  });
});

test('ReportService.generateStudentExportReport (no DB, no filesystem)', async (t) => {
  await t.test('rejects missing collegeId/actorUserId without touching any service', async () => {
    const listMock = t.mock.method(studentService, 'listStudents');
    const uploadMock = t.mock.method(documentService, 'uploadDocument');
    const createMock = t.mock.method(generatedReportRepository, 'create');
    t.after(() => { listMock.mock.restore(); uploadMock.mock.restore(); createMock.mock.restore(); });

    await assert.rejects(
      () => reportService.generateStudentExportReport({}, {}, {}),
      reportService.ReportValidationError,
    );
    assert.equal(listMock.mock.callCount(), 0);
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('happy path: fetches students, generates CSV, uploads with no studentId, writes a completed ledger row', async () => {
    const students = [{ roll_no: 'R1', full_name: 'Alice' }];
    const listMock = t.mock.method(studentService, 'listStudents', async () => students);
    const uploadMock = t.mock.method(documentService, 'uploadDocument', async () => ({ id: 'doc-1' }));
    const createMock = t.mock.method(generatedReportRepository, 'create', async (client, fields) => ({ id: 'report-1', ...fields }));
    t.after(() => { listMock.mock.restore(); uploadMock.mock.restore(); createMock.mock.restore(); });

    const report = await reportService.generateStudentExportReport({}, { collegeId: 'c1' }, { actorUserId: 'u1' });

    assert.equal(uploadMock.mock.callCount(), 1);
    const [, uploadFields] = uploadMock.mock.calls[0].arguments;
    assert.equal(uploadFields.studentId, undefined, 'studentId must never be forwarded — this file belongs to no single student');
    assert.equal(uploadFields.docType, 'generated_report');
    assert.equal(uploadFields.mimeType, 'text/csv');
    assert.ok(Buffer.isBuffer(uploadFields.fileBuffer));

    assert.equal(report.status, 'completed');
    assert.equal(report.documentId, 'doc-1');
    assert.equal(report.reportType, 'student_export');
    assert.equal(report.format, 'csv');
    // RS-CLS-005 / Stage 8d: parameters must record real export facts
    // (requestedByUserId/createdAt already cover who/when per ADR-018 —
    // generated_reports IS the audit record, no separate audit_log entry).
    assert.equal(report.parameters.studentCount, 1);
    assert.ok(report.parameters.columnCount > 0);
  });

  await t.test('failure path: resolves with a failed ledger row, does not reject', async () => {
    const listMock = t.mock.method(studentService, 'listStudents', async () => { throw new Error('boom'); });
    const createMock = t.mock.method(generatedReportRepository, 'create', async (client, fields) => ({ id: 'report-2', ...fields }));
    t.after(() => { listMock.mock.restore(); createMock.mock.restore(); });

    const report = await reportService.generateStudentExportReport({}, { collegeId: 'c1' }, { actorUserId: 'u1' });

    assert.equal(report.status, 'failed');
    assert.equal(report.errorMessage, 'boom');
    assert.equal(report.documentId, undefined, 'no documentId is passed when generation never reached upload');
  });

  await t.test('failure path: a documentService.uploadDocument failure also resolves with a failed row', async () => {
    const listMock = t.mock.method(studentService, 'listStudents', async () => []);
    const uploadMock = t.mock.method(documentService, 'uploadDocument', async () => { throw new Error('disk full'); });
    const createMock = t.mock.method(generatedReportRepository, 'create', async (client, fields) => ({ id: 'report-3', ...fields }));
    t.after(() => { listMock.mock.restore(); uploadMock.mock.restore(); createMock.mock.restore(); });

    const report = await reportService.generateStudentExportReport({}, { collegeId: 'c1' }, { actorUserId: 'u1' });
    assert.equal(report.status, 'failed');
    assert.equal(report.errorMessage, 'disk full');
  });

  await t.test('rejects an unsupported format before touching any service (pptx stays parked)', async () => {
    const listMock = t.mock.method(studentService, 'listStudents');
    const createMock = t.mock.method(generatedReportRepository, 'create');
    t.after(() => { listMock.mock.restore(); createMock.mock.restore(); });

    await assert.rejects(
      () => reportService.generateStudentExportReport({}, { collegeId: 'c1', format: 'pptx' }, { actorUserId: 'u1' }),
      reportService.ReportFormatError,
    );
    assert.equal(listMock.mock.callCount(), 0);
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('format: "pdf" uses the real pdfGenerator and uploads application/pdf bytes', async () => {
    const students = [{ roll_no: 'R1', full_name: 'Alice' }];
    const listMock = t.mock.method(studentService, 'listStudents', async () => students);
    const uploadMock = t.mock.method(documentService, 'uploadDocument', async () => ({ id: 'doc-pdf' }));
    const createMock = t.mock.method(generatedReportRepository, 'create', async (client, fields) => ({ id: 'report-pdf', ...fields }));
    t.after(() => { listMock.mock.restore(); uploadMock.mock.restore(); createMock.mock.restore(); });

    const report = await reportService.generateStudentExportReport({}, { collegeId: 'c1', format: 'pdf' }, { actorUserId: 'u1' });

    const [, uploadFields] = uploadMock.mock.calls[0].arguments;
    assert.equal(uploadFields.mimeType, 'application/pdf');
    assert.match(uploadFields.fileName, /\.pdf$/);
    assert.equal(uploadFields.fileBuffer.subarray(0, 5).toString('latin1'), '%PDF-');

    assert.equal(report.status, 'completed');
    assert.equal(report.format, 'pdf');
  });

  await t.test('format: "xlsx" uses the real excelGenerator and uploads the correct spreadsheet mimeType', async () => {
    const students = [{ roll_no: 'R1', full_name: 'Alice' }];
    const listMock = t.mock.method(studentService, 'listStudents', async () => students);
    const uploadMock = t.mock.method(documentService, 'uploadDocument', async () => ({ id: 'doc-xlsx' }));
    const createMock = t.mock.method(generatedReportRepository, 'create', async (client, fields) => ({ id: 'report-xlsx', ...fields }));
    t.after(() => { listMock.mock.restore(); uploadMock.mock.restore(); createMock.mock.restore(); });

    const report = await reportService.generateStudentExportReport({}, { collegeId: 'c1', format: 'xlsx' }, { actorUserId: 'u1' });

    const [, uploadFields] = uploadMock.mock.calls[0].arguments;
    assert.equal(uploadFields.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(uploadFields.fileName, /\.xlsx$/);
    assert.equal(uploadFields.fileBuffer.subarray(0, 2).toString('latin1'), 'PK');

    assert.equal(report.status, 'completed');
    assert.equal(report.format, 'xlsx');
  });

  await t.test('format: "docx" uses the real wordGenerator and uploads the correct Word mimeType', async () => {
    const students = [{ roll_no: 'R1', full_name: 'Alice' }];
    const listMock = t.mock.method(studentService, 'listStudents', async () => students);
    const uploadMock = t.mock.method(documentService, 'uploadDocument', async () => ({ id: 'doc-docx' }));
    const createMock = t.mock.method(generatedReportRepository, 'create', async (client, fields) => ({ id: 'report-docx', ...fields }));
    t.after(() => { listMock.mock.restore(); uploadMock.mock.restore(); createMock.mock.restore(); });

    const report = await reportService.generateStudentExportReport({}, { collegeId: 'c1', format: 'docx' }, { actorUserId: 'u1' });

    const [, uploadFields] = uploadMock.mock.calls[0].arguments;
    assert.equal(uploadFields.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.match(uploadFields.fileName, /\.docx$/);
    assert.equal(uploadFields.fileBuffer.subarray(0, 2).toString('latin1'), 'PK');

    assert.equal(report.status, 'completed');
    assert.equal(report.format, 'docx');
  });

  await t.test('columns: narrows and reorders the CSV header to the requested subset, dropping unknown ids', async () => {
    const students = [{ id: 's1', roll_no: 'R1', full_name: 'Alice', department: 'CSE' }];
    t.mock.method(studentService, 'listStudents', async () => students);
    const uploadMock = t.mock.method(documentService, 'uploadDocument', async () => ({ id: 'doc-cols' }));
    t.mock.method(generatedReportRepository, 'create', async (client, fields) => ({ id: 'report-cols', ...fields }));
    t.after(() => { t.mock.restoreAll(); });

    await reportService.generateStudentExportReport(
      {},
      { collegeId: 'c1', format: 'csv', columns: ['full_name', 'bogus_id', 'roll_no'] },
      { actorUserId: 'u1' },
    );

    const [, uploadFields] = uploadMock.mock.calls[0].arguments;
    const text = uploadFields.fileBuffer.toString('utf8');
    assert.equal(text.slice(1).split('\n')[0], '"Full Name","Roll Number"');
  });

  await t.test('studentIds: scopes and reorders rows to the requested ids, dropping ids not in the college roster', async () => {
    const students = [
      { id: 's1', roll_no: 'R1', full_name: 'Alice' },
      { id: 's2', roll_no: 'R2', full_name: 'Bob' },
      { id: 's3', roll_no: 'R3', full_name: 'Carol' },
    ];
    t.mock.method(studentService, 'listStudents', async () => students);
    const uploadMock = t.mock.method(documentService, 'uploadDocument', async () => ({ id: 'doc-ids' }));
    t.mock.method(generatedReportRepository, 'create', async (client, fields) => ({ id: 'report-ids', ...fields }));
    t.after(() => { t.mock.restoreAll(); });

    await reportService.generateStudentExportReport(
      {},
      {
        collegeId: 'c1', format: 'csv', columns: ['full_name'], studentIds: ['s3', 'missing', 's1'],
      },
      { actorUserId: 'u1' },
    );

    const [, uploadFields] = uploadMock.mock.calls[0].arguments;
    const text = uploadFields.fileBuffer.toString('utf8');
    const rows = text.slice(1).split('\n').filter(Boolean);
    assert.deepEqual(rows, ['"Full Name"', '"Carol"', '"Alice"']);
  });
});
