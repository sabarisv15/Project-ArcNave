'use strict';

// Unit tests for fileIntelligenceRouter.js — real minimal buffers built
// by hand (magic bytes only, never live HTTP/DB), same "real content,
// no mocks" discipline document-text-extraction.test.js already
// established for the office/PDF formats this module also classifies.

const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph } = require('docx');
const ExcelJS = require('exceljs');
const PizZip = require('pizzip');
const {
  ATTACHMENT_CATEGORIES,
  PROCESSING_MODES,
  classifyAttachment,
  sniffChatAttachmentMimeType,
} = require('../src/services/fileIntelligenceRouter');

function buildPdfBuffer() {
  return new Promise((resolve) => {
    const chunks = [];
    const doc = new PDFDocument();
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.text('hello');
    doc.end();
  });
}

async function buildDocxBuffer() {
  const doc = new Document({ sections: [{ children: [new Paragraph('hello')] }] });
  return Packer.toBuffer(doc);
}

async function buildXlsxBuffer() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  worksheet.addRow(['a', 'b']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function buildPptxBuffer() {
  const zip = new PizZip();
  zip.file('ppt/presentation.xml', '<presentation/>');
  zip.file('ppt/slides/slide1.xml', '<sld/>');
  return zip.generate({ type: 'nodebuffer' });
}

function buildOdtBuffer() {
  const zip = new PizZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text');
  zip.file('content.xml', '<office:document-content/>');
  return zip.generate({ type: 'nodebuffer' });
}

function buildApkBuffer() {
  const zip = new PizZip();
  zip.file('AndroidManifest.xml', '<manifest/>');
  return zip.generate({ type: 'nodebuffer' });
}

function buildBareZipBuffer() {
  const zip = new PizZip();
  zip.file('readme.txt', 'just a plain zip, not office/odf/apk');
  return zip.generate({ type: 'nodebuffer' });
}

function buildIsoBmff(brand, padTo = 32) {
  const buf = Buffer.alloc(Math.max(padTo, 12));
  buf.write('ftyp', 4, 'ascii');
  buf.write(brand, 8, 'ascii');
  return buf;
}

function buildRiff(form) {
  const buf = Buffer.alloc(16);
  buf.write('RIFF', 0, 'ascii');
  buf.write(form, 8, 'ascii');
  return buf;
}

test('images: PNG/JPEG/GIF/WEBP classify NATIVE_MULTIMODAL_IMAGE', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0]);
  assert.equal(classifyAttachment(png).category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_IMAGE);
  assert.equal(classifyAttachment(jpeg).category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_IMAGE);
  assert.equal(classifyAttachment(png).processingMode, PROCESSING_MODES.NATIVE_MULTIMODAL);
});

test('HEIC (ISO-BMFF, heic brand) classifies as NATIVE_MULTIMODAL_IMAGE, not audio/video', () => {
  const heic = buildIsoBmff('heic');
  const result = classifyAttachment(heic);
  assert.equal(result.category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_IMAGE);
  assert.equal(result.detectedMimeType, 'image/heic');
});

test('M4A (ISO-BMFF, M4A brand) classifies as NATIVE_MULTIMODAL_AUDIO, not video/image', () => {
  const m4a = buildIsoBmff('M4A ');
  const result = classifyAttachment(m4a);
  assert.equal(result.category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_AUDIO);
  assert.equal(result.detectedMimeType, 'audio/mp4');
});

test('MP4 (ISO-BMFF, isom brand) classifies as NATIVE_MULTIMODAL_VIDEO', () => {
  const mp4 = buildIsoBmff('isom');
  const result = classifyAttachment(mp4);
  assert.equal(result.category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_VIDEO);
  assert.equal(result.detectedMimeType, 'video/mp4');
});

test('QuickTime MOV (ISO-BMFF, "qt  " brand) classifies as video/quicktime', () => {
  const mov = buildIsoBmff('qt  ');
  const result = classifyAttachment(mov);
  assert.equal(result.category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_VIDEO);
  assert.equal(result.detectedMimeType, 'video/quicktime');
});

test('WAV (RIFF/WAVE) classifies as NATIVE_MULTIMODAL_AUDIO', () => {
  const result = classifyAttachment(buildRiff('WAVE'));
  assert.equal(result.category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_AUDIO);
  assert.equal(result.detectedMimeType, 'audio/wav');
});

test('AVI (RIFF/AVI ) classifies as NATIVE_MULTIMODAL_VIDEO', () => {
  const result = classifyAttachment(buildRiff('AVI '));
  assert.equal(result.category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_VIDEO);
});

test('WEBP (RIFF/WEBP) still classifies as NATIVE_MULTIMODAL_IMAGE (unchanged)', () => {
  const result = classifyAttachment(buildRiff('WEBP'));
  assert.equal(result.category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_IMAGE);
  assert.equal(result.detectedMimeType, 'image/webp');
});

test('MP3 via ID3 tag and via raw frame sync both classify as NATIVE_MULTIMODAL_AUDIO', () => {
  const withId3 = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'binary');
  const rawFrame = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  assert.equal(classifyAttachment(withId3).category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_AUDIO);
  assert.equal(classifyAttachment(rawFrame).category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_AUDIO);
});

test('FLAC and OGG classify as NATIVE_MULTIMODAL_AUDIO', () => {
  const flac = Buffer.from('fLaC\x00\x00\x00\x00', 'binary');
  const ogg = Buffer.from('OggS\x00\x00\x00\x00', 'binary');
  assert.equal(classifyAttachment(flac).detectedMimeType, 'audio/flac');
  assert.equal(classifyAttachment(ogg).detectedMimeType, 'audio/ogg');
});

