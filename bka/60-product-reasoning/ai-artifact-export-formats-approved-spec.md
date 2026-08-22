# Approved Spec — AI Artifact/Document Export Formats (Part A)

**Scope mode:** Feature (`--feature "AI-generated chat reports/artifacts
downloadable as docx/pdf/csv/xlsx/txt, not just markdown"`), extending the
existing Artifacts capability (`bka/60-product-reasoning/
staff-experience-2026-08-08.md` §13) and the chat report-generation flow
(`generate_document`/`export_artifact` AI tools).

**Origin:** Live-caught gap — a user asked the AI ("1040 vs 2040 result
comparision pani docx file ah report ready panu") for a docx report and
received a `.md` file with no way to get docx/pdf/etc., because neither
`generate_document` nor `export_artifact` (nor `ArtifactService.
publishArtifact`) has ever accepted a format. Confirmed via research: `docx`,
`pdfkit`, and `exceljs` are already installed dependencies (unused for this
path), so this part is a wiring gap, not a missing capability.

**Phasing decision (user-confirmed):** This spec covers **Part A** —
document export formats (markdown/docx/pdf/txt/csv/xlsx) for AI-authored
text content. AI **image generation** ("generate an image of a transistor")
remains deferred to a separate Product Reasoning pass — see OUT OF SCOPE —
since it implies a provider/cost decision (which image-gen model/API) the
user has not made.

**Amendment (same day, post-implementation):** a live side-by-side against
a same-prompt Gemini-generated PDF/docx surfaced two follow-up decisions,
both resolved by the user and folded into this build rather than spun into
a separate pass, since neither changes this spec's architecture (still the
same `markdownFormatConverter.js`/Generator Module pattern):
1. **PPT/slide generation is now in scope** (`pptxgenjs` added as a
   dependency) — `markdownPptxGenerator.js` renders one slide per H1/H2
   section, bullet-izing paragraph lines and rendering any embedded table
   as a real pptx table. The "image-gen SDK vs. pptxgenjs" distinction
   that justified deferring PPT alongside image-gen no longer applies:
   pptxgenjs needed no provider/cost decision, only a dependency.
