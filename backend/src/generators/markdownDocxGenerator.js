'use strict';

// Generator Module (ADR-008): a pure function, no DB/storage access.
// Distinct from wordGenerator.js — that one always renders exactly one
// ReportModel table ({title, columns, rows}), for Module 7's structured
// tabular reports. This renders free-text AI-authored markdown (headings,
// paragraphs, and any embedded pipe-tables) as a normal reading document —
// the shape AI chat/artifact reports actually are, not tabular data.
// Deliberately minimal markdown support (headings H1-H6, **bold**/*italic*
// inline runs, horizontal rules, single-level bullet lists, paragraphs,
// and tables — still no nested/numbered lists or links): AI-authored
// report content in this codebase is plain prose with occasional tables,
// not arbitrary CommonMark, and this is a v1 export, not a markdown
// renderer. A live-caught document (an AI-generated resume with ####
// sub-headings, **bold** labels, and "* " bullets) showed those markers
// being printed as literal characters instead of silently degrading —
// bold/italic/H4-H6/horizontal-rule/bullet handling exists specifically
// to close that gap, via markdownInline.js (shared with
// markdownPdfGenerator.js so the two can't drift apart again).
//
// Visual design (this round): a live side-by-side against a same-prompt
// Gemini-generated PDF showed this generator's first pass (plain
// black-on-white headings/paragraphs/grid table) reading as noticeably
// less finished — colored section banners, a styled table header, real
// page structure. This pass applies documentTheme.js's palette (lifted
// from frontend/src/index.css, not invented here or copied from Gemini's
// blue) so a generated report reads as an ARCNAVE document, not a bare
// text dump.

const {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  WidthType,
  ShadingType,
  BorderStyle,
  AlignmentType,
  Footer,
  PageNumber,
  Header,
} = require('docx');
const { parseTableAt } = require('./markdownTableParser');
const { HEX } = require('./documentTheme');
const {
  stripStrayHtml,
  isHorizontalRule,
  matchHeading,
  matchBullet,
  parseInlineSegments,
  stripInlineMarkers,
} = require('./markdownInline');

const HEADING_SIZE = { 1: 32, 2: 26, 3: 22 }; // half-points (docx `size` unit)

function textCell(text, { bold, color, fill } = {}) {
  return new TableCell({
    shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: text === null || text === undefined ? '' : String(text), bold, color })],
      }),
    ],
  });
}

function tableElement(columns, rows) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map((c) => textCell(c.label, { bold: true, color: 'FFFFFF', fill: HEX.accent })),
  });
  const dataRows = rows.map(
    (row, i) =>
      new TableRow({
        children: columns.map((c) => textCell(row[c.id], { fill: i % 2 === 1 ? HEX.accentSoft : undefined })),
      }),
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] });
}

function headingParagraph(text, level) {
  const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1];
  // A left accent bar (a thick colored left border) on H2/H3 stands in for
  // Gemini's own colored section-bar treatment — docx has no "colored
  // block behind text" primitive as simple as pdfkit's rect+fill, but a
  // heavy left border reads the same way in Word.
  const border =
    level > 1
      ? {
          left: {
            color: HEX.accent,
            space: 8,
            style: BorderStyle.SINGLE,
            size: 24,
          },
        }
      : undefined;
  return new Paragraph({
    heading,
    spacing: { before: level === 1 ? 0 : 280, after: 140 },
    border,
    indent: level > 1 ? { left: 160 } : undefined,
    children: [
      new TextRun({
        text: stripInlineMarkers(text),
        bold: true,
        color: HEX.ink,
        size: HEADING_SIZE[level],
      }),
    ],
  });
}

// **bold**/*italic* runs within one paragraph line — docx supports
// per-run styling natively (unlike pdfkit), so this is just a map from
// markdownInline.js's segments straight to TextRun.
function inlineRuns(text, baseProps) {
  return parseInlineSegments(text).map(
    (seg) =>
      new TextRun({ text: seg.text, bold: seg.bold || undefined, italics: seg.italic || undefined, ...baseProps }),
  );
}

async function generate({ title, markdown }) {
  const lines = String(markdown || '').split(/\r?\n/);
  // Title banner — a full-width shaded paragraph, not just bold text, so
  // the document opens with the same "colored header band" first
  // impression the reference PDF has.
  const children = [
    new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: HEX.accent },
      spacing: { before: 0, after: 320 },
      children: [
        new TextRun({
          text: title,
          bold: true,
          color: 'FFFFFF',
          size: 40,
        }),
      ],
    }),
  ];

  let i = 0;
  while (i < lines.length) {
    const table = parseTableAt(lines, i);
    if (table) {
      children.push(tableElement(table.columns, table.rows));
      children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
      i = table.endIndex;
      continue; // eslint-disable-line no-continue
    }

    const line = lines[i];
    const heading = matchHeading(line);
    if (heading) {
      children.push(headingParagraph(heading.text, heading.level));
    } else if (isHorizontalRule(line)) {
      children.push(
        new Paragraph({
          spacing: { before: 100, after: 160 },
          border: { bottom: { color: HEX.line, space: 1, style: BorderStyle.SINGLE, size: 6 } },
          children: [],
        }),
      );
    } else {
      const bullet = matchBullet(line);
      const cleaned = stripStrayHtml(bullet ? bullet.text : line);
      if (cleaned.trim()) {
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            bullet: bullet ? { level: 0 } : undefined,
            children: inlineRuns(cleaned, { color: HEX.inkSoft }),
          }),
        );
      }
    }
    i += 1;
  }

  const doc = new Document({
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: title, size: 16, color: HEX.inkMuted })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 16,
                    color: HEX.inkMuted,
                  }),
                  new TextRun({ text: ' of ', size: 16, color: HEX.inkMuted }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: HEX.inkMuted,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

module.exports = { generate };
