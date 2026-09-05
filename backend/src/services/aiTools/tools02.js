'use strict';

// Tool definitions batch 2 of aiToolRegistry.js's split — see
// services/aiTools/engine.js's own header comment for the full split.
// Registers each tool with the engine purely for side effect at module
// load time; require()d (never re-exported) by the aiToolRegistry.js
// barrel alongside every other services/aiTools/tools*.js batch.

const { registerTool } = require('./engine');
const collegeProfileService = require('../collegeProfileService');
const documentSearchService = require('../documentSearchService');
// --- Institutional Documents Phase 2 — AI-assisted upload/retrieval ----
// "Save this in ECE Circulars" (product proposal's own example) needs
// two separate tools, not one, so that a write can never happen inside
// the same autonomous LLM turn that merely proposed it:
//
//   1. resolve_document_destination (L1, read-only) — the LLM may call
//      this freely; it only looks up whether a category/department/
//      academic-year NAME the user mentioned resolves to a real row,
//      never writes anything. A miss on any field comes back as a
//      clear per-field error the LLM can relay back to the user
//      ("ask for clarification only if necessary" — the product
//      proposal's own requirement), never a guess.
//   2. upload_institutional_document (L2, the real write) — marked
//      humanOnly: true (see aiToolRegistry.listTools's own comment),
//      so aiService.askAgent's LLM function-calling list never
//      includes it; the LLM cannot call it in the same turn as #1,
//      autonomously, no matter what the user's message said. The only
//      caller that ever reaches it is the frontend's own explicit
//      "Confirm & Upload" button — a real human click, made only
//      after #1's resolved destination has already been shown —
//      calling POST /ai/tools/upload_institutional_document/invoke
//      directly (useToolInvoke, the same mechanism the slash-command
//      tool palette already uses for any other tool). This is the
//      "confirmation before AI performs writes" requirement, met
//      without needing WorkflowService/L3 — same reasoning
//      draft_notification (L2, a real write, no approval needed to
//      draft) already establishes for "a write that doesn't need a
//      second human's approval, only the same human's own confirm."
const documentService = require('../documentService');
const documentCategoryService = require('../documentCategoryService');
const academicYearService = require('../academicYearService');

async function resolveOptionalField(resolver, value) {
  if (!value) {
    return { value: null, error: null };
  }
  try {
    const id = await resolver(value);
    return { value: { id, name: value }, error: null };
  } catch (err) {
    return { value: null, error: err.message };
  }
}

registerTool({
  name: 'resolve_document_destination',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Looks up whether a category, department, and/or academic year name the user mentioned (e.g. ' +
    '"ECE", "Circulars", "2026-2027") match real Institutional Documents data for this college. Read-only — ' +
    'never uploads or moves anything. Always call this BEFORE telling the user their document was saved ' +
    'somewhere, and relay any "not found" field back to the user as a clarifying question rather than guessing. ' +
    'Call this when the user names an actual document destination while talking about saving/uploading/filing a ' +
    'document — "save this under Circulars" names a category, "put it in the ECE folder" names a department ' +
    '(NOT a category, even though the word "folder" is used), "file this for 2026-2027" names an academic year. ' +
    'Only pass the fields the user actually named; never invent a category, department, or year to fill a param ' +
    "the user did not mention, and never put a value in the wrong field — see each parameter's own description " +
    'below for which kind of name belongs in it. Do NOT call this tool with every parameter empty: if the user is ' +
    'only asking to upload/save/file a document and has not named ANY category, department, or year yet, skip ' +
    'this tool entirely and ask them which category it belongs to first — an empty call wastes a round trip ' +
    'this tool cannot answer anyway.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description:
          'Document category (a folder-like grouping, e.g. "Circulars", "Curriculum", "Policies", ' +
          '"Notices") the user mentioned. This is NEVER a department/branch name — "ECE", "CSE", "Mechanical" and ' +
          'similar branch names always belong in the department parameter below, not here, even if the user said ' +
          '"folder" or "put it in ECE".',
      },
      department: {
        type: 'string',
        description:
          'Department or branch name the user mentioned, e.g. "ECE", "CSE", "Mechanical". Omit if the ' +
          'user did not name one (college-wide). This is NEVER a document category — "Circulars", "Curriculum" ' +
          'and similar category names always belong in the category parameter above, not here.',
      },
      academic_year: {
        type: 'string',
        description:
          'Academic year label the user mentioned, e.g. "2026-2027". Omit if the user did not name one (defaults to the current Active year).',
      },
    },
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const [category, department, academicYear] = await Promise.all([
      resolveOptionalField(
        (v) => documentCategoryService.resolveCategoryId(client, actor.collegeId, v),
        params.category,
      ),
      resolveOptionalField(
        (v) => collegeProfileService.resolveDepartmentId(client, actor.collegeId, v),
        params.department,
      ),
      resolveOptionalField(
        (v) => academicYearService.resolveAcademicYearId(client, actor.collegeId, v),
        params.academic_year,
      ),
    ]);
    return {
      category: category.value,
      categoryError: category.error,
      department: department.value,
      departmentError: department.error,
      academicYear: academicYear.value,
      academicYearError: academicYear.error,
    };
  },
});

