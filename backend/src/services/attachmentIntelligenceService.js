'use strict';

// Business-service owner of `attachment_intelligence` rows (CLAUDE.md
// rule 1 — routes/tools call a service, never a repository directly).
// Thin on purpose: classification itself is fileIntelligenceRouter's
// job; this service only persists the decision, re-authorizes every
// read against the same chat-attachment ownership chain aiService
// already enforces, and exposes the one status vocabulary the composer
// UI polls.

const attachmentIntelligenceRepository = require('../repositories/attachmentIntelligenceRepository');
const auditLogRepository = require('../repositories/auditLogRepository');
const documentService = require('../services/documentService');
const sandboxExecutionService = require('./sandboxExecutionService');
const fileIntelligenceRouter = require('./fileIntelligenceRouter');

class AttachmentIntelligenceNotFoundError extends Error {}

// Classifies a freshly-uploaded (or freshly-extracted archive child)
// buffer and persists the decision as a new row. Callers own the
// transaction (same `client` convention every other service in this
// codebase uses) and provide documentId only when a `documents` row
// already exists for this buffer (the normal top-level-upload case);
// archive children that haven't been individually stored as their own
// `documents` row yet pass the parent document's id, since
// CLAUDE.md rule 2 keeps DocumentService the sole owner of file bytes —
// this table never stores a second copy.
async function classifyAndRecord(
  client,
  { collegeId, documentId, buffer, fileName, declaredMimeType, parentAttachmentId },
) {
  const classification = fileIntelligenceRouter.classifyAttachment(buffer, { fileName, declaredMimeType });
  const processingStatus =
    classification.processingMode === fileIntelligenceRouter.PROCESSING_MODES.BLOCKED
      ? fileIntelligenceRouter.PROCESSING_STATUSES.BLOCKED
      : fileIntelligenceRouter.PROCESSING_STATUSES.UPLOADED;

  const record = await attachmentIntelligenceRepository.create(client, {
    collegeId,
    documentId,
    parentAttachmentId: parentAttachmentId || null,
    category: classification.category,
    processingMode: classification.processingMode,
    processingStatus,
    detectedMimeType: classification.detectedMimeType,
    declaredMimeType: declaredMimeType || null,
    errorCode: classification.blockReason || null,
    errorMessageSafe: classification.blockReason ? describeBlockReason(classification.blockReason) : null,
    extractionMetadata: classification.extractionMetadata || null,
  });
  return { record, classification };
}

// A closed, audit-safe vocabulary the same way aiService's
// describeExtractionFailureReason already is — only these fixed,
// pre-written sentences are ever shown to a user, never a raw library
// error or a value derived from the file's own content.
const BLOCK_REASON_MESSAGES = {
  unrecognized_content: 'File type is not supported for AI analysis.',
  not_permitted_for_ai_processing: 'File type is not supported for AI analysis.',
  audio_video_not_enabled: 'Audio/video attachments are not enabled for this college.',
  archive_limit_exceeded: 'This archive is too large or too deeply nested to process safely.',
  path_traversal_rejected: 'This archive could not be extracted safely.',
  archive_extraction_unavailable: 'Archive extraction is not available right now — please try again later.',
  corrupt_or_unreadable: 'This file could not be read — it may be corrupted or password-protected.',
  modality_unsupported_by_provider: 'This file type is not currently supported by the configured AI provider.',
};

function describeBlockReason(code) {
  return BLOCK_REASON_MESSAGES[code] || 'File type is not supported for AI analysis.';
}

async function updateStatus(
  client,
  id,
  {
    processingStatus,
    providerFileReference,
    provider,
    conversionArtifacts,
    extractedTextReference,
    extractionMetadata,
    errorCode,
  },
) {
  return attachmentIntelligenceRepository.update(client, id, {
    processingStatus,
    providerFileReference,
    provider,
    conversionArtifacts,
    extractedTextReference,
    extractionMetadata,
    errorCode,
    errorMessageSafe: errorCode ? describeBlockReason(errorCode) : undefined,
  });
}

