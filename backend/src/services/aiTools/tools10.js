'use strict';

// Tool definitions batch 10 of aiToolRegistry.js's split — see
// services/aiTools/engine.js's own header comment for the full split.
// Registers each tool with the engine purely for side effect at module
// load time; require()d (never re-exported) by the aiToolRegistry.js
// barrel alongside every other services/aiTools/tools*.js batch.

const { registerTool } = require('./engine');
const artifactService = require('../artifactService');
const imageGenerationService = require('../imageGenerationService');
const academicService = require('../academicService');
const staffService = require('../staffService');
const studentService = require('../studentService');
const assessmentService = require('../assessmentService');
const EXPORT_FORMAT_PARAM = {
  type: 'string',
  enum: ['markdown', 'docx', 'pdf', 'txt', 'csv', 'xlsx', 'pptx'],
  description:
    'Output file format. Defaults to markdown if omitted. csv/xlsx only work when the content actually ' +
    'contains a table — if it does not, this fails with a clear message rather than producing an empty file; tell ' +
    'the user plainly and suggest docx/pdf/txt/pptx instead of retrying the same format. pptx turns the content ' +
    'into a real slide deck (one slide per major heading) — use it for requests like "make this a presentation" ' +
    'or "N slides on X".',
};

registerTool({
  name: 'export_artifact',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Publishes the artifact currently open in this workspace (see the "Context:" line naming its id) ' +
    'into the acting user\'s own Documents, as a downloadable file — the actual answer to a request like "export ' +
    'this as a document/PDF/Word/docx file" or "save this." Pass `format` when the user names one (e.g. "as a ' +
    'docx", "as PDF") — defaults to markdown otherwise. Only works on an artifact the acting user owns, and only ' +
    'once — an already-published artifact cannot be published again; use export_artifact_as for a second format.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      artifact_id: {
        type: 'string',
        format: 'uuid',
        description:
          'The exact internal id of the artifact currently open, from this conversation\'s own "Context:" line — never guess or invent one.',
      },
      format: EXPORT_FORMAT_PARAM,
    },
    required: ['artifact_id'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    artifactService.publishArtifact(client, params.artifact_id, {
      userId: actor.userId,
      collegeId: actor.collegeId,
      format: params.format,
    }),
});

// The retroactive "now give me that AS docx too" tool — the live-caught
// gap this round: a user who already got a report as markdown, then asked
// for docx afterward, had no tool that could answer without re-publishing
// (impossible — publish is terminal) or losing the artifact's identity.
// Unlike export_artifact above, this does NOT require the artifact to be
// the one currently open — artifact_id can come from list_own_artifacts
// (below) when the model needs to resolve "that report from earlier" by
// title/recency across turns.
registerTool({
  name: 'export_artifact_as',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Creates a NEW downloadable document from an existing artifact in a different format than it was ' +
    'already saved as — the answer to a follow-up like "now give me that as docx" or "I need it as PDF too," ' +
    'asked after the artifact was already published (or even while still a draft). Works any number of times; ' +
    "each call adds a new document, never replaces or deletes what's already there. Requires the real " +
    'artifact_id — if it is not already known from this conversation\'s own "Context:" line, call ' +
    'list_own_artifacts first to resolve it by title, never guess one.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      artifact_id: {
        type: 'string',
        format: 'uuid',
        description:
          'The exact internal id of the artifact to export, from the "Context:" line or from list_own_artifacts — never guess or invent one.',
      },
      format: EXPORT_FORMAT_PARAM,
    },
    required: ['artifact_id', 'format'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    artifactService.exportArtifactAs(client, params.artifact_id, params.format, {
      userId: actor.userId,
      collegeId: actor.collegeId,
    }),
});

