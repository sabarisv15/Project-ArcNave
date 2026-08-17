'use strict';

// BusinessRules.md Central audit log and Import/Export: "import and
// export capabilities are provided as a common platform service. Each
// module decides whether import/export is supported and which fields
// are allowed. CSV and Excel may be supported; imports require
// validation before commit." This is that common service — the
// mechanism only, never a specific module's shape (same restraint
// configurationService.js's own file-level comment already documents
// for the generic JSONB config store: "this service never validates a
// category's internal JSON shape").
//
// Deliberately thin: parseImportFile is a dispatcher over the two
// Importer Modules (csvImporter.js/excelImporter.js, both pure
// functions), and validateRows is a generic required/allowed-fields
// filter — no module-specific business rule (a valid day_of_week, a
// real class_id) lives here. Each caller (a Business Service) commits
// its own validated rows through its own repository, in its own
// per-row transaction/savepoint shape — the same division
// academicService.importTimetablePeriodsCsv (retrofitted onto this
// service as this slice's own proof, matching the "retrofit one real
// call site" precedent tasks #15/#16 already set) already establishes
// between parsing and committing.

const csvImporter = require('../importers/csvImporter');
const excelImporter = require('../importers/excelImporter');

const EXCEL_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

class ImportValidationError extends Error {}
class ImportUnsupportedFormatError extends Error {}

// mimeType selects the parser — csvImporter for 'text/csv' (and
// anything text/csv-ish), excelImporter for the two common .xlsx/.xls
// content types browsers/Excel itself actually send. Anything else is
// a real, named gap (BusinessRules.md names only CSV and Excel), not
// silently guessed at.
async function parseImportFile(fileBuffer, mimeType) {
  if (!fileBuffer) {
    throw new ImportValidationError('fileBuffer is required');
  }
  if (mimeType === 'text/csv' || mimeType === 'application/csv') {
    return csvImporter.parse(fileBuffer);
  }
  if (EXCEL_MIME_TYPES.includes(mimeType)) {
    return excelImporter.parse(fileBuffer);
  }
  throw new ImportUnsupportedFormatError(`mimeType ${JSON.stringify(mimeType)} is not supported — only CSV and Excel are`);
}

// requiredFields: every row missing any of these becomes an error, not
// a silently-skipped row — the caller sees exactly which row/field
// failed. allowedFields (if given): any column not in this list is
// dropped from the row before it's returned, never passed through to
// a repository's own INSERT — "each module decides ... which fields
// are allowed" (BusinessRules.md) enforced here, not trusted to the
// raw CSV/Excel columns a caller might not expect.
function validateRows(rows, { requiredFields = [], allowedFields } = {}) {
  const validRows = [];
  const errors = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const missing = requiredFields.filter((field) => row[field] === undefined || row[field] === '');
    if (missing.length > 0) {
      errors.push({ rowNumber, reason: `missing required field(s): ${missing.join(', ')}` });
      return;
    }

    const fields = allowedFields === undefined
      ? { ...row }
      : Object.fromEntries(Object.entries(row).filter(([key]) => allowedFields.includes(key)));

    validRows.push({ rowNumber, fields });
  });

  return { validRows, errors };
}

module.exports = {
  ImportValidationError,
  ImportUnsupportedFormatError,
  parseImportFile,
  validateRows,
};
