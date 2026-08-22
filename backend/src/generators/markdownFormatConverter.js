'use strict';

// Generator-orchestration module (ADR-008 pattern) — no DB/storage
// access, same purity rule every module in this directory follows. This
// is the SINGLE place that knows the full export-format vocabulary and
// each format's mime type/file extension, so callers (ArtifactService,
// aiToolRegistry's generate_document handler) never hardcode that
// mapping themselves.
//
// csv/xlsx reuse the EXISTING csvGenerator.js/excelGenerator.js
// unmodified — markdownTableParser.findFirstTable produces exactly the
// ReportModel shape ({title, columns, rows}) those two already consume.
// docx/pdf use the new markdown-aware generators above instead of
// wordGenerator.js/pdfGenerator.js, because those two are tabular-only
// (Module 7's ReportModel contract) — free prose has no table to put
// there without inventing a fake single-column one.
//
// csv/xlsx with no table in the content is a resolved product decision
// (ai-artifact-export-formats-approved-spec.md), not a bug: throws
// MarkdownConversionError rather than emitting an empty/meaningless file
// — the caller surfaces this as an honest chat reply, same
// honest-degradation precedent buildImageUnavailableNote/extraction
// failures already establish elsewhere in this codebase.

const csvGenerator = require('./csvGenerator');
const excelGenerator = require('./excelGenerator');
const markdownDocxGenerator = require('./markdownDocxGenerator');
const markdownPdfGenerator = require('./markdownPdfGenerator');
const markdownPptxGenerator = require('./markdownPptxGenerator');
const { findFirstTable } = require('./markdownTableParser');

class MarkdownConversionError extends Error {}

const FORMATS = {
  markdown: { extension: 'md', mimeType: 'text/markdown' },
  txt: { extension: 'txt', mimeType: 'text/plain' },
  docx: { extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pdf: { extension: 'pdf', mimeType: 'application/pdf' },
  csv: { extension: 'csv', mimeType: 'text/csv' },
  xlsx: { extension: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pptx: { extension: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
};

function isSupportedFormat(format) {
  return Object.prototype.hasOwnProperty.call(FORMATS, format);
}

async function convert({ title, markdown }, format) {
  if (!isSupportedFormat(format)) {
    throw new MarkdownConversionError(`unsupported export format ${JSON.stringify(format)}`);
  }
  const { extension, mimeType } = FORMATS[format];

  if (format === 'markdown' || format === 'txt') {
    return { buffer: Buffer.from(markdown, 'utf8'), mimeType, extension };
  }

  if (format === 'docx') {
    return { buffer: await markdownDocxGenerator.generate({ title, markdown }), mimeType, extension };
  }

  if (format === 'pdf') {
    return { buffer: await markdownPdfGenerator.generate({ title, markdown }), mimeType, extension };
  }

  if (format === 'pptx') {
    return { buffer: await markdownPptxGenerator.generate({ title, markdown }), mimeType, extension };
  }

  // csv / xlsx — both need an actual table extracted from the prose.
  const table = findFirstTable(markdown);
  if (!table || table.rows.length === 0) {
    throw new MarkdownConversionError(
      `this content has no table to export as ${format.toUpperCase()} — try docx, pdf, or txt instead`,
    );
  }
  const reportModel = { title, columns: table.columns, rows: table.rows };
  const generator = format === 'csv' ? csvGenerator : excelGenerator;
  return { buffer: await generator.generate(reportModel), mimeType, extension };
}

module.exports = {
  convert, isSupportedFormat, MarkdownConversionError, FORMATS,
};
