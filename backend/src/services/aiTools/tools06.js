'use strict';

// Tool definitions batch 6 of aiToolRegistry.js's split — see
// services/aiTools/engine.js's own header comment for the full split.
// Registers each tool with the engine purely for side effect at module
// load time; require()d (never re-exported) by the aiToolRegistry.js
// barrel alongside every other services/aiTools/tools*.js batch.

const { registerTool } = require('./engine');
const academicService = require('../academicService');
const { AiToolInvalidParamsError } = require('./engine');
// --- 2026-07-26 UAT wiring: "ArcNave AI can do everything the currently
// authenticated account is authorized to do via the GUI — nothing more,
// nothing less — invoked only by an explicit user prompt, never
// automatically." Product principle, not a new gating mechanism: every
// tool below still goes through the same four gates (level, role,
// classification, scope) as every tool above it, and every direct-write
// tool here is a same-actor carve-out (RS-AIG-007/P4) on an action that
// was already a single, un-approved click for that actor on the
// dashboard — acknowledging a substitute duty, writing your own class
// log, your own note, your own preference, your own self-service
// profile field. None of these tools grant the AI anything the human
// could not already do unassisted, and none of them fire without the
// user typing a request first (the same "no autonomous invocation"
// property every other tool in this file already has).
//
// RS-PRF-001 previously read "AI: Prohibited... including the note's
// own owner acting through AI" — written before this principle was
// articulated, on the premise that AI touching personal notes was
// inherently a privacy risk. It is not: the AI acts as the same user
// who already owns the note, never on anyone else's behalf
// (personalNoteService enforces this identically for the AI path and
// the human path). That rule text is corrected alongside this wiring.

const classLogService = require('../classLogService');
const personalNoteService = require('../personalNoteService');
const userPreferenceService = require('../userPreferenceService');
const aiMemoryService = require('../aiMemoryService');
const activityTimelineService = require('../activityTimelineService');
const projectService = require('../projectService');

registerTool({
  name: 'class_log_list',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Lists the acting user's own teaching-journal entries (topic taught, per class/date/subject), " +
    'optionally filtered to one class. With no class named, returns entries across every class the acting user ' +
    'may see.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      class_id: {
        type: 'string',
        description:
          'Optional class id or class name, resolved to an id internally. Omit to search across every class the acting user may see.',
      },
      subject: { type: 'string', description: 'Optional subject name to filter by.' },
      from_date: { type: 'string', description: 'Optional ISO date, inclusive lower bound on session date.' },
      to_date: { type: 'string', description: 'Optional ISO date, inclusive upper bound on session date.' },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = params.class_id
      ? await academicService.resolveClassId(client, actor.collegeId, params.class_id)
      : undefined;
    // limit: caps this tool's own result at the most recent entries —
    // the query is already ORDER BY session_date DESC, so this is a
    // genuine "recent journal entries" view, not an arbitrary
    // truncation. The human-facing GET /class-logs route is untouched.
    return classLogService.listLogEntries(
      client,
      {
        classId,
        subject: params.subject,
        fromDate: params.from_date,
        toDate: params.to_date,
        limit: 200,
      },
      { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
    );
  },
});

registerTool({
  name: 'class_log_create',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Adds a teaching-journal entry (topic taught, optional notes) for a class the acting user may view ' +
    '— same-actor direct write, no different from typing it into the Class Log tab. Fails if the acting user ' +
    'cannot view the named class.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id or class name, resolved to an id internally.' },
      subject: { type: 'string', description: 'The subject taught in this session.' },
      session_date: { type: 'string', description: 'ISO date the session took place.' },
      topic: { type: 'string', description: 'The topic actually covered.' },
      notes: { type: 'string', description: 'Optional notes (e.g. homework assigned).' },
    },
    required: ['class_id', 'subject', 'session_date', 'topic'],
    additionalProperties: false,
  },
  handler: async (client, params, actor) => {
    const classId = await academicService.resolveClassId(client, actor.collegeId, params.class_id);
    return classLogService.createLogEntry(
      client,
      {
        classId,
        subject: params.subject,
        sessionDate: params.session_date,
        topic: params.topic,
        notes: params.notes,
      },
      { actorUserId: actor.userId, actorRole: actor.role, collegeId: actor.collegeId },
    );
  },
});

registerTool({
  name: 'personal_notes_list',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Lists the acting user's own private notes/reminders. Never any other user's — a personal note has " +
    'no institutional visibility for anyone, AI included.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => personalNoteService.listNotes(client, { actorUserId: actor.userId }),
});