registerTool({
  name: 'upload_institutional_document',
  level: 'L2',
  dataClassification: 'Internal',
  humanOnly: true,
  description:
    "Uploads a document into the college's Institutional Documents repository under the given " +
    'category (required) and optional department/academic year. Never called by the AI on its own — only ' +
    "reachable via the user's own explicit confirm action in the chat UI, after resolve_document_destination " +
    'has already shown them where it will be saved.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short human-readable title for the document.' },
      category: {
        type: 'string',
        description: 'The category id or name (already resolved via resolve_document_destination).',
      },
      department: { type: 'string', description: 'The department id or name, if any.' },
      academic_year: { type: 'string', description: 'The academic year id or label, if any.' },
      file_name: { type: 'string', description: 'The original file name.' },
      mime_type: { type: 'string', description: 'The file MIME type.' },
      file_base64: { type: 'string', description: 'The raw file bytes, base64-encoded.' },
    },
    required: ['title', 'category', 'file_name', 'mime_type', 'file_base64'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const [categoryId, departmentId, academicYearId] = await Promise.all([
      documentCategoryService.resolveCategoryId(client, actor.collegeId, params.category),
      params.department ? collegeProfileService.resolveDepartmentId(client, actor.collegeId, params.department) : null,
      params.academic_year
        ? academicYearService.resolveAcademicYearId(client, actor.collegeId, params.academic_year)
        : null,
    ]);
    const document = await documentService.uploadInstitutionalDocument(
      client,
      {
        collegeId: actor.collegeId,
        title: params.title,
        categoryId,
        departmentId,
        academicYearId,
        fileName: params.file_name,
        mimeType: params.mime_type,
        fileBuffer: Buffer.from(params.file_base64, 'base64'),
      },
      { actorUserId: actor.userId },
    );
    // Best-effort: makes the freshly-uploaded document immediately
    // findable via search_documents/list_institutional_documents-style
    // AI retrieval, matching the product proposal's "AI should
    // retrieve/summarize" goal. Never fails the upload itself — an
    // unsupported mime_type (docx/xlsx/pptx: documentSearchService's
    // own documented limitation, not new here) just means this
    // document isn't semantically searchable yet, same as any other
    // document uploaded outside the AI flow today.
    try {
      await documentSearchService.ingestDocument(client, document.id, { actorUserId: actor.userId });
    } catch {
      // swallow — see comment above.
    }
    return document;
  },
});

