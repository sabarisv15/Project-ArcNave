# Approved Spec — AI Chat File Intelligence Router (multi-format attachment classification + audio/video/archive support)

**Mode:** Feature (backend-primary; small, additive frontend surface — composer
attachment status states only. No new page/screen.)

**Analyzed:** 2026-08-30. Not one of the six items queued in
`70-checkpoint/CURRENT-STATE.md` — a new, user-directed request to
generalize chat-attachment handling from today's ad hoc
image/PDF/office/text branching in `resolveChatAttachments`
(`backend/src/services/aiService.js:501`) into an explicit, MIME-sniffed
router that also adds two genuinely new modalities (audio, video) and one
genuinely new category (archives), while leaving the existing, separately
ADR-gated PDF/table pipeline (ADL-055 through ADL-065) untouched.

Four decisions were required before this pass and were answered directly
by the product owner (not re-derivable from code):

1. **Scope this pass to categories buildable on existing infra, plus
   audio/video/archive** — not specialized-binary preview rendering or
   malware/AV scanning (no infra exists for either; see OUT OF SCOPE).
2. **Add ffmpeg + an archive library to `sandbox-service`**, following the
   Dockerfile's own existing discipline (fixed, reviewed, pinned, no
   request-time install) — same rigor as the pdfplumber/pandas additions
   already documented there.
3. **Audio/video get a new per-college opt-in gate**, using the
   **existing generic `configurations` category table**
   (`configurationService.getConfiguration`/`setConfiguration`) — the
   exact mechanism `webRetrievalService.js` already uses for its own
   RS-AIG-020 opt-in (`CONFIG_CATEGORY = 'web_retrieval'`, `{enabled}` in
   the stored JSON, "no new migration needed for the opt-in flag itself",
   verbatim from that file's own header comment). This spec adds
   `CONFIG_CATEGORY = 'audio_video_attachments'` following the identical
   shape — **not** a new `college_ai_config` column (corrected after
   reading `configurationService.js`/`webRetrievalService.js` directly;
   the original draft of this decision assumed a dedicated column that
   does not match how this exact precedent is actually implemented).
   Every other category (images, PDF, office docs, text, structured data,
   archives) keeps today's implicit-at-upload consent — no behavior
   change there.
4. **High-impact extracted fields (marks, student identifiers, certificate
   numbers, financial values) never auto-write to an authoritative
   record** in this slice. Any future consumer that would write router
   output to a record must go through `WorkflowService` (CLAUDE.md rule
   3) — enforced here by *not building* such a consumer, not by adding a
   new parallel gate. Where this slice *does* produce a document (audio
   meeting-minutes, video lecture summaries), it reuses the **existing**
   `ArtifactService` → `DocumentService` publish-approval flow
   (`documentService.submitPublishRequest`/`approvePublish`,
   `documentService.js:1121-1291`, ADR-009 Amendment 1) rather than
   inventing a second approval mechanism.

**This document's OUT OF SCOPE section is a hard implementation
boundary**: `/build-slice` and `/wire-frontend` must not implement, wire,
refactor, or change anything listed there without a new, separate Product
Reasoning pass.

---

## Origin finding (why this exists)

`resolveChatAttachments` today has no explicit classification step — it
branches on `mime_type.startsWith('image/')` vs. a fixed
`DOCUMENT_ATTACHMENT_MIME_TYPES` allowlist, with every non-image type
routed through the same `documentTextExtractionService.extractPlainText`
regardless of whether that's the right handling (it demonstrably is for
docx/pptx/odt/text; it silently discards structure for xlsx, which the
separate `documentAnalysisService`/`documentTableExtractionService`/
`sandboxExecutionService` tool pipeline already handles correctly when the
model calls a tool — but not in the direct-context path). There is also no
path at all for audio, video, or archives — they fail `sniffChatAttachmentMimeType`
outright today (`routes/documents.js:564`) with a generic "unsupported
attachment type" rejection.