registerTool({
  name: 'personal_notes_create',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Creates a private note/reminder for the acting user only — same-actor direct write, identical to ' +
    'using the Personal Notes panel themselves.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Optional short title.' },
      body: { type: 'string', description: 'The note content.' },
      reminder_at: { type: 'string', description: 'Optional ISO timestamp to remind at.' },
    },
    required: ['body'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    personalNoteService.createNote(
      client,
      { title: params.title, body: params.body, reminderAt: params.reminder_at },
      { actorUserId: actor.userId, collegeId: actor.collegeId },
    ),
});

// Step 6 (Approved Spec §12) AI-parity requirement — same-actor
// carve-out (RS-AIG-007/P4), no different from typing into the
// Project page's own Instructions field or document picker/remove
// button. Both scoped strictly to the acting user's own project
// (projectService's ownership check is the only authority here, same
// as every projects.js route).
registerTool({
  name: 'update_project_instructions',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Replaces the acting user's own project's custom instructions field — same-actor direct write, no " +
    "different from editing the Instructions field on that project's page. Fails if the acting user does not own " +
    'the named project.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        format: 'uuid',
        description:
          'The project id to update. Must be the exact internal id — from a project the user is currently chatting inside, or a prior list result. Never guess one.',
      },
      instructions: {
        type: 'string',
        description: 'The new instructions text, replacing the previous value entirely.',
      },
    },
    required: ['project_id', 'instructions'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    projectService.updateProject(
      client,
      params.project_id,
      { instructions: params.instructions },
      { userId: actor.userId },
    ),
});

registerTool({
  name: 'manage_project_document',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Attaches or detaches a document from the acting user's own project's reference context — " +
    "same-actor direct write, no different from that project page's document picker/remove button. Never " +
    'deletes the document itself, only the link. The document must already be one the acting user owns.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        format: 'uuid',
        description: 'The project id. Must be the exact internal id, never guessed.',
      },
      document_id: {
        type: 'string',
        format: 'uuid',
        description: 'The document id. Must be the exact internal id, never guessed.',
      },
      action: {
        type: 'string',
        enum: ['attach', 'detach'],
        description: "'attach' to add the document as context, 'detach' to remove it.",
      },
    },
    required: ['project_id', 'document_id', 'action'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    params.action === 'attach'
      ? projectService.attachProjectDocument(
          client,
          params.project_id,
          { documentId: params.document_id },
          { userId: actor.userId },
        )
      : projectService.detachProjectDocument(client, params.project_id, params.document_id, { userId: actor.userId }),
});

registerTool({
  name: 'activity_timeline_read',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Reads the acting user's own activity timeline (attendance marked, marks submitted, corrections " +
    'requested, admissions performed, and every other audited action they have taken). Self-only — never ' +
    "another account's timeline.",
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: 'Optional max rows to return.' },
    },
    required: [],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    activityTimelineService.getOwnActivity(client, { actorUserId: actor.userId, limit: params.limit }),
});

registerTool({
  name: 'user_preferences_list',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Lists the acting user's own stored preferences (saved filters, dashboard layout, notification " +
    'channel choices).',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => userPreferenceService.listPreferences(client, { actorUserId: actor.userId }),
});

// Scoped Preference Memory (P2.4, CHECKPOINT.md's Bucket B design) —
// this is the ONE place natural language reaches userPreferenceService,
// so it's the one place the "never freeform facts about a person"
// safety rule has to actually be enforced, not just described. The
// underlying service/table stays genuinely general-purpose (any key,
// any value) for its real intended consumer — a future human-driven
// settings UI hitting routes/userPreferences.js directly, a completely
// separate code path this restriction never touches — because an
// unconstrained key space is fine when a person is choosing it, and
// only becomes a risk when an LLM's own judgment picks the key from
// open conversation. AI_ALLOWED_PREFERENCE_KEYS is enforced in the
// handler itself, not just declared in the JSON schema: aiToolRegistry's
// own assertParamsValid (see its file comment) only checks
// required/array-shape, never `enum`, so a schema-only restriction
// would be a prompt hint an LLM could still be talked past, not a real
// gate.
const AI_ALLOWED_PREFERENCE_KEYS = ['report_format', 'default_chart', 'language'];

