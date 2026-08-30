'use strict';

const PizZip = require('pizzip');

// The File Intelligence Router (ai-chat-file-intelligence-router-approved-spec.md)
// — a single classification decision for every chat attachment, made
// once, from sniffed content bytes, against a closed category
// vocabulary. Replaces the ad hoc image/document branching that used to
// live directly in aiService.resolveChatAttachments and the standalone
// sniff functions that used to live directly in routes/documents.js —
// both now call classifyAttachment() here instead of re-implementing
// their own mime checks, so there is exactly one place that decides what
// kind of file a byte buffer is.
//
// Every sniff function in this file follows the same discipline the
// original routes/documents.js sniffing established: MIME is decided
// from real content bytes (magic numbers, container structure), NEVER
// from a client-declared mime_type and never from the file extension
// alone — extension is only ever a tie-breaking HINT for formats with no
// magic bytes at all (plain text), exactly as the original
// sniffPlainTextMimeType already did.

const ATTACHMENT_CATEGORIES = Object.freeze({
  NATIVE_MULTIMODAL_DOCUMENT: 'native_multimodal_document',
  NATIVE_MULTIMODAL_IMAGE: 'native_multimodal_image',
  NATIVE_MULTIMODAL_AUDIO: 'native_multimodal_audio',
  NATIVE_MULTIMODAL_VIDEO: 'native_multimodal_video',
  TEXT_OR_CODE: 'text_or_code',
  STRUCTURED_DATA: 'structured_data',
  OFFICE_DOCUMENT: 'office_document',
  ARCHIVE_OR_CONTAINER: 'archive_or_container',
  SPECIALIZED_BINARY: 'specialized_binary',
  UNSUPPORTED_OR_RESTRICTED: 'unsupported_or_restricted',
});

const PROCESSING_MODES = Object.freeze({
  NATIVE_MULTIMODAL: 'native_multimodal',
  TEXT_CONTEXT: 'text_context',
  STRUCTURED_ANALYSIS: 'structured_analysis',
  EXTRACT_AND_RENDER: 'extract_and_render',
  UNPACK_AND_ROUTE: 'unpack_and_route',
  METADATA_ONLY: 'metadata_only',
  BLOCKED: 'blocked',
});

const PROCESSING_STATUSES = Object.freeze({
  UPLOADED: 'uploaded',
  VALIDATING: 'validating',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  READY: 'ready',
  NEEDS_REVIEW: 'needs_review',
  FAILED: 'failed',
  BLOCKED: 'blocked',
});

const CATEGORY_TO_MODE = Object.freeze({
  [ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_DOCUMENT]: PROCESSING_MODES.NATIVE_MULTIMODAL,
  [ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_IMAGE]: PROCESSING_MODES.NATIVE_MULTIMODAL,
  [ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_AUDIO]: PROCESSING_MODES.NATIVE_MULTIMODAL,
  [ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_VIDEO]: PROCESSING_MODES.NATIVE_MULTIMODAL,
  [ATTACHMENT_CATEGORIES.TEXT_OR_CODE]: PROCESSING_MODES.TEXT_CONTEXT,
  [ATTACHMENT_CATEGORIES.STRUCTURED_DATA]: PROCESSING_MODES.STRUCTURED_ANALYSIS,
  [ATTACHMENT_CATEGORIES.OFFICE_DOCUMENT]: PROCESSING_MODES.TEXT_CONTEXT,
  [ATTACHMENT_CATEGORIES.ARCHIVE_OR_CONTAINER]: PROCESSING_MODES.UNPACK_AND_ROUTE,
  [ATTACHMENT_CATEGORIES.SPECIALIZED_BINARY]: PROCESSING_MODES.METADATA_ONLY,
  [ATTACHMENT_CATEGORIES.UNSUPPORTED_OR_RESTRICTED]: PROCESSING_MODES.BLOCKED,
});

// ---------------------------------------------------------------------
// Images (unchanged from the original routes/documents.js sniffing) +
// HEIC/HEIF, new here.
// ---------------------------------------------------------------------

