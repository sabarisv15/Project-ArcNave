'use strict';
const fs = require('fs');
const { Readable } = require('stream');
const ExcelJS = require('exceljs');
const te = require('../src/services/documentTextExtractionService');
const F = 'C:/Users/HAI/Downloads/MyReport_Taxable_inward_supplies_received_from_registered_persons.csv';
(async () => {
  const buf = fs.readFileSync(F);
  const out = await te.extractPlainText(buf, 'text/csv');
  console.log('method reported by ARCNAVE:', out.method);
  try {
    const wb = new ExcelJS.Workbook();
    const ws = await wb.csv.read(Readable.from([buf.toString('utf8')]));
    console.log('exceljs parsed?', !!ws, 'rowCount:', ws && ws.rowCount);
  } catch (err) {
    console.log('exceljs THREW:', err.message);
  }
})();