registerTool({
  name: 'user_preferences_set',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Sets one of the acting user's own AI-response preferences — same-actor direct write. Only " +
    `${AI_ALLOWED_PREFERENCE_KEYS.join(', ')} may be set through this tool, never a freeform key: this is for ` +
    'how the user wants answers presented, never a place to remember facts, notes, or opinions about a ' +
    'student, staff member, or anyone else.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      preference_key: { type: 'string', enum: AI_ALLOWED_PREFERENCE_KEYS, description: 'The preference name.' },
      value: { type: 'string', description: 'The value to store.' },
    },
    required: ['preference_key', 'value'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => {
    if (!AI_ALLOWED_PREFERENCE_KEYS.includes(params.preference_key)) {
      throw new AiToolInvalidParamsError(
        `preference_key must be one of ${AI_ALLOWED_PREFERENCE_KEYS.map((k) => JSON.stringify(k)).join(', ')}, ` +
          `got ${JSON.stringify(params.preference_key)}`,
      );
    }
    return userPreferenceService.setPreference(client, params.preference_key, params.value, {
      actorUserId: actor.userId,
      collegeId: actor.collegeId,
    });
  },
});

// Scoped AI Preference Memory (CHECKPOINT.md's P1 item, deferred out of the
// chat-attachment governance pass) — a bounded, consent-gated version of
// "the AI remembers things you told it," distinct from user_preferences_set
// above (that one is an AI-response *display* setting with no retention
// risk; this one is the AI persisting something a human said in
// conversation, which is exactly the "unbounded/unauditable PII retention"
// risk CHECKPOINT.md's own roadmap flagged). Five tools total (the three
// below plus ai_memory_remember_fact/ai_memory_forget_fact further down,
// general freeform memory added this round) — but still no sixth: there is
// NO ai_memory_consent_set tool. Consent can only be
// granted or revoked by the human directly, through routes/aiMemory.js —
// see aiMemoryService.js's own file comment for why that split is the
// actual safety property here, not a formality.
registerTool({
  name: 'ai_memory_consent_status',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Reads whether the acting user has opted in to AI Memory (the AI remembering their stated ' +
    'preferences across conversations). If false, tell the user they can turn it on in AI Memory settings ' +
    '— never claim it is already on, never suggest you can turn it on for them.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => aiMemoryService.getConsent(client, { actorUserId: actor.userId }),
});

registerTool({
  name: 'ai_memory_remember',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Remembers one fact about how the acting user wants to work with the AI, for future ' +
    `conversations. Only ${aiMemoryService.ALLOWED_MEMORY_TYPES.join(', ')} may be set — never a freeform ` +
    'type, and never a fact, note, or opinion about a student, staff member, or anyone other than the ' +
    'acting user themselves. Fails if the user has not opted in to AI Memory yet — if it fails for that ' +
    'reason, tell them where to turn it on, do not retry.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      memory_type: {
        type: 'string',
        enum: aiMemoryService.ALLOWED_MEMORY_TYPES,
        description: 'The kind of preference being remembered.',
      },
      value: { type: 'string', description: "The preference itself, in the user's own words (short)." },
    },
    required: ['memory_type', 'value'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => {
    if (!aiMemoryService.ALLOWED_MEMORY_TYPES.includes(params.memory_type)) {
      throw new AiToolInvalidParamsError(
        `memory_type must be one of ${aiMemoryService.ALLOWED_MEMORY_TYPES.map((t) => JSON.stringify(t)).join(', ')}, ` +
          `got ${JSON.stringify(params.memory_type)}`,
      );
    }
    return aiMemoryService.rememberPreference(client, params.memory_type, params.value, {
      actorUserId: actor.userId,
      collegeId: actor.collegeId,
    });
  },
});

registerTool({
  name: 'ai_memory_forget',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Deletes one previously remembered AI Memory fact for the acting user. Always allowed, even ' +
    'if AI Memory is currently turned off.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      memory_type: {
        type: 'string',
        enum: aiMemoryService.ALLOWED_MEMORY_TYPES,
        description: 'The kind of preference to forget.',
      },
    },
    required: ['memory_type'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => {
    if (!aiMemoryService.ALLOWED_MEMORY_TYPES.includes(params.memory_type)) {
      throw new AiToolInvalidParamsError(
        `memory_type must be one of ${aiMemoryService.ALLOWED_MEMORY_TYPES.map((t) => JSON.stringify(t)).join(', ')}, ` +
          `got ${JSON.stringify(params.memory_type)}`,
      );
    }
    return aiMemoryService.forgetPreference(client, params.memory_type, { actorUserId: actor.userId });
  },
});