**What is explicitly NOT being re-litigated:** the PDF/table trust
architecture. ADL-058/063 already measured that native Gemini reading
cannot count reliably and does not scale past ~400 pages, so PDFs stay on
the existing deterministic-first path (`documentTableExtractionService` →
`documentAggregateService` → sandbox `execute_code`/`pdfplumber`,
cross-checked by `verifyNumericClaims`, RS-AIG-019/ADL-037 advisory-only).
This spec's router **classifies** PDFs into `NATIVE_MULTIMODAL_DOCUMENT`
for taxonomy purposes but its actual handling is a pass-through to the
existing unmodified pipeline. Same reasoning for xlsx →
`STRUCTURED_DATA`: it already has a correct deterministic path via the
tool pipeline; this slice's only change for xlsx is making
`resolveChatAttachments`' *direct-context* path stop flattening it to
lossy text and instead supply a compact deterministic summary (sheet
names, dimensions, header row) — never raw formulas, never executed
macros.

## Page / Navigation / Tabs

N/A — no new page or screen. Existing AI chat composer (`AIComposer.jsx`,
`ComposerAttachmentStrip.jsx`) and chat-attachment upload endpoint
(`POST /documents/chat-attachments`) unchanged in shape; only the status
vocabulary shown for an attachment gains new states.

## Purpose

Every chat attachment gets one, auditable classification decision — made
once, from sniffed content bytes, against a closed category vocabulary —
instead of implicit branching repeated ad hoc at each call site. Audio and
video become usable attachment types for the first time, gated by explicit
per-college consent. Archives are extracted safely (size/depth/count
bounds, path-traversal guards) and their contents recursively classified,
instead of being rejected outright.

## Role

No new role. Existing chat-attachment authorization chain is unchanged and
reused as-is: RLS (tenant scope) + `doc_type === CHAT_ATTACHMENT_DOC_TYPE`
+ `uploaded_by_user_id === identityContext.userId`
(`aiService.js:511-521`). Audio/video processing additionally requires the
new `college_ai_config.allow_audio_video_attachments` flag (default
`false` — opt-in, per Decision 3 above).

## Features

### CORE — `fileIntelligenceRouter` classification module

New module, `backend/src/services/fileIntelligenceRouter.js`. Single
entry point `classifyAttachment(buffer, { fileName, declaredMimeType })`
→ `{ category, detectedMimeType, processingMode }`. Reuses the **existing**
sniff functions in `routes/documents.js` (moved to this module so both the
upload route and the router call the same code — not duplicated) and
extends them with: audio magic-byte/container sniffing (WAV/RIFF, MP3
frame sync or ID3, FLAC `fLaC`, OGG/Opus `OggS`, M4A/MP4 `ftyp` box
variants), video sniffing (MP4/MOV `ftyp` box variants, WebM/MKV EBML
header, AVI `RIFF...AVI `), and archive sniffing (ZIP local-file-header
magic, gzip magic, tar via 257-byte `ustar` offset check). Extension is
never authoritative — used only as a hint when a format has no magic bytes
(the existing plain-text precedent).

Category → `AttachmentProcessingMode` mapping (only the ten categories
named in the task; all ten are classified, only the ones below get new
*processing*, the rest keep or gain no new behavior this slice):

| Category | Mode | This slice's behavior |
|---|---|---|
| `NATIVE_MULTIMODAL_IMAGE` | `native_multimodal` | Unchanged path (inline_data base64) + **new**: dimension/byte-size limits, EXIF GPS stripping, HEIC/HEIF handled by capability probe (see Edge cases) with sandbox conversion fallback |
| `NATIVE_MULTIMODAL_DOCUMENT` (PDF) | `native_multimodal` (classification only) | **Unchanged** — passes through to the existing ADL-058/063 pipeline untouched |
| `NATIVE_MULTIMODAL_AUDIO` | `native_multimodal` | **New** — see Audio feature below |
| `NATIVE_MULTIMODAL_VIDEO` | `native_multimodal` | **New** — see Video feature below |
| `TEXT_OR_CODE` | `text_context` | Existing plain-text path, **extended** allowlist (source-code extensions) + secret redaction for `.env`-shaped content |
| `STRUCTURED_DATA` (xlsx/csv) | `structured_analysis` | **Changed for the direct-context path only**: compact deterministic summary via sandbox `openpyxl`, not raw text flattening. The tool-based pipeline (`documentAnalysisService`) is untouched. |
| `OFFICE_DOCUMENT` (docx/pptx/odt/ods) | `text_context` | **Unchanged** — existing `documentTextExtractionService` text extraction. Auto-detecting "visual layout requested" and rendering to PDF is OUT OF SCOPE this slice. |
| `ARCHIVE_OR_CONTAINER` | `unpack_and_route` | **New** — see Archive feature below |
| `SPECIALIZED_BINARY` | `metadata_only` | **New, minimal** — filename/size/sniffed-type recorded, never opened, never sent anywhere. No preview rendering (no infra — OUT OF SCOPE). |
| `UNSUPPORTED_OR_RESTRICTED` | `blocked` | Existing sniff-rejection path, reused, with the router's explicit reason codes (Validation section) |