function sniffLegacyImageMimeType(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 6) {
    const header = buffer.toString('ascii', 0, 6);
    if (header === 'GIF87a' || header === 'GIF89a') {
      return 'image/gif';
    }
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

// ---------------------------------------------------------------------
// ISO-BMFF ("ftyp" box) container — the SAME container shape is used by
// MP4 video, M4A audio, and HEIC/HEIF images, disambiguated only by the
// 4-byte "major brand" that follows the ftyp box. This one function is
// the single place that tells those three categories apart; classifyAttachment
// below must never guess an ISO-BMFF file's category any other way.
// ---------------------------------------------------------------------

const ISO_BMFF_IMAGE_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1', 'avif', 'avis']);
const ISO_BMFF_AUDIO_BRANDS = new Set(['M4A ', 'M4B ']);
const ISO_BMFF_VIDEO_BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VH', 'M4VP', 'qt  ', '3gp4', '3gp5', 'mmp4', 'MSNV']);

function readIsoBmffMajorBrand(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') return null;
  return buffer.toString('ascii', 8, 12);
}

function sniffIsoBmffMimeType(buffer) {
  const brand = readIsoBmffMajorBrand(buffer);
  if (!brand) return null;
  if (ISO_BMFF_IMAGE_BRANDS.has(brand)) {
    return { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_IMAGE, mimeType: 'image/heic' };
  }
  if (ISO_BMFF_AUDIO_BRANDS.has(brand)) {
    return { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_AUDIO, mimeType: 'audio/mp4' };
  }
  if (ISO_BMFF_VIDEO_BRANDS.has(brand) || brand.startsWith('mp4')) {
    return { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_VIDEO, mimeType: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4' };
  }
  // An ftyp box with an unrecognized brand is still an MPEG-4-family
  // container by construction — safer to treat it as video (the most
  // common unrecognized case in practice) than to fall through to
  // "unsupported", but it is recorded distinctly so a real gap surfaces
  // in audit metadata rather than silently blending into known brands.
  return { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_VIDEO, mimeType: 'video/mp4', unrecognizedBrand: brand };
}

// ---------------------------------------------------------------------
// RIFF container — WAV audio, AVI video, WEBP image all share the same
// "RIFF....XXXX" shape; the 4-byte form tag at offset 8 disambiguates.
// ---------------------------------------------------------------------

function sniffRiffMimeType(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  const form = buffer.toString('ascii', 8, 12);
  if (form === 'WAVE') return { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_AUDIO, mimeType: 'audio/wav' };
  if (form === 'AVI ') return { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_VIDEO, mimeType: 'video/x-msvideo' };
  if (form === 'WEBP') return { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_IMAGE, mimeType: 'image/webp' };
  return null;
}

// ---------------------------------------------------------------------
// Other audio containers: MP3 (ID3 tag or a raw MPEG frame sync), FLAC,
// OGG (vorbis/opus).
// ---------------------------------------------------------------------

function sniffAudioMimeType(buffer) {
  if (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3') {
    return { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_AUDIO, mimeType: 'audio/mpeg' };
  }
  // A raw MPEG audio frame sync: 11 set bits (0xFFE0 mask) at the start
  // — the standard signature used to detect ID3-less mp3 streams.
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_AUDIO, mimeType: 'audio/mpeg' };
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'fLaC') {
    return { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_AUDIO, mimeType: 'audio/flac' };
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') {
    return { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_AUDIO, mimeType: 'audio/ogg' };
  }
  return null;
}

// ---------------------------------------------------------------------
// Video: WebM/MKV share the EBML header; distinguishing the two
// precisely needs a deeper element walk this slice does not attempt —
// both are treated as video/webm, matching the task's own supported set
// (webm is listed; mkv is not a named target, but sending an
// unrecognized-but-EBML file to the video pipeline honestly reflects
// what it structurally is, and the provider call itself is what proves
// or disproves usability, per this spec's own "detect at runtime, never
// assume" discipline).
// ---------------------------------------------------------------------

function sniffVideoMimeType(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_VIDEO, mimeType: 'video/webm' };
  }
  return null;
}

