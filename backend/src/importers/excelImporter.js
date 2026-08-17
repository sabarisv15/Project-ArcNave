'use strict';

// Importer Module — the .xlsx counterpart to csvImporter.js, same pure
// "bytes in, {headers, rows} out" contract, no database/storage/
// business-rule access. exceljs — the same library excelGenerator.js
// already uses for the export direction (TechStack.md's chosen
// "openpyxl equivalent"), not a second dependency for the same format.
//
// Only the first worksheet is read — BusinessRules.md's own "CSV and
// Excel may be supported" names no multi-sheet import concept, and
// every export this codebase produces (excelGenerator.js) is
// single-sheet too, so there is nothing a caller could have exported
// that this wouldn't read back.

const ExcelJS = require('exceljs');

async function parse(fileBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) {
    return { headers: [], rows: [] };
  }

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value || '').trim().toLowerCase();
  });

  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (row.cellCount === 0) continue; // eslint-disable-line no-continue
    const record = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const cell = row.getCell(index + 1);
      record[header] = cell.value === null || cell.value === undefined ? undefined : String(cell.value);
    });
    rows.push(record);
  }

  return { headers, rows };
}

module.exports = { parse };