2. **Visual design/polish for docx/pdf/pptx** — the v1 generators (plain
   headings/paragraphs/grid table) read as noticeably less finished next
   to Gemini's colored banners/styled tables/card layouts. `documentTheme.js`
   now provides one shared palette (lifted from `frontend/src/index.css`'s
   own `--c-*` tokens — ARCNAVE's actual paper/cream/teal-accent system,
   not a copy of Gemini's blue or an invented one) that all three
   generators apply: colored title banners, styled table headers with
   alternating row tints, section accent bars, and page-number footers.

---

## Purpose

Let a user get an AI-authored report/document (from an open Artifact or
from an ordinary chat request) in the file format they actually asked for —
docx, pdf, txt, csv, or xlsx — instead of always receiving markdown,
without requiring them to know or care that the content started life as
markdown.

## Role

All authenticated roles that can already use AI chat / Artifacts
(`principal`, `hod`, `staff`, `class_tutor` — unchanged from the existing
`export_artifact`/`generate_document`/artifact CRUD tools' `allowedRoles`).

## Navigation

No new page. Reachable from: (a) chat, by asking in natural language for a
format; (b) the existing Artifact Editor's "Export to Documents" action.

## Features

### CORE

1. **Shared markdown→format converter** (new pure Generator module, ADR-008
   pattern: no DB/storage access, `(markdownContent, format) -> {buffer,
   mimeType, fileExtension}`). Formats: `markdown` (unchanged passthrough,
   default), `docx`, `pdf`, `txt`, `csv`, `xlsx`.
   - `docx`: markdown headings/paragraphs/lists/tables → a real `docx`
     `Document` (via the already-installed `docx` library).
   - `pdf`: same structural mapping via `pdfkit` (already installed).
   - `txt`: markdown source as plain text (no lossy stripping needed —
     it's already human-readable).
   - `csv`/`xlsx`: extract the **first markdown pipe-table** found in the
     content into rows/columns (via `exceljs` for xlsx; plain CSV writer
     for csv). **If no table exists in the content, this throws a clear
     validation error** — resolved product decision, see Validation below.
2. `ArtifactService.publishArtifact(client, id, {userId, collegeId,
   format})` — `format` optional, defaults to `'markdown'` (byte-identical
   to current behavior for every existing caller/test that omits it).
   Still terminal/one-shot per ADR-009 Amendment 1 — this only changes
   *which byte format* the one canonical published document lands in, not
   the "publish once" rule.
3. **New** `ArtifactService.exportArtifactAs(client, id, format, {userId,
   collegeId})` — the retroactive "give me this AS docx" action. Works on
   any artifact the user owns, **regardless of publish status** (draft or
   already-published) — read of `artifact.content`, converts, and creates
   a **new, separate** `DocumentService` document each call (never touches
   the artifact's own `status`/`publishedDocumentId`). Audit-logged as
   `artifact_exported` (distinct from `artifact_published`).
4. **`generate_document` AI tool now creates a real Artifact** (via
   `ArtifactService.createArtifact` + `publishArtifact`) instead of calling
   `DocumentService.uploadPersonalDocument` directly. This closes a
   pre-existing CLAUDE.md rule 2 gap (AI-generated structured content must
   be `ArtifactService`-owned) as a side effect, and is what makes a
   chat-generated report re-exportable in another format later (via
   `export_artifact_as`, item 6) — a bare, artifact-less Document has no
   such path. Same external behavior otherwise (still lands in the
   acting user's Documents, "AI Artifacts" folder). Gains an optional
   `format` param (see item 7).
5. `export_artifact` AI tool (existing, Artifact-Editor-scoped) gains the
   same optional `format` param, passed straight to `publishArtifact`.
6. **New** `export_artifact_as` AI tool — the chat-facing answer to a
   follow-up like "now give me that as docx," when the artifact isn't the
   one currently open (or wasn't opened via the Editor at all). Calls
   `exportArtifactAs`. Requires `artifact_id` — resolved via item 7's list
   tool when not already in context (e.g. `focusContext`).
7. **New** `list_own_artifacts` AI tool (thin wrap of the existing
   `ArtifactService.listOwnArtifacts`, read-only, no new business logic) —
   lets the model resolve "that ECE report from earlier" to a real
   `artifact_id` by title/recency across turns, the same way it would look
   up any other entity it doesn't already have an id for. Small, tightly
   scoped, and a direct prerequisite for item 6 to work outside the single
   turn it was created in — not independent scope creep.
8. `format` param vocabulary shared by every tool above: `markdown | docx |
   pdf | txt | csv | xlsx` (enum, matches the converter's format list
   exactly — one vocabulary, not per-tool drift).

### REQUIRED SUPPORT

9. **ArtifactEditor "Export to Documents" gains a format choice** (existing
   single button → a format-choice control, e.g. a dropdown/menu using the
   app's existing menu primitive) — passes the chosen `format` to
   `publishArtifact`. Once already published (button already reads
   "Exported to Documents," disabled), the same control becomes a
   secondary "Download as ▾" action offering the remaining formats via
   `exportArtifactAs` — a natural extension of the one existing button,
   not a new page or pattern.

## User flows

**Flow 1 — chat-driven, first request (the origin case):**
User: "...docx file ah report ready panu" → model calls `generate_document`
with `format: 'docx'` → a real `.docx` document is created directly,
correctly, first try. No follow-up needed.

**Flow 2 — chat-driven, retroactive (the exact screenshot case):**
User previously got a `.md` report, now says "docx file venum" → model
calls `list_own_artifacts`, matches the report by title, calls
`export_artifact_as` with the resolved id and `format: 'docx'` → a second,
new `.docx` Document appears in the user's Documents (the original `.md`
document is untouched — both exist, same as any "download as" pattern).

**Flow 3 — Artifact Editor, UI-driven:** User opens an artifact, picks
"Word" from the export control → same `publishArtifact({format: 'docx'})`
path as item 2. If they later want a PDF too, "Download as ▾ → PDF" calls
`exportArtifactAs`.

## Permissions

Unchanged — every new/modified tool and service method reuses the exact
ownership chain already enforced by `ArtifactService.resolveOwnArtifact`
(the acting user's own artifact, college-scoped via RLS) and the existing
`allowedRoles` list on `export_artifact`/`generate_document`
(`principal`/`hod`/`staff`/`class_tutor`). No destructive action is
introduced (export/publish only ever adds a document, never deletes or
overwrites), so CLAUDE.md rule 3 (`WorkflowService` as sole approval gate)
does not apply here, consistent with `publishArtifact`'s existing
treatment.

## API contracts

No new REST route is required — every new capability is reached through
the existing AI tool-call path (`POST /api/v1/ai/ask(/stream)` →
`aiToolRegistry.invokeTool`), matching how `export_artifact`/
`generate_document` already work today. The ArtifactEditor UI change
(item 9) calls the existing `artifactsApi.publish` client function with an
added `format` field in its request body — `PATCH/POST
/api/v1/artifacts/:id/publish` gains an optional `format` field, and a new
`POST /api/v1/artifacts/:id/export` route (mirrors `.../publish`'s
existing shape) wraps `exportArtifactAs`, returning the new document's
metadata (same response shape `publish` already returns) so the frontend
can render the same "Saved to Documents, Download" card pattern the chat
UI already shows in the screenshot — no new presentation/UI pattern
needed.

## Data dependencies

**No DB migration.** `exportArtifactAs` creates additional, ordinary
`DocumentService` documents — it does not add any column to `artifacts` to
track them (each export is a first-class, independent Document in the
user's own Documents/AI Artifacts folder, discoverable there, exactly like
`publishArtifact`'s existing single document). `artifacts.
published_document_id` continues to mean exactly what it means today: the
one canonical publish, unchanged.

## States

- **Loading:** existing tool-call/publish loading indicators, unchanged.
- **Empty:** N/A (this feature has no list/empty state of its own).
- **Error:** csv/xlsx requested on content with no table → converter
  throws a typed error → surfaces to the user as a plain, honest chat
  reply ("this report doesn't contain a table to export as CSV/Excel"),
  same honest-degradation pattern `buildImageUnavailableNote`/extraction
  failures already establish elsewhere in this codebase — never a raw
  stack trace, never a silently-empty file.
- **Success:** unchanged from today's "Saved to your Documents [Download]"
  card, just with the correct file extension/mime type and real binary
  content for the chosen format.

## Validation

- `format` must be one of the 6-value enum (item 8) — an unrecognized
  value is a clean `ArtifactValidationError`/`AiToolValidationError`
  (existing error-class conventions), never silently defaulted.
- csv/xlsx conversion requires at least one markdown pipe-table in the
  content (resolved product decision — see the answered
  clarifying-question: "Only when a real table exists," not AI-forced
  restructuring, not blanket-unsupported).
- Every ownership check reuses `resolveOwnArtifact` — a cross-tenant or
  not-owned `artifact_id` fails exactly like every other artifact
  operation already does (`ArtifactNotFoundError`/`ArtifactForbiddenError`).

## Edge cases

- Artifact already published, user asks for a 3rd/4th format later →
  `exportArtifactAs` handles any number of repeats; each is a new,
  independent document (no cap in this spec — matches the existing
  `MAX_CHAT_ATTACHMENTS`-style ceiling only if abuse is observed in
  practice, not pre-emptively added here).
- Very large markdown content (e.g. many tables) for docx/pdf conversion —
  reuses the same character-budget reasoning already established
  elsewhere (`aiService.js`'s `allocateAttachmentBudget`) is NOT needed
  here since this converts already-generated, already-bounded AI output,
  not an arbitrary uploaded file — no new budget logic required.
- Multiple markdown tables in one report, csv/xlsx requested → v1 exports
  only the first table found (documented behavior, not silently
  ambiguous); exporting every table as separate sheets/files is
  `RELATED / FUTURE` (see OUT OF SCOPE).
- `list_own_artifacts` returning many results (a long-time user) → same
  "most recent first, reasonably bounded" pattern other list tools in
  `aiToolRegistry.js` already use; exact limit decided at implementation
  time from that existing precedent, not a new pattern.

## Testing requirements

- Unit tests for the new converter module: each format produces valid,
  non-empty bytes with the correct mime type; csv/xlsx with no table
  throws the documented error; csv/xlsx with a table produces correct
  row/column data; markdown format is byte-identical passthrough (no
  regression).
- `ArtifactService.publishArtifact`: existing tests continue to pass
  unmodified (format omitted → markdown, unchanged); new test for
  `format: 'docx'` (and at least one other) producing the right
  fileName/mimeType passed to `documentService.uploadPersonalDocument`
  (mocked).
- `ArtifactService.exportArtifactAs`: works on both draft and published
  artifacts; creates a document without mutating the artifact's own
  `status`/`publishedDocumentId`; ownership-rejects a non-owned id.
- AI tool registry tests (matching `ai-service.test.js`'s existing
  Policy Gate test pattern): `generate_document`/`export_artifact` accept
  `format`; `export_artifact_as`/`list_own_artifacts` role/ownership
  checks, same shape as sibling tool tests already in that file.
- No frontend test changes required beyond the existing
  `ArtifactEditor`-adjacent coverage pattern (behavior-level, per
  `frontend/src/api/academicYears.test.js`'s established convention) for
  the new format-choice control existing and calling `publish`/`export`
  with the selected format.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| AI image generation ("generate an image of X") | `FUTURE` — needs a separate Product Reasoning pass | No image-gen provider/SDK wired in anywhere in this codebase today; requires a provider + cost/quota decision the user has explicitly deferred. |
| AI presentation/slide (PPT) generation | **Built** (amendment above) — `pptx` added to the format enum, `markdownPptxGenerator.js` | Was deferred at first pass; brought into scope same-day once the "needs a provider/cost decision" reasoning (which applied to image-gen, not pptxgenjs) was found not to apply. |
| Slide content restructuring beyond one-slide-per-H1/H2, bullet-per-line | `RELATED / FUTURE` | v1 is a mechanical prose→slide mapping, not a second AI call to re-summarize/re-pace content for presentation delivery. |
| Exporting every table in a multi-table report as separate csv/xlsx sheets or files | `RELATED / FUTURE` | v1 exports only the first table found; documented limitation, not silently ambiguous. |
| Client-side graying-out of csv/xlsx options when content has no table | `RELATED / FUTURE` | v1 always offers all 6 formats in the UI control and surfaces the backend's validation error honestly if the choice doesn't apply — no new client-side content-sniffing logic this round. |
| A general "convert any existing Document (not AI-authored) to another format" capability | `EXISTING CAPABILITY / RELATED / UNWIRED` (partial) — the converter itself is format-general, but this spec only wires it for `ArtifactService`-owned markdown content, per CLAUDE.md rule 2's boundary | A real uploaded institutional PDF, for example, is not markdown and is out of this converter's input contract entirely — not requested, not built. |
| Changing `publishArtifact`'s "terminal, one-shot" rule itself (ADR-009 Amendment 1) | Not modified | `exportArtifactAs` is additive (extra documents), not a repeal of the existing one-canonical-publish rule. |