// ---------------------------------------------------------------------
// Office Open XML (docx/xlsx/pptx) and OpenDocument (odt/ods) — both
// ZIP containers, disambiguated by internal structure (unchanged
// technique from the original routes/documents.js sniffing). xlsx is
// classified STRUCTURED_DATA (deterministic sandbox analysis); docx/
// pptx/odt/ods stay OFFICE_DOCUMENT (existing text-extraction path,
// unchanged this slice).
//
// An Android APK is ALSO a ZIP container — checked first and routed to
// SPECIALIZED_BINARY/blocked rather than falling through to the generic
// "unrecognized zip = archive" case below, since an APK is a packaged
// executable, not a container of independently useful files.
// ---------------------------------------------------------------------

function isZipMagic(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

const OPEN_DOCUMENT_MIME_TYPES = new Set([
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
]);

function sniffZipFamilyMimeType(buffer) {
  if (!isZipMagic(buffer)) return null;
  let zip;
  try {
    zip = new PizZip(buffer);
  } catch {
    return null;
  }

  if (zip.file('AndroidManifest.xml')) {
    return { category: ATTACHMENT_CATEGORIES.SPECIALIZED_BINARY, mimeType: 'application/vnd.android.package-archive', blocked: true };
  }
  if (zip.file('word/document.xml')) {
    return { category: ATTACHMENT_CATEGORIES.OFFICE_DOCUMENT, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  if (zip.file('xl/workbook.xml')) {
    return { category: ATTACHMENT_CATEGORIES.STRUCTURED_DATA, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  if (zip.file('ppt/presentation.xml')) {
    return { category: ATTACHMENT_CATEGORIES.OFFICE_DOCUMENT, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  }
  const mimetypeEntry = zip.file('mimetype');
  if (mimetypeEntry) {
    const declared = mimetypeEntry.asText().trim();
    if (OPEN_DOCUMENT_MIME_TYPES.has(declared)) {
      return { category: ATTACHMENT_CATEGORIES.OFFICE_DOCUMENT, mimeType: declared };
    }
  }
  // A valid ZIP that is none of the above known internal shapes — a
  // plain archive the user wants unpacked, not a disguised document.
  return { category: ATTACHMENT_CATEGORIES.ARCHIVE_OR_CONTAINER, mimeType: 'application/zip' };
}

function sniffPdfMimeType(buffer) {
  return (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '%PDF')
    ? { category: ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_DOCUMENT, mimeType: 'application/pdf' }
    : null;
}

// ---------------------------------------------------------------------
// Non-ZIP archives: gzip, tar.
// ---------------------------------------------------------------------

function sniffArchiveMimeType(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return { category: ATTACHMENT_CATEGORIES.ARCHIVE_OR_CONTAINER, mimeType: 'application/gzip' };
  }
  // POSIX tar: the 6-byte "ustar" (plus NUL or version bytes) magic
  // sits at a fixed 257-byte offset into the first header block.
  if (buffer.length >= 263 && buffer.toString('ascii', 257, 262) === 'ustar') {
    return { category: ATTACHMENT_CATEGORIES.ARCHIVE_OR_CONTAINER, mimeType: 'application/x-tar' };
  }
  return null;
}

// ---------------------------------------------------------------------
// A small set of well-known specialized-binary/executable signatures —
// checked so an executable is classified (and blocked) explicitly,
// rather than falling through to the generic "no signature matched"
// UNSUPPORTED_OR_RESTRICTED path with a less specific reason. This is
// deliberately not exhaustive (the task's own SPECIALIZED_BINARY list
// names formats like .psd/.ai/.dwg/.blend this project has no reason to
// fingerprint yet) — anything not explicitly recognized here or above
// still ends up blocked via the catch-all below, just with a generic
// reason instead of "executable_rejected".
// ---------------------------------------------------------------------

function sniffExecutableMimeType(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return { category: ATTACHMENT_CATEGORIES.SPECIALIZED_BINARY, mimeType: 'application/x-msdownload', blocked: true };
  }
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return { category: ATTACHMENT_CATEGORIES.SPECIALIZED_BINARY, mimeType: 'application/x-elf', blocked: true };
  }
  const machOMagics = [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe];
  if (buffer.length >= 4) {
    const magic = buffer.readUInt32BE(0);
    if (machOMagics.includes(magic)) {
      return { category: ATTACHMENT_CATEGORIES.SPECIALIZED_BINARY, mimeType: 'application/x-mach-binary', blocked: true };
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// Plain text — no magic bytes exist for this family at all. Content
// shape (no NUL byte, no invalid-UTF8 substitution, high printable
// ratio) is the actual security check; the extension is used ONLY to
// pick a label once the shape check has already passed, never as the
// check itself (unchanged discipline from the original implementation).
// Extended here with common source-code/config/markup extensions (all
// still just UTF-8 text, so they reuse the exact same extraction path
// as .txt) — this is the TEXT_OR_CODE category's actual content gate.
// ---------------------------------------------------------------------

const PLAIN_TEXT_EXTENSION_MIME_TYPES = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  // Everything below is real UTF-8 source/config/markup text — mapped
  // to the generic 'text/plain' extraction path (documentTextExtractionService
  // has no format-specific handling for these and needs none; they are
  // read as plain UTF-8 exactly like .txt).
  '.tsv': 'text/plain',
  '.json': 'text/plain',
  '.jsonl': 'text/plain',
  '.html': 'text/plain',
  '.htm': 'text/plain',
  '.xml': 'text/plain',
  '.yaml': 'text/plain',
  '.yml': 'text/plain',
  '.toml': 'text/plain',
  '.ini': 'text/plain',
  '.properties': 'text/plain',
  '.sql': 'text/plain',
  '.graphql': 'text/plain',
  '.py': 'text/plain',
  '.js': 'text/plain',
  '.ts': 'text/plain',
  '.jsx': 'text/plain',
  '.tsx': 'text/plain',
  '.java': 'text/plain',
  '.c': 'text/plain',
  '.cpp': 'text/plain',
  '.cs': 'text/plain',
  '.php': 'text/plain',
  '.go': 'text/plain',
  '.rs': 'text/plain',
  '.css': 'text/plain',
  '.scss': 'text/plain',
  '.less': 'text/plain',
  '.sh': 'text/plain',
  '.log': 'text/plain',
};
const PLAIN_TEXT_SNIFF_SAMPLE_BYTES = 65536;

function looksLikePlainText(buffer) {
  if (buffer.length === 0) return true;
  const sample = buffer.length > PLAIN_TEXT_SNIFF_SAMPLE_BYTES ? buffer.subarray(0, PLAIN_TEXT_SNIFF_SAMPLE_BYTES) : buffer;
  if (sample.includes(0)) return false;
  const text = sample.toString('utf8');
  if (text.includes('�')) return false;
  let printable = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) printable += 1;
  }
  return printable / text.length >= 0.95;
}

function sniffPlainTextMimeType(buffer, fileName) {
  if (!looksLikePlainText(buffer)) return null;
  const match = typeof fileName === 'string' ? fileName.toLowerCase().match(/\.[a-z0-9]+$/) : null;
  const mimeType = match && PLAIN_TEXT_EXTENSION_MIME_TYPES[match[0]];
  if (!mimeType) return null;
  return { category: ATTACHMENT_CATEGORIES.TEXT_OR_CODE, mimeType };
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

// Backward-compatible wrapper matching the exact original
// routes/documents.js sniffChatAttachmentMimeType(buffer, fileName)
// signature/return (a bare mime-type string or null) — kept so the
// upload route's existing behavior for image/pdf/office/text is
// byte-identical, verified by the existing route tests.
function sniffChatAttachmentMimeType(buffer, fileName) {
  const result = classifyAttachment(buffer, { fileName });
  // BLOCKED covers both UNSUPPORTED_OR_RESTRICTED and a blocked
  // SPECIALIZED_BINARY (executable/APK) — both must reject exactly like
  // the original implementation did (both fell through every old sniff
  // check and returned null). Checking processingMode here, not
  // category, is load-bearing: a category-only check would let a
  // positively-identified-but-blocked executable's detectedMimeType
  // through as if it were an accepted upload type.
  return result.processingMode === PROCESSING_MODES.BLOCKED ? null : result.detectedMimeType;
}

// classifyAttachment(buffer, { fileName, declaredMimeType }) -> {
//   category, detectedMimeType, processingMode, blockReason?
// }
//
// declaredMimeType is accepted only for audit/comparison purposes
// (recorded so a suspicious declared-vs-detected mismatch is visible in
// extraction_metadata) — it never influences the category decision
// itself. fileName is used only as the plain-text tie-breaker described
// above.
//
// Order matters: cheapest, least ambiguous checks first. ZIP-family and
// ISO-BMFF/RIFF each internally disambiguate their own sub-cases, so
// they only need to run once apiece.
function classifyAttachment(buffer, { fileName, declaredMimeType } = {}) {
  const legacyImageMimeType = sniffLegacyImageMimeType(buffer);
  if (legacyImageMimeType) {
    return finalize(ATTACHMENT_CATEGORIES.NATIVE_MULTIMODAL_IMAGE, legacyImageMimeType, declaredMimeType);
  }

  const pdf = sniffPdfMimeType(buffer);
  if (pdf) return finalize(pdf.category, pdf.mimeType, declaredMimeType);

  const zipFamily = sniffZipFamilyMimeType(buffer);
  if (zipFamily) return finalize(zipFamily.category, zipFamily.mimeType, declaredMimeType, { blocked: zipFamily.blocked });

  const riff = sniffRiffMimeType(buffer);
  if (riff) return finalize(riff.category, riff.mimeType, declaredMimeType);

  const isoBmff = sniffIsoBmffMimeType(buffer);
  if (isoBmff) {
    return finalize(isoBmff.category, isoBmff.mimeType, declaredMimeType, {
      extractionMetadata: isoBmff.unrecognizedBrand ? { unrecognizedIsoBmffBrand: isoBmff.unrecognizedBrand } : undefined,
    });
  }

  const audio = sniffAudioMimeType(buffer);
  if (audio) return finalize(audio.category, audio.mimeType, declaredMimeType);

  const video = sniffVideoMimeType(buffer);
  if (video) return finalize(video.category, video.mimeType, declaredMimeType);

  const archive = sniffArchiveMimeType(buffer);
  if (archive) return finalize(archive.category, archive.mimeType, declaredMimeType);

  const executable = sniffExecutableMimeType(buffer);
  if (executable) return finalize(executable.category, executable.mimeType, declaredMimeType, { blocked: executable.blocked });

  const plainText = sniffPlainTextMimeType(buffer, fileName);
  if (plainText) return finalize(plainText.category, plainText.mimeType, declaredMimeType);

  return finalize(ATTACHMENT_CATEGORIES.UNSUPPORTED_OR_RESTRICTED, null, declaredMimeType, { blocked: true, blockReason: 'unrecognized_content' });
}

function finalize(category, detectedMimeType, declaredMimeType, opts = {}) {
  const isBlocked = opts.blocked || category === ATTACHMENT_CATEGORIES.UNSUPPORTED_OR_RESTRICTED;
  // category is intentionally unchanged by isBlocked — a blocked
  // executable/APK stays classified SPECIALIZED_BINARY (so the audit
  // trail records what it actually was), only processingMode flips to
  // BLOCKED. Only UNSUPPORTED_OR_RESTRICTED itself uses BLOCKED as its
  // category too, since nothing more specific was ever identified.
  const result = {
    category,
    detectedMimeType,
    processingMode: isBlocked ? PROCESSING_MODES.BLOCKED : CATEGORY_TO_MODE[category],
  };
  if (isBlocked) {
    result.blockReason = opts.blockReason || 'not_permitted_for_ai_processing';
  }
  if (declaredMimeType && detectedMimeType && declaredMimeType !== detectedMimeType) {
    result.declaredMimeTypeMismatch = true;
  }
  if (opts.extractionMetadata) {
    result.extractionMetadata = opts.extractionMetadata;
  }
  return result;
}

module.exports = {
  ATTACHMENT_CATEGORIES,
  PROCESSING_MODES,
  PROCESSING_STATUSES,
  classifyAttachment,
  sniffChatAttachmentMimeType,
  PLAIN_TEXT_EXTENSION_MIME_TYPES,
};