### CORE — audio: opt-in native multimodal with honest capability degradation

Per Decision 3: gated behind the `audio_video_attachments` configuration
category (`configurationService`, `{enabled: boolean}`, default
disabled when no row exists — identical shape to `web_retrieval`'s own
opt-in, not a new mechanism). When enabled, a sniffed audio type
in the closed supported set (wav, mp3, flac, m4a/mp4-audio, ogg/opus) is
sent to Gemini as a `fileData`/`inline_data` part with its real sniffed
MIME type. **This project cannot assert `gemini-3.7-flash`'s audio
support from a label** (task instruction, and this repo's own "measure
before designing" discipline — see `70-checkpoint/CURRENT-STATE.md`'s
repeated probe-before-build pattern). The call is wrapped so that a
provider-side "modality not supported" / 400-class rejection degrades to
`processingStatus: 'failed'` with `errorCode: 'modality_unsupported_by_provider'`
— never a generic 500, never a silent drop — matching the existing
`buildImageUnavailableNote` honest-degradation precedent
(`aiService.js`). An unsupported *codec/container* (not unsupported
*modality*) is transcoded via the new sandbox ffmpeg step to WAV before
the native call.

### CORE — video: same opt-in gate, same honest degradation, plus readiness wait

Same `audio_video_attachments` configuration category as audio (one flag
covers both, per Decision 3's framing — "audio and video" was answered as
one question). Supported
container/codec combinations reaching Gemini natively: mp4, webm, mov
(closed set, sniffed). Unsupported containers transcode via sandbox ffmpeg
to H.264/AAC MP4. If the provider requires an upload/indexing step before
a video part is usable (Vertex Files-API-style semantics), the background
job polls readiness and the attachment stays `processing` until it flips
to `ready`; a timeout degrades to `failed` with a safe reason, never hangs
indefinitely.

**Explicitly barred, reaffirmed from the task's own instruction:** no
CCTV/surveillance/disciplinary video processing without its own,
separate authorization/audit/retention decision — this slice's opt-in
flag covers ordinary uploads (lecture recordings, meeting audio) only, and
`fileIntelligenceRouter` does not attempt to distinguish those from
surveillance footage by content — that distinction is a future product
decision, not inferred here.

### CORE — archive extraction with bounded, path-safe unpacking

ZIP (via the sandbox's new pinned archive library) and gzip/tar are
unpacked in the **sandbox service** (already network-egress-denied, no
change to that property) with hard limits enforced *during* extraction,
not after: max 200 entries, max 500 MB total uncompressed, max 6 levels of
nested-archive recursion, and every entry path is normalized and checked
against `..`/absolute-path escape before being written — a violation of
any limit aborts the whole extraction and the parent attachment is marked
`failed` with `errorCode: 'archive_limit_exceeded'` (never a partial,
silently-truncated unpack). Every child file is re-classified through
`fileIntelligenceRouter.classifyAttachment` from its own sniffed bytes
(never trusting the name inside the archive) and gets its own
`AttachmentIntelligenceRecord` row with `parentAttachmentId` set — same
audit trail shape as the top-level attachment.

**No malware/AV scanning** — no AV engine exists in this repository's
infrastructure and adding one is a separate infra decision (see OUT OF
SCOPE). Mitigation for this slice: the *existing* MIME-sniff allowlist
already gates every extracted child exactly as it gates a direct upload
— an executable or unrecognized binary inside a ZIP fails classification
into `UNSUPPORTED_OR_RESTRICTED`/`blocked` the same as if it had been
uploaded directly. Nothing extracted from an archive is ever executed.
`.eml`/`.msg`/`.mbox` parsing is OUT OF SCOPE this slice (no email-parsing
dependency currently vetted into the sandbox allowlist).

### REQUIRED SUPPORT — `AttachmentIntelligenceRecord` schema

New table `attachment_intelligence`, tenant-scoped (RLS, same policy
shape as `documents`), one row per attachment (top-level or archive
child), FK to `documents.id`. Columns follow the task's proposed shape,
adapted to this project's snake_case/JSONB conventions: `id`,
`college_id`, `document_id` (FK), `parent_attachment_id` (FK, nullable,
self-referential — archive children), `category`, `processing_mode`,
`processing_status`, `detected_mime_type`, `declared_mime_type`,
`sha256`, `provider`, `provider_file_reference`, `conversion_artifacts`
(JSONB array), `extracted_text_reference` (nullable FK-shaped pointer,
not inline text — text stays where `documentTextExtractionService`
already puts it), `extraction_metadata` (JSONB), `error_code`,
`error_message_safe`, `created_at`, `updated_at`. Reversible migration,
purely additive — no existing column changes, no existing API contract
changes.

### REQUIRED SUPPORT — composer status states

`useComposerAttachments.js` gains the states already in production
elsewhere in this codebase's own vocabulary (`uploaded`, now also
`validating`, `queued`, `processing`, `ready`, `needs_review`, `failed`,
`blocked`) — additive to the existing `uploading`/`ready`/`failed` set,
backward compatible (every existing transition still fires the same way;
new states only appear for audio/video/archive/structured-data
attachments that need them). Status copy follows the task's own
recommended language (Validating file / Preparing document / Extracting
workbook data / Processing audio / Indexing video / Ready for AI analysis
/ Needs review / Processing failed / File type is not supported for AI
analysis) — no "100% accurate" / "AI verified" language anywhere.