// Same ownership chain as resolveChatAttachments in aiService.js:
// RLS (tenant scope, enforced by the query) + doc_type ===
// CHAT_ATTACHMENT_DOC_TYPE + uploaded_by_user_id === the caller. A
// cross-tenant or not-owned id resolves to "not found", never a 403 —
// same non-existence-not-403 precedent downloadDocument already sets,
// so this lookup creates no new information-disclosure surface.
//
// Returns the top-level attachment's own row(s) PLUS every descendant
// (an archive's extracted children, and their own children, ...) — a
// child has its OWN document_id (its own real `documents` row, per
// extractArchiveChildren's own comment on why), so findByDocumentId
// alone only ever finds the top-level row. The tree is walked via
// parent_attachment_id, breadth-first, until no level produces further
// children — caught by a real test asserting the full row count for a
// nested archive, not just the top-level one.
async function getForDocument(client, documentId, { actorUserId }) {
  const downloaded = await documentService.downloadDocument(client, documentId);
  const document = downloaded && downloaded.document;
  const isOwnedChatAttachment =
    document &&
    document.doc_type === documentService.CHAT_ATTACHMENT_DOC_TYPE &&
    document.uploaded_by_user_id === actorUserId;
  if (!isOwnedChatAttachment) {
    throw new AttachmentIntelligenceNotFoundError(`attachment ${JSON.stringify(documentId)} was not found`);
  }

  const topLevelRows = await attachmentIntelligenceRepository.findByDocumentId(client, documentId);
  const allRows = [...topLevelRows];
  let frontier = topLevelRows;
  while (frontier.length > 0) {
    // eslint-disable-next-line no-await-in-loop
    const childLists = await Promise.all(
      frontier.map((row) => attachmentIntelligenceRepository.findByParentAttachmentId(client, row.id)),
    );
    const children = childLists.flat();
    allRows.push(...children);
    frontier = children;
  }
  return allRows;
}

// ARCHIVE_OR_CONTAINER handling (ai-chat-file-intelligence-router-
// approved-spec.md's Archive feature). Deliberately SYNCHRONOUS within
// the upload request, not a background job — this codebase already
// tolerates a long-running sandbox round trip inside one HTTP request
// for execute_code (up to 210s, sandboxExecutionService's own
// VERIFIED_EXECUTION_TIMEOUT_MS), and this operation is bounded the
// same way execute_code's own output is (extract_archive.py's own
// 200-entry/500MB caps make "how long can this take" finite, not
// open-ended).
//
// Each child gets its OWN real `documents` row (documentService remains
// the sole file-bytes owner, CLAUDE.md rule 2) — not a second copy
// under the parent's row — so a child is independently referenceable
// in a later chat turn exactly like any top-level attachment, matching
// the spec's own "each independently usable in chat once ready" user
// flow. A BLOCKED child (executable, APK, unrecognized content) is
// never stored at all — audit-logged instead, same "never persist
// blocked content" rule the upload route itself already enforces for a
// top-level attachment.
const MAX_ARCHIVE_RECURSION_DEPTH = 6;

const ARCHIVE_MIME_TO_KIND = {
  'application/zip': 'zip',
  'application/gzip': 'gzip',
  'application/x-tar': 'tar',
};