// A thin, read-only wrap of the existing ArtifactService.listOwnArtifacts
// — no new business logic. Exists specifically so export_artifact_as
// (above) can resolve an artifact created in an earlier turn (e.g. by
// generate_document below) by title/recency, the same way the model would
// look up any other entity it doesn't already have an id for — never a
// reason to invent/guess an id.
registerTool({
  name: 'list_own_artifacts',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Lists the acting user's own AI artifacts (documents/reports the AI has created or saved for them), " +
    'most recent first, with each one\'s id/title/status — use this to resolve "that report from earlier" or ' +
    '"the ECE comparison" to a real artifact_id before calling export_artifact_as, never guess or invent one.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  handler: (client, params, actor) => artifactService.listOwnArtifacts(client, { userId: actor.userId, limit: 20 }),
});

// A live-caught gap one layer up from export_artifact: a user asked "give
// this as word document" from an ORDINARY chat (no artifact open at all —
// focusContext is only ever sent for scope 'artifact', WorkspaceProvider.jsx's
// own sendMessage), so export_artifact had no artifact_id to work with and
// the model correctly said it couldn't export anything — genuinely true for
// it specifically, but the underlying capability (documentService.
// uploadPersonalDocument) it would have used is the exact same one
// export_artifact already calls indirectly (via artifactService.
// publishArtifact); there was simply no tool exposing it outside an
// artifact. This is that same mechanism, without requiring an artifact to
// already exist — the actual answer whenever an ordinary chat gets asked to
// save/export/download something as a document/PDF/Word file.
//
// Now creates a real Artifact first (createArtifact + publishArtifact),
// instead of calling documentService.uploadPersonalDocument directly —
// closes a pre-existing CLAUDE.md rule 2 gap (AI-generated structured
// content must be ArtifactService-owned, not written to DocumentService
// as a bare file) as a side effect, and is what makes a report created
// this way re-exportable in another format later via export_artifact_as
// (a bare, artifact-less document has no such path — list_own_artifacts
// wouldn't even find it). Same external behavior otherwise: still lands
// in the acting user's Documents, "AI Artifacts" folder.
registerTool({
  name: 'generate_document',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Saves markdown content as a real, downloadable document in the acting user's own Documents — " +
    'the actual mechanism behind a request like "give me this as a document/Word file/PDF/Excel/spreadsheet/' +
    'CSV/download" made in an ordinary chat. This IS the right tool for "convert this into Excel/CSV" whenever ' +
    'the data itself is already fully known — already extracted from an attachment, already computed earlier ' +
    'in this conversation, or simply given by the user — and needs no new calculation: pass `format: "xlsx"` ' +
    'or `format: "csv"` with the data written as a markdown table in `content`, and it converts straight to a ' +
    'real workbook, no code and no formula-verification step to fail. Reach for execute_code instead only when ' +
    'the file itself must contain a LIVE formula (e.g. a total that should recalculate if the source numbers ' +
    'change) — see that tool\'s own description. Pass `format` when the user names one (e.g. "as a docx ' +
    'report", "as a PDF", "as Excel") — defaults to markdown otherwise. Use what was already discussed in this ' +
    'conversation as the content when the user is asking to save something already written, rather than ' +
    're-asking them to restate it.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short, descriptive title for the document.' },
      content: { type: 'string', description: 'The full document content, in markdown.' },
      format: EXPORT_FORMAT_PARAM,
    },
    required: ['title', 'content'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const artifact = await artifactService.createArtifact(
      client,
      { title: params.title, content: params.content },
      { userId: actor.userId, collegeId: actor.collegeId },
    );
    return artifactService.publishArtifact(client, artifact.id, {
      userId: actor.userId,
      collegeId: actor.collegeId,
      format: params.format,
    });
  },
});

// Image generation (RS-AIG-025) — thin wrapper over imageGenerationService,
// the same one-Business-Service-method-per-tool shape every other tool
// in this file follows. Registered L2 (Generate) per RS-AIG-001's own
// table — an artifact-producing tool with no effect reaching outside the
// system, same class as generate_document above. (generate_document
// itself is registered L1 in this file — a pre-existing discrepancy
// against RS-AIG-001's table this pass does not resolve, the same class
// of finding round 20's "AI capability reconciliation" flagged once
// already for a different tool, not silently copied here.) Off by
// default per college — imageGenerationService.generateImage itself
// throws ImageGenerationNotEnabledError at call time, mirroring
// fetch_trusted_web_page's own real precedent (verified against that
// registration, not assumed): the tool stays listed, the Business
// Service is the actual gate.
registerTool({
  name: 'generate_image',
  level: 'L2',
  dataClassification: 'Internal',
  description:
    'Generates an image from a text prompt and saves it as a real, downloadable file in the acting ' +
    "user's own Documents. Only available if this college has opted into image generation and the configured " +
    'AI provider supports it — if not, say so plainly rather than pretending an image was created.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'A clear description of the image to generate.' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    imageGenerationService.generateImage(
      client,
      { prompt: params.prompt },
      { collegeId: actor.collegeId, actorUserId: actor.userId },
    ),
});