## User flows

- **User goal (audio/video, opted-in college):** Attach a lecture
  recording or voice note → see it move through
  validating → (converting, if codec needs it) → processing → ready →
  ask a question about it in chat.
- **User goal (audio/video, NOT opted-in):** Attach the same file → sees
  "File type is not supported for AI analysis" immediately, with a reason
  distinct from a genuinely unsupported format (config vs. capability).
- **User goal (archive):** Attach a ZIP of scanned certificates → sees
  child files appear individually as they're extracted and classified,
  each independently usable in chat once `ready`.
- **Failure path:** Any transcode/provider/limit failure degrades to
  `failed` with a safe, specific reason — never a raw library error,
  never a silent drop, never a hang.
- **Completion state:** Unchanged for existing image/PDF/office/text
  flows — this spec adds states, it does not remove or rename any
  existing one.

## UI components

`ComposerAttachmentStrip.jsx` — extend the existing status-chip rendering
with the new state set (no new component; same chip pattern
`SentFileChip` in `ChatMessage.jsx` already uses for persisted display).

## Permissions

Unchanged authorization chain for all categories (Role section above).
New: the `audio_video_attachments` configuration category (via
`configurationService.getConfiguration`) is read at the point audio/video
classification would otherwise proceed to native-multimodal processing —
the exact same call shape `webRetrievalService.getWebRetrievalConfig`
already uses, reused directly, not a second config-read path.

## API contracts

No breaking change. `POST /documents/chat-attachments` gains audio/video/
archive to its accepted-type sniff set (its 400 error message updates to
list them). Response shape unchanged (`{ id, mime_type, size_bytes }`).
New read-only endpoint: `GET /documents/chat-attachments/:id/intelligence`
returning the `AttachmentIntelligenceRecord` (status/category/error) for
composer polling — same auth chain as attachment download.

## Data dependencies