registerTool({
  name: 'list_institutional_documents',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Lists Institutional Documents (Curriculum, Circulars, Academic Calendar, Examination, Policies, ' +
    'Forms, Notices) matching an optional category/department/academic-year/search filter — the AI-facing ' +
    'equivalent of browsing the Institutional Documents page with filters set. Most recent first, so "the ' +
    'latest examination timetable" is simply the first row of a category="Examination" call. If a named ' +
    'category/department/academic_year does not match anything real for this college, this returns an empty ' +
    'list rather than erroring — say plainly that nothing matched (and which filter looks off) rather than ' +
    'assuming an empty result means no institutional documents exist at all.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Category id or name to filter by, e.g. "Circulars".' },
      department: { type: 'string', description: 'Department id or name to filter by, e.g. "ECE".' },
      academic_year: { type: 'string', description: 'Academic year id or label to filter by, e.g. "2026-2027".' },
      search: { type: 'string', description: 'Free-text search against the document title/file name.' },
    },
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    // P4 3.4 — this tool used to resolve category/department/academic_year
    // with a bare `Promise.all` over resolver calls that reject on a name
    // that doesn't exist (e.g. a guessed or slightly-off category), which
    // crashed this tool's own invocation — and with it the whole agent
    // turn — instead of giving the model something it could relay ("no
    // such category"). Its own sibling tool, resolve_document_destination
    // above, already got this right (resolveOptionalField: never throws,
    // returns { value, error } per field); caught live via
    // scripts/ai-behavioral-suite.js category M ("no document category
    // found named \"Circulars\"" surfacing as `answer: null`, no answer
    // at all, instead of a graceful "nothing matched").
    //
    // Deliberately still returns a bare array on every path (never an
    // { documents, ... } wrapper) — aiExperience/sectionBuilder.js's
    // table/chart rendering keys off `Array.isArray(data)` for every
    // tool's result generically; wrapping this one tool's result in an
    // object would silently turn its rendered table into a raw
    // key-value dump. An unresolved filter degrades to the same empty
    // array `search`/filters matching nothing real already produces —
    // the model still knows which named field it guessed from the
    // params it itself supplied, and the tool's own description says to
    // name it, so nothing forces re-deriving that from the result shape.
    const [category, department, academicYear] = await Promise.all([
      resolveOptionalField(
        (v) => documentCategoryService.resolveCategoryId(client, actor.collegeId, v),
        params.category,
      ),
      resolveOptionalField(
        (v) => collegeProfileService.resolveDepartmentId(client, actor.collegeId, v),
        params.department,
      ),
      resolveOptionalField(
        (v) => academicYearService.resolveAcademicYearId(client, actor.collegeId, v),
        params.academic_year,
      ),
    ]);
    if (category.error || department.error || academicYear.error) {
      return [];
    }
    // limit: this tool's own description already frames its ordering
    // as "most recent first" — capping it here matches that stated
    // semantic rather than truncating something the tool promises to
    // return in full. The human-facing GET /documents/institutional
    // browse route is untouched.
    return documentService.listInstitutionalDocuments(
      client,
      {
        categoryId: category.value?.id,
        departmentId: department.value?.id,
        academicYearId: academicYear.value?.id,
        search: params.search,
        limit: 200,
      },
      { actorRole: actor.role },
    );
  },
});

// --- Institutional Documents Phase 3 — read-only lookups ---------------
// Both L1/read-only, same reasoning search_documents/
// list_institutional_documents above already establish: nothing here
// writes, so neither needs humanOnly — the LLM may call these freely
// to answer "what changed between versions" / "what's this year's
// version of X" questions. Publish/supersede/archive themselves are
// NOT exposed as AI tools at all: CLAUDE.md rule 3 requires those to
// go through WorkflowService's human approval gate exactly like every
// other Level 3 (Act) action, and this codebase's existing pattern
// (upload_institutional_document above) is "the real write only ever
// reaches the human's own Confirm button, never the LLM's own
// function-calling list" — the same discipline applies here without
// inventing a new mechanism: publishing/superseding stay
// UI-only actions (routes/documents.js's own
// /publish//supersede/archive endpoints), reachable by a human via the
// Institutional Documents page, never via ARCNAVE AI.
registerTool({
  name: 'get_document_version_history',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Lists every version of a logical Institutional Document (same document_group_id), newest first — ' +
    'use after list_institutional_documents/search_documents has already resolved a document id.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      document_id: {
        type: 'string',
        description: 'Any document id belonging to the version group (e.g. from list_institutional_documents).',
      },
    },
    required: ['document_id'],
    additionalProperties: false,
  },
  handler: async (client, params) => {
    const document = await documentService.getDocument(client, params.document_id);
    if (document === null) {
      return [];
    }
    return documentService.getVersionHistory(client, document.document_group_id);
  },
});

registerTool({
  name: 'get_document_lineage',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Returns the cross-year lineage of an Institutional Document — its ancestor(s) in earlier academic ' +
    'years and its successor(s) in later years, e.g. "what is the 2025-2026 version of the 2024-2025 Curriculum?"',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'The document id to resolve lineage for.' },
    },
    required: ['document_id'],
    additionalProperties: false,
  },
  handler: (client, params) => documentService.getDocumentLineage(client, params.document_id),
});

// ADL-065 (2026-08-30): analyze_document_table (ADR-029 slice 1) is
// retired — the owner's decision, made after this file's own evidence
// (ADL-055/ADL-058 addendum) was surfaced showing native Gemini reading
// cannot count reliably (2 vs 23, 7 vs 839, 16 vs 1603, measured) and
// produced 3 different wrong live answers before this tool existed. The
// owner chose to accept that risk and rely on native document reading
// instead. documentAnalysisService.js/documentAggregateService.js/
// documentTableExtractionService.js/documentRowIntegrityService.js are
// UNCHANGED and still exist (deterministic, tested, reusable if this
// decision is revisited) — only the AI-facing tool registration is
// removed, so the model can no longer call it. See ADL-065 for the full
// record.