// General freeform AI Memory (product decision, this round) — the four
// bounded types above only ever cover a fixed set of named categories; a
// user telling the AI something worth remembering that doesn't fit one of
// those (e.g. "I mostly work with the placement cell data") had nowhere to
// go. Same consent gate, same per-user account scope, same "never a fact
// about anyone but the acting user" boundary as ai_memory_remember — see
// that boundary spelled out in this tool's own description below, since
// there is no allowlist-of-types here to enforce it structurally the way
// the bounded tool's enum does. aiMemoryService.rememberFact still enforces
// what a schema-level enum can't: a hard MAX_GENERAL_FACTS cap, and a
// narrow deterministic rejection of anything containing a bare identifier-
// shaped number (roll/EMIS/admission/phone number) as a backstop under
// this instruction, not a replacement for it.
registerTool({
  name: 'ai_memory_remember_fact',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Remembers one freeform fact about the acting user themselves — their own role, working ' +
    "context, standing instructions, or preferences not covered by ai_memory_remember's fixed categories " +
    '(e.g. "I mostly handle the placement cell", "always double-check attendance numbers before reporting ' +
    'them to me"). NEVER a fact, note, opinion, or observation about a student, staff member, or anyone ' +
    'other than the acting user themselves — that is a hard line, not a style preference, regardless of how ' +
    'the user phrases the request; if asked to remember something about someone else, decline and explain ' +
    'why rather than rephrasing it to slip through. NEVER an identifier number (roll number, EMIS number, ' +
    'admission number, phone number) even about the acting user themselves. Fails if the user has not opted ' +
    'in to AI Memory yet, or if they are already remembering the maximum — in either case tell them plainly ' +
    'and do not retry.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      fact: { type: 'string', description: "The fact itself, in the user's own words (short, one sentence)." },
    },
    required: ['fact'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    aiMemoryService.rememberFact(client, params.fact, { actorUserId: actor.userId, collegeId: actor.collegeId }),
});

registerTool({
  name: 'ai_memory_forget_fact',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Deletes one previously remembered general fact (ai_memory_remember_fact), by its id. Fact ids ' +
    'are only ever visible in the "Remembered preferences" background context this same acting user\'s own ' +
    'session already carries — never guess or invent one. Always allowed, even if AI Memory is currently ' +
    'turned off.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      fact_id: {
        type: 'string',
        description: 'The id of the fact to forget, exactly as given in the background context.',
      },
    },
    required: ['fact_id'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => aiMemoryService.forgetFact(client, params.fact_id, { actorUserId: actor.userId }),
});

// ai_memory_revise — memory_str_replace's ARCNAVE form. The consumer
// tool edits an exact text span inside a memory file; ARCNAVE's memory
// is one fact per row, not a file, so the equivalent unit of edit is
// the whole fact. Without it, correcting "prefers Tamil" to "prefers
// Tamil for parent-facing notices only" meant forget-then-remember,
// which loses the row's created_at ordering and fails outright when the
// store is already at its cap. See aiMemoryService.reviseFact for why
// consent is required here but not for forgetting.
registerTool({
  name: 'ai_memory_revise',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Replaces the text of one previously remembered general fact (ai_memory_remember_fact), by its ' +
    'id — use this to correct or refine something already remembered, instead of forgetting it and remembering ' +
    'a new one. Fact ids are only ever visible in the "Remembered preferences" background context this same ' +
    "acting user's own session already carries — never guess or invent one. The replacement text is checked " +
    'the same way a new fact is: it may not contain roll numbers, phone numbers or other identifiers.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      fact_id: {
        type: 'string',
        description: 'The id of the fact to revise, exactly as given in the background context.',
      },
      fact: { type: 'string', description: 'The full replacement text for that fact.' },
    },
    required: ['fact_id', 'fact'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    aiMemoryService.reviseFact(client, params.fact_id, params.fact, { actorUserId: actor.userId }),
});

// ai_memory_list — the one AI Memory transparency gap: a user could set
// and forget memory but never actually ask "what do you remember about
// me" and get a direct answer back, only ever see it surface as an
// automatic background hint they never explicitly requested. Read-only,
// no consent gate — same "always allowed" reasoning forgetPreference/
// forgetFact above already establish: if consent was revoked there is
// nothing left to list, and if it's on, listing what's already
// remembered carries no risk beyond what set it in the first place.