registerTool({
  name: 'substitute_duties_list',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Lists every substitute-teaching assignment where the acting user IS the substitute, across every ' +
    'class, with acknowledgement status.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) =>
    academicService.listMySubstituteAssignments(client, { substituteStaffUserId: actor.userId }),
});

registerTool({
  name: 'substitute_duty_acknowledge',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Acknowledges a substitute-teaching assignment — same-actor direct write, identical to pressing ' +
    'Acknowledge on the dashboard. Only the named substitute may acknowledge their own assignment.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      assignment_id: {
        type: 'string',
        format: 'uuid',
        description:
          'The substitute assignment id to acknowledge. Must be the exact internal id, e.g. from substitute_duties_list — never guess one.',
      },
    },
    required: ['assignment_id'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    academicService.acknowledgeSubstituteAssignment(client, params.assignment_id, {
      actorUserId: actor.userId,
      collegeId: actor.collegeId,
    }),
});

registerTool({
  name: 'staff_self_profile_get',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Reads the acting user's own staff profile.",
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => staffService.getOwnProfile(client, { userId: actor.userId }),
});

registerTool({
  name: 'staff_self_profile_update',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Updates the acting user's own self-service profile fields only (phone, address, emergency " +
    'contact) — same-actor direct write, identical to the My Profile screen. Administrative fields ' +
    '(designation, qualification, bank/PF, etc.) are principal-only and NOT reachable through this tool — use ' +
    'staff_update_profile for those, as a principal.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Optional new phone number.' },
      address: { type: 'string', description: 'Optional new address.' },
      emergency_contact_name: { type: 'string', description: 'Optional emergency contact name.' },
      emergency_contact_phone: { type: 'string', description: 'Optional emergency contact phone.' },
      emergency_contact_relation: { type: 'string', description: 'Optional emergency contact relation.' },
    },
    required: [],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    staffService.updateOwnProfile(
      client,
      {
        phone: params.phone,
        address: params.address,
        emergencyContactName: params.emergency_contact_name,
        emergencyContactPhone: params.emergency_contact_phone,
        emergencyContactRelation: params.emergency_contact_relation,
      },
      { userId: actor.userId },
    ),
});

// --- 2026-07-26 UAT wiring, second pass: student flag (a manual
// watchlist marker with a required remark) — same ownership boundary
// as students_update_profile above (assertCanModifyStudent: the
// class's own L4, HOD's own department, or Principal college-wide),
// not a same-actor-only tool the way the personal-workspace tools are.

registerTool({
  name: 'students_flag',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Raises a manual flag on a student within the acting user's own scope, with a required remark " +
    "(e.g. a behavioral or attendance concern). Fails if the student is not in the acting user's scope.",
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      student_id: {
        type: 'string',
        description: "The student id, or the student's roll number, resolved to an id internally.",
      },
      remark: { type: 'string', description: 'Required reason for the flag.' },
    },
    required: ['student_id', 'remark'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    return studentService.flagStudent(
      client,
      studentId,
      { remark: params.remark },
      { actorUserId: actor.userId, actorRole: actor.role },
    );
  },
});

registerTool({
  name: 'students_flag_clear',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Clears the active flag on a student within the acting user's own scope. Fails if the student has " +
    "no active flag, or is not in the acting user's scope.",
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      student_id: {
        type: 'string',
        description: "The student id, or the student's roll number, resolved to an id internally.",
      },
    },
    required: ['student_id'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const studentId = await studentService.resolveStudentId(client, actor.collegeId, params.student_id);
    return studentService.clearStudentFlag(client, studentId, { actorUserId: actor.userId, actorRole: actor.role });
  },
});