New migration: `attachment_intelligence` table only (reversible `up`/`down`,
matching this repo's existing migration convention — see
`1752500000000_module-6-documents-schema.js` for the tenant-table/RLS
house style and `1754000000000_background-jobs.js` for a minimal
comparable table). **No `college_ai_config` change** — the audio/video
opt-in reuses the existing generic `configurations` category table via
`configurationService`, needing no migration at all (same as
`web_retrieval`'s own opt-in). New npm/pip dependencies, each pinned and
reviewed per the sandbox Dockerfile's own stated discipline:
- sandbox: `ffmpeg` (apt, static binary, no network at runtime — audio/video transcode)
- sandbox: a pinned archive library for safe ZIP/tar extraction with the bounds this spec requires
- backend: an EXIF-stripping library for the image path (small, no network)

## States

- **Validating** → sniffing/classification in progress.
- **Queued** → accepted, waiting for a background job slot (audio/video
  transcode, archive extraction).
- **Processing** → transcode/extraction/provider-indexing in progress.
- **Ready** → usable in chat as a native-multimodal or text-context input.
- **Needs review** → extracted high-impact fields (marks/IDs/certificate
  numbers/financial values) surfaced with this status; advisory only,
  never auto-committed (Decision 4).
- **Failed** → safe reason shown, retry available if the failure was
  transient (provider timeout, transcode worker crash) — not offered for
  a permanent one (unsupported modality, archive limit exceeded).
- **Blocked** → sniff rejected the content outright, or the college has
  not opted in to the modality.

## Validation

Untrusted-content discipline unchanged (CLAUDE.md rule 9): every string
this router or its extraction paths produce — audio/video transcript
text, archive child filenames, xlsx cell values, EXIF fields not stripped
— is still untrusted document content, boundary-wrapped by
`aiPromptSafetyLayer` before reaching any prompt, exactly as existing
attachment text already is. Nothing in classification, extraction, or the
new `needs_review` signal is derived from instructions embedded in the
file content.

MIME validation is content-first everywhere this spec touches, never
extension-first, matching `routes/documents.js`'s existing discipline —
extended, not replaced.

## Edge cases

- **HEIC/HEIF image:** provider support unconfirmed for
  `gemini-3.7-flash` (no assumption made — task instruction). A live
  capability probe (`backend/scripts/multimodal-heic-capability-probe.js`,
  new, following this repo's existing probe-script convention) determines
  it once; until/unless that probe confirms direct support, HEIC converts
  to JPEG via the sandbox before sending, original preserved, conversion
  recorded in `conversion_artifacts`.
- **Audio/video native support itself unconfirmed:** same treatment — a
  probe script measures it once; the runtime code never assumes and
  degrades honestly on rejection regardless of what the probe found
  (defense in depth against a provider capability changing later).
- **Zip bomb / deeply nested archive / path traversal entry
  (`../../etc/passsomething`):** extraction aborts, `archive_limit_exceeded`
  or `path_traversal_rejected`, no partial write survives.
- **Archive containing another archive containing an executable:**
  recursion depth bound catches unreasonable nesting; the executable
  itself still fails classification into `blocked` regardless of nesting
  depth — two independent stops, not one.
- **A college with no `audio_video_attachments` configuration row (or
  `enabled: false`) receives an audio upload:** classified correctly, but
  held at `blocked` with a config-specific reason distinct from "format
  not supported at all."
- **Cross-tenant attachment id in the new intelligence-lookup endpoint:**
  RLS hides the row exactly as `downloadDocument` already does for the
  existing attachment path — same non-existence-not-403 behavior, no new
  precedent introduced.
- **Structured-data (xlsx) with macros (`.xlsm`):** classified
  `STRUCTURED_DATA`; macros are never executed — `openpyxl` reads
  workbook data only, matching the task's own explicit rule.

## Testing requirements

- Unit: MIME spoofing — a `.pdf`-named file containing an ELF/PE header
  classifies `UNSUPPORTED_OR_RESTRICTED`/`blocked`, never
  `NATIVE_MULTIMODAL_DOCUMENT`.
- Unit: each new sniff function (audio: wav/mp3/flac/m4a/ogg; video:
  mp4/webm/mov; archive: zip/gzip/tar) against real minimal fixture
  headers, plus a negative case per format (near-miss magic bytes).
- Unit: archive extraction — zip-bomb-shaped fixture (small compressed,
  huge declared uncompressed size) rejected before full decompression;
  path-traversal entry rejected; nested-archive recursion bound enforced;
  a well-formed small ZIP recursively classifies its children correctly
  with `parent_attachment_id` set.
- Unit: `audio_video_attachments` configuration disabled (or absent)
  blocks an otherwise-valid audio file with the config-specific reason.
- Unit: provider rejection on a native audio/video call degrades to
  `failed`/`modality_unsupported_by_provider`, never throws out of the
  turn (same shape as ADL-056's `invalid_pattern` precedent).
- Unit: xlsx direct-context path returns a compact deterministic summary,
  never raw formula text, never an executed macro from an `.xlsm` fixture.
- Integration: existing image/PDF/office/text chat-attachment flows
  (`resolveChatAttachments` callers) produce byte-identical behavior to
  today — this is the backward-compatibility requirement from the task.
- Integration: cross-tenant access impossible for `attachment_intelligence`
  rows, the new intelligence-lookup endpoint, and archive child records.
- **Live check, required before this is called done:** run the new HEIC
  and audio/video capability probes against the real configured Vertex
  project (`backend/.env.local.sh`) and record their actual results in
  this spec's own follow-up note — do not ship the "unconfirmed, defensive
  degradation" language as a permanent state if the probe already answers
  it.

**Live result, 2026-08-30** (`backend/scripts/multimodal-audio-video-capability-probe.js`,
one real, billable Vertex call, against the actually-configured
`GEMINI_MODEL`): a real, valid, synthesized WAV (1s, 440Hz sine tone) sent
as an `audio/wav` inline_data part returned **HTTP 200**, and the model
correctly described it as "a continuous, low-to-mid-pitched electronic
tone [that] plays steadily for about one and a half seconds" — genuine
content understanding (slightly over-estimating duration, 1.5s vs. the
real 1s, which is itself useful signal that this is real audio
processing, not a rubber-stamped acceptance). **Confirmed: audio is
natively supported by the configured model at the wire-format level
used here (`inline_data.mime_type: 'audio/wav'`).** The runtime
honest-degradation path (Audio feature above) stays in the code
regardless — this one probe on one short tone does not license removing
it for real speech/music content, longer files, or other codecs, and a
provider/model change must not silently invalidate this finding.

**VIDEO and HEIC remain genuinely unmeasured** — synthesizing a valid
minimal MP4/MOV or HEIC fixture needs an encoder (ffmpeg/libheif) not
available on the host this probe was written on. This is stated
honestly rather than inferred from the audio result: ISO-BMFF container
acceptance for video/HEIC is a different code path in Vertex's own
implementation than the audio path just measured, and this project's
own history (native PDF reading) already showed a real capability gap
that guessing would have missed the other way. Do not treat video/HEIC
as confirmed until their own probes run — once the sandbox image (with
ffmpeg) is built, `scripts/transcode.py`'s own output is a natural
source of a real minimal video fixture for that follow-up probe.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| Malware/AV scanning of any kind | FUTURE — needs its own infra decision | No AV engine (e.g. ClamAV) exists anywhere in this repo's infrastructure. Mitigated for archives by re-running the existing MIME allowlist against every extracted child (Archive feature above), not by scanning. |
| Specialized-binary preview rendering (PSD/AI/DWG/STL/etc.) | FUTURE | No isolated rendering service exists. This slice ships `metadata_only` (filename/size/type recorded, never opened) for the whole `SPECIALIZED_BINARY` category. |
| Office-document visual rendering (docx/pptx → PDF/image for layout-sensitive questions) | FUTURE | The sandbox already has a working `soffice.py` path (flagged safe in the 2026-08-30 skill audit) that could back this, but detecting *when* visual layout matters (vs. plain text sufficing) is an unscoped product decision, not a technical gap. |
| `.eml`/`.msg`/`.mbox` email parsing inside archives | FUTURE | No vetted email-parsing dependency in the sandbox allowlist yet. |
| CCTV/surveillance/disciplinary video handling | BARRED without its own separate authorization/audit/retention decision | Explicit in the task's own instructions; this slice's opt-in flag is scoped to ordinary lecture/meeting uploads only and makes no attempt to distinguish surveillance content. |
| Any write of extracted marks/student-identifiers/certificate-numbers/financial-values into an authoritative record | BARRED until its own Product Reasoning + WorkflowService-gated design | Decision 4. This slice only ever produces advisory, `needs_review`-flagged output surfaced to a human. |
| Any change to `verifyNumericClaims`'s advisory-only nature, or to the PDF/table trust architecture (ADL-055 through ADL-065) | BARRED | RS-AIG-019/ADL-037, reaffirmed. This router classifies PDFs/xlsx but does not alter their existing deterministic pipeline. |
| Image reverse-search / own-corpus multimodal embedding search | Separate, already-parked decision | `70-checkpoint/CURRENT-STATE.md` Decision 2 — unrelated to this spec, not resolved or touched here. |
| Sandboxed / general-purpose code execution beyond the existing `execute_code` tool | BARRED | RS-AIG-018/ADL-036/ADR-029, unchanged. |
| Retention-period changes, provider-hosted-file deletion-on-delete guarantees beyond what already exists | FUTURE | This slice adds `provider_file_reference` for audit visibility; enforcing its deletion when a provider (e.g. a Files-API-style temporary store) is used is a follow-up, not built here. |