// Returns { status: 'ok' | 'failed', reason? } — the CALLER (either
// another level of this same recursion, for a nested archive child, or
// processArchiveAttachment for the top-level one) is responsible for
// writing that result onto the relevant attachment_intelligence row's
// own processingStatus. An earlier version of this function recursed
// but discarded the recursive call's return value, which left a
// too-deep nested archive's OWN row permanently stuck at 'uploaded'
// even though its contents were never actually extracted — caught
// before this shipped by a depth-limit test asserting every row
// reaches a terminal status, not just the top-level one.
async function extractArchiveChildren(
  client,
  { collegeId, actorUserId, parentAttachmentId, buffer, fileName, archiveKind, depth },
) {
  if (depth >= MAX_ARCHIVE_RECURSION_DEPTH) {
    return { status: 'failed', reason: 'archive_limit_exceeded' };
  }

  let extraction;
  try {
    extraction = await sandboxExecutionService.extractArchive({ buffer, fileName, archiveKind });
  } catch (err) {
    // SandboxNotConfiguredError or any other sandbox-layer fault —
    // same graceful-degradation treatment at every recursion depth,
    // not just the top (processArchiveAttachment's own comment).
    return { status: 'failed', reason: 'archive_extraction_unavailable' };
  }
  if (extraction.status !== 'ok') {
    return { status: 'failed', reason: extraction.reason || 'archive_extraction_failed' };
  }

  for (const child of extraction.files) {
    const classification = fileIntelligenceRouter.classifyAttachment(child.buffer, { fileName: child.name });

    if (classification.processingMode === fileIntelligenceRouter.PROCESSING_MODES.BLOCKED) {
      // eslint-disable-next-line no-await-in-loop
      await auditLogRepository.createAuditLogEntry(client, {
        collegeId,
        userId: actorUserId,
        action: 'attachment_archive_child_blocked',
        entity: 'attachment_intelligence',
        entityId: parentAttachmentId,
        metadata: { fileName: child.name, category: classification.category, blockReason: classification.blockReason },
      });
      continue; // eslint-disable-line no-continue
    }

    // eslint-disable-next-line no-await-in-loop
    const childDocument = await documentService.uploadChatAttachment(
      client,
      {
        collegeId,
        fileName: child.name,
        mimeType: classification.detectedMimeType,
        fileBuffer: child.buffer,
      },
      { actorUserId },
    );

    // eslint-disable-next-line no-await-in-loop
    const childRecord = await attachmentIntelligenceRepository.create(client, {
      collegeId,
      documentId: childDocument.id,
      parentAttachmentId,
      category: classification.category,
      processingMode: classification.processingMode,
      processingStatus: fileIntelligenceRouter.PROCESSING_STATUSES.UPLOADED,
      detectedMimeType: classification.detectedMimeType,
    });

    if (classification.category === fileIntelligenceRouter.ATTACHMENT_CATEGORIES.ARCHIVE_OR_CONTAINER) {
      const nestedKind = ARCHIVE_MIME_TO_KIND[classification.detectedMimeType];
      // eslint-disable-next-line no-await-in-loop
      const nestedResult = await extractArchiveChildren(client, {
        collegeId,
        actorUserId,
        parentAttachmentId: childRecord.id,
        buffer: child.buffer,
        fileName: child.name,
        archiveKind: nestedKind,
        depth: depth + 1,
      });
      // eslint-disable-next-line no-await-in-loop
      await attachmentIntelligenceRepository.update(client, childRecord.id, {
        processingStatus:
          nestedResult.status === 'ok'
            ? fileIntelligenceRouter.PROCESSING_STATUSES.READY
            : fileIntelligenceRouter.PROCESSING_STATUSES.FAILED,
        errorCode: nestedResult.status === 'ok' ? null : nestedResult.reason,
      });
    }
  }

  return { status: 'ok' };
}

// Entry point the upload route calls right after classifyAndRecord for
// a top-level ARCHIVE_OR_CONTAINER attachment. Updates the top-level
// record's own processingStatus to 'ready'/'failed' when done — a
// caller polling GET /documents/chat-attachments/:id/intelligence sees
// the parent flip to 'ready' once every child (recursively) has been
// extracted and classified, or 'failed' with a safe reason if any
// bound was exceeded. extractArchiveChildren already catches the one
// EXPECTED failure mode (the sandbox being unreachable/unconfigured —
// "capability exists in code before its infra does", same shape as
// sandboxExecutionService.js's own SANDBOX_SERVICE_URL comment and
// webRetrievalService's WebRetrievalNotEnabledError precedent) and
// returns it as a normal { status: 'failed' } result, never a thrown
// error — so nothing here needs its own try/catch; anything that DOES
// throw out of extractArchiveChildren (a real DB fault, a document-
// service validation error) is a genuine bug and should surface as a
// real 500, not be silently absorbed into 'archive_extraction_unavailable'.
async function processArchiveAttachment(
  client,
  { collegeId, actorUserId, attachmentIntelligenceId, buffer, fileName, detectedMimeType },
) {
  const archiveKind = ARCHIVE_MIME_TO_KIND[detectedMimeType];
  const result = await extractArchiveChildren(client, {
    collegeId,
    actorUserId,
    parentAttachmentId: attachmentIntelligenceId,
    buffer,
    fileName,
    archiveKind,
    depth: 0,
  });

  if (result.status === 'ok') {
    return updateStatus(client, attachmentIntelligenceId, {
      processingStatus: fileIntelligenceRouter.PROCESSING_STATUSES.READY,
    });
  }
  return updateStatus(client, attachmentIntelligenceId, {
    processingStatus: fileIntelligenceRouter.PROCESSING_STATUSES.FAILED,
    errorCode: result.reason,
  });
}

module.exports = {
  AttachmentIntelligenceNotFoundError,
  classifyAndRecord,
  updateStatus,
  getForDocument,
  describeBlockReason,
  processArchiveAttachment,
};