// Capability Coverage Audit finding (cross-role #2): no AI tool
// existed for reports/exports at all, for any role — reports.generate/
// reports.student_export were GUI-only. Four thin wrappers, one per
// existing Business Service call (no dispatcher — see this file's own
// governing-principle comment further up), matching reportService's
// own four report types and routes/reports.js's own permission split
// (student-export has its own wider permission key; the other three
// share reports.generate, principal-only).
const reportService = require('../reportService');

registerTool({
  name: 'reports_student_export',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Generates a student export report (CSV/Excel) scoped to the acting user's own visible students " +
    '(own class as tutor, own department as HOD, or college-wide as principal) — the same action as the ' +
    'Reports → Student Export screen. Returns the generated_reports row; the file itself is stored as a ' +
    'document.',
  allowedRoles: ['principal', 'hod', 'staff'],
  params: {
    type: 'object',
    properties: {
      format: { type: 'string', description: "'csv' or 'xlsx'. Defaults to 'csv'." },
      student_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional — restrict the export to these specific student ids. Omit to export every visible student.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    reportService.generateStudentExportReport(
      client,
      { collegeId: actor.collegeId, format: params.format, studentIds: params.student_ids },
      { actorUserId: actor.userId, actorRole: actor.role },
    ),
});

registerTool({
  name: 'reports_generate_attendance',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Generates a college-wide attendance report (CSV/Excel) — the same action as the Reports → ' +
    'Attendance screen. Principal only.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      format: { type: 'string', description: "'csv' or 'xlsx'. Defaults to 'csv'." },
    },
    required: [],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    reportService.generateAttendanceReport(
      client,
      { collegeId: actor.collegeId, format: params.format },
      { actorUserId: actor.userId },
    ),
});

registerTool({
  name: 'reports_generate_finance',
  level: 'L1',
  dataClassification: 'Restricted',
  description:
    'Generates a college-wide finance report (CSV/Excel) — the same action as the Reports → Finance ' +
    'screen. Principal only — fee data is Restricted, and only the principal role has AI access to Restricted ' +
    'data.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      format: { type: 'string', description: "'csv' or 'xlsx'. Defaults to 'csv'." },
    },
    required: [],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    reportService.generateFinanceReport(
      client,
      { collegeId: actor.collegeId, format: params.format },
      { actorUserId: actor.userId },
    ),
});

registerTool({
  name: 'reports_generate_assessment_marks',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Generates an assessment marks report (CSV/Excel), optionally filtered by academic year/department/' +
    'class/subject/assessment type — the same action as the Reports → Assessment Marks screen. Principal only.',
  allowedRoles: ['principal'],
  params: {
    type: 'object',
    properties: {
      format: { type: 'string', description: "'csv' or 'xlsx'. Defaults to 'csv'." },
      academic_year: { type: 'string', description: "Optional academic year filter, e.g. '2025-2026'." },
      department_id: { type: 'string', description: 'Optional department id filter.' },
      class_id: { type: 'string', description: 'Optional class id, or class name, resolved to an id internally.' },
      subject: { type: 'string', description: 'Optional subject filter.' },
      assessment_type_id: {
        type: 'string',
        description: 'Optional assessment type id, or its name, resolved to an id internally.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const [classId, assessmentTypeId] = await Promise.all([
      params.class_id ? academicService.resolveClassId(client, actor.collegeId, params.class_id) : null,
      params.assessment_type_id
        ? assessmentService.resolveAssessmentTypeId(client, actor.collegeId, params.assessment_type_id)
        : null,
    ]);
    return reportService.generateAssessmentMarksReport(
      client,
      {
        collegeId: actor.collegeId,
        format: params.format,
        filters: {
          academicYear: params.academic_year,
          departmentId: params.department_id,
          classId,
          subject: params.subject,
          assessmentTypeId,
        },
      },
      { actorUserId: actor.userId },
    );
  },
});