test('WebM (EBML header) classifies as NATIVE_MULTIMODAL_VIDEO', () => {
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
  assert.equal(classifyAttachment(webm).category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_VIDEO);
});

test('PDF classifies NATIVE_MULTIMODAL_DOCUMENT', async () => {
  const buffer = await buildPdfBuffer();
  const result = classifyAttachment(buffer);
  assert.equal(result.category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_DOCUMENT);
  assert.equal(result.detectedMimeType, 'application/pdf');
});

test('DOCX/PPTX/ODT classify OFFICE_DOCUMENT (unchanged from today)', async () => {
  const docx = await buildDocxBuffer();
  assert.equal(classifyAttachment(docx).category, ATTACHMENT_CATEGORIES.OFFICE_DOCUMENT);
  assert.equal(classifyAttachment(buildPptxBuffer()).category, ATTACHMENT_CATEGORIES.OFFICE_DOCUMENT);
  assert.equal(classifyAttachment(buildOdtBuffer()).category, ATTACHMENT_CATEGORIES.OFFICE_DOCUMENT);
});

test('XLSX classifies STRUCTURED_DATA (new — was OFFICE_DOCUMENT-shaped text extraction before this router)', async () => {
  const xlsx = await buildXlsxBuffer();
  const result = classifyAttachment(xlsx);
  assert.equal(result.category, ATTACHMENT_CATEGORIES.STRUCTURED_DATA);
  assert.equal(result.processingMode, PROCESSING_MODES.STRUCTURED_ANALYSIS);
});

test('an APK (ZIP containing AndroidManifest.xml) is SPECIALIZED_BINARY and BLOCKED, never treated as a generic archive', () => {
  const result = classifyAttachment(buildApkBuffer());
  assert.equal(result.category, ATTACHMENT_CATEGORIES.SPECIALIZED_BINARY);
  assert.equal(result.processingMode, PROCESSING_MODES.BLOCKED);
  assert.ok(result.blockReason);
});

test('a plain ZIP with no recognized internal structure classifies ARCHIVE_OR_CONTAINER', () => {
  const result = classifyAttachment(buildBareZipBuffer());
  assert.equal(result.category, ATTACHMENT_CATEGORIES.ARCHIVE_OR_CONTAINER);
  assert.equal(result.processingMode, PROCESSING_MODES.UNPACK_AND_ROUTE);
});

test('gzip and tar magic classify ARCHIVE_OR_CONTAINER', () => {
  const gzip = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
  assert.equal(classifyAttachment(gzip).category, ATTACHMENT_CATEGORIES.ARCHIVE_OR_CONTAINER);

  const tar = Buffer.alloc(263);
  tar.write('ustar', 257, 'ascii');
  assert.equal(classifyAttachment(tar).category, ATTACHMENT_CATEGORIES.ARCHIVE_OR_CONTAINER);
});

test('MIME spoofing: a .pdf-named file containing a Windows EXE (MZ header) is BLOCKED, never NATIVE_MULTIMODAL_DOCUMENT', () => {
  const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
  const result = classifyAttachment(exe, { fileName: 'totally-a-report.pdf', declaredMimeType: 'application/pdf' });
  assert.equal(result.category, ATTACHMENT_CATEGORIES.SPECIALIZED_BINARY);
  assert.equal(result.processingMode, PROCESSING_MODES.BLOCKED);
  assert.notEqual(result.category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_DOCUMENT);
});

test('MIME spoofing: an ELF binary is BLOCKED regardless of declared type/extension', () => {
  const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
  const result = classifyAttachment(elf, { fileName: 'notes.txt', declaredMimeType: 'text/plain' });
  assert.equal(result.processingMode, PROCESSING_MODES.BLOCKED);
});

test('sniffChatAttachmentMimeType (backward-compat wrapper) rejects blocked SPECIALIZED_BINARY, does not leak its detected mime type', () => {
  const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
  assert.equal(sniffChatAttachmentMimeType(exe, 'file.pdf'), null);
});

test('plain text: source-code extensions (e.g. .py) classify TEXT_OR_CODE via the plain-text content gate', () => {
  const source = Buffer.from('def hello():\n    return 1\n', 'utf8');
  const result = classifyAttachment(source, { fileName: 'script.py' });
  assert.equal(result.category, ATTACHMENT_CATEGORIES.TEXT_OR_CODE);
  assert.equal(result.processingMode, PROCESSING_MODES.TEXT_CONTEXT);
});

test('plain text: binary content named with a text extension is still rejected (content gate, not extension)', () => {
  const binary = Buffer.from([0, 1, 2, 3, 4, 5, 0, 0]);
  const result = classifyAttachment(binary, { fileName: 'script.py' });
  assert.equal(result.processingMode, PROCESSING_MODES.BLOCKED);
});

test('genuinely unrecognized content (no magic bytes, fails plain-text shape check) is UNSUPPORTED_OR_RESTRICTED/BLOCKED', () => {
  const random = Buffer.from([0x13, 0x37, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02, 0x03]);
  const result = classifyAttachment(random, { fileName: 'mystery.bin' });
  assert.equal(result.category, ATTACHMENT_CATEGORIES.UNSUPPORTED_OR_RESTRICTED);
  assert.equal(result.processingMode, PROCESSING_MODES.BLOCKED);
  assert.equal(result.blockReason, 'unrecognized_content');
});

test('declared-vs-detected mime mismatch is recorded but never overrides the sniffed category', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  const result = classifyAttachment(png, { declaredMimeType: 'application/pdf' });
  assert.equal(result.category, ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_IMAGE);
  assert.equal(result.declaredMimeTypeMismatch, true);
});
