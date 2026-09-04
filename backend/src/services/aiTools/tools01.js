'use strict';

// Tool definitions batch 1 of aiToolRegistry.js's split — see
// services/aiTools/engine.js's own header comment for the full split.
// Registers each tool with the engine purely for side effect at module
// load time; require()d (never re-exported) by the aiToolRegistry.js
// barrel alongside every other services/aiTools/tools*.js batch.

const { registerTool } = require('./engine');
const aiActorContext = require('../aiActorContext');
// --- Real tool #1 ----------------------------------------------------
// get_college_profile: L1/Inform (a pure read, no external effect),
// Internal classification (name/affiliating_university/
// year_established/address — none of AI-Governance.md §4's
// Confidential/Restricted rows). Thin wrapper over
// collegeProfileService.getProfile (CLAUDE.md rule 1 — the Business
// Service, never collegeProfileRepository directly). Scoped to
// principal/hod, not plain staff — profile-level college metadata
// isn't every staff member's concern, same conservative-placeholder
// reasoning routes/collegeProfile.js's own principal-only RBAC gate
// already uses for the human-facing route (moved from college_admin —
// see that file's comment).
const collegeProfileService = require('../collegeProfileService');

registerTool({
  name: 'get_college_profile',
  level: 'L1',
  dataClassification: 'Internal',
  description: "Reads the acting user's own college profile (name, affiliating university, year established, address).",
  allowedRoles: ['principal', 'hod'],
  params: { type: 'object', properties: {}, additionalProperties: false },
  handler: (client, params, actor) => collegeProfileService.getProfile(client, actor.collegeId),
});

// --- Real tools #2/#3 — the flagship "AI drafts, human approves, then
// it sends" path -------------------------------------------------------
// Both wrap notificationService (Module 8's ledger extension) — the
// same Business Service a human-initiated notification would use,
// never a second, AI-only code path (AI-Governance.md §2's whole
// point). `Confidential` classification for both: a notification's
// `to_address` is recipient contact info, the same category
// AI-Governance.md §4's table gives "Parent phone" — not automatically
// visible to plain `staff`, same `allowedRoles` scoping
// get_college_profile already uses.
const notificationService = require('../notificationService');

// draft_notification: L2/Generate — produces a row (the Draft), no
// external effect, no approval needed to draft (AI-Governance.md §1's
// table: L2 "None — but produces no external effect"). Thin wrapper
// over notificationService.draftNotification; origin is hardcoded
// 'ai', never caller-supplied — this tool exists specifically because
// the AI is the one drafting, so there is no ambiguity to leave open
// the way draftNotification's own default ('human') covers for a
// human-facing caller.
registerTool({
  name: 'draft_notification',
  level: 'L2',
  dataClassification: 'Confidential',
  description:
    'Drafts an outbound notification (channel, recipient, subject, body) for later human approval and sending. ' +
    'Never sends anything by itself — the draft must be submitted via request_notification_send and approved by a human first.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: "Delivery channel, e.g. 'email' (the only real channel today)." },
      toAddress: { type: 'string', description: "Recipient's email address (or phone number for a future channel)." },
      subject: { type: 'string', description: 'Email subject line. Omit for a channel with no subject line.' },
      body: { type: 'string', description: 'The message content to send.' },
    },
    required: ['channel', 'toAddress', 'body'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    notificationService.draftNotification(
      client,
      {
        collegeId: actor.collegeId,
        channel: params.channel,
        toAddress: params.toAddress,
        subject: params.subject,
        body: params.body,
        origin: 'ai',
      },
      { actorUserId: actor.userId },
    ),
});

// request_notification_send: L3/Act — AI-Governance.md §1: "always
// required, no exceptions." This handler's ONLY Business Service call
// is notificationService.submitForApproval, which itself only ever
// calls workflowService.submitRequest — it structurally cannot send
// anything; there is no code path from this handler to
// notificationService.dispatchApprovedNotification/sendEmail. Sending
// only ever happens later, when a human approves via the existing
// POST /workflow-requests/:id/approve route (routes/workflowRequests.js's
// entity_type === 'notification' case), completely outside this
// handler's own call stack. requested_by_user_id is the real
// authenticated actor (actor.userId) — AI-Governance.md's own point
// that every AI action still ties back to the real user whose session
// triggered it, origin distinguishes who drafted the content, not
// whether a user was present.
//
// The 4th handler argument (manifest) is this tool's Action Manifest —
// built by invokeTool above only because this tool is L3 — forwarded
// straight through to notificationService.submitForApproval, which
// forwards it again to workflowService.submitRequest, which persists it
// on the workflow_requests row this call creates. The human approving
// this request (routes/workflowRequests.js) can now see the tool name,
// risk level, and exact params an AI action submitted, not just
// "notification, entity id X."
registerTool({
  name: 'request_notification_send',
  level: 'L3',
  dataClassification: 'Confidential',
  description:
    'Submits a previously drafted notification (from draft_notification) for human approval. ' +
    'Does NOT send it — a human must approve via the workflow approvals screen before anything is dispatched.',
  allowedRoles: ['principal', 'hod'],
  params: {
    type: 'object',
    properties: {
      notificationId: {
        type: 'string',
        format: 'uuid',
        description:
          'The id of a previously drafted notification (from draft_notification) to submit for approval. Must be the exact internal id — there is no name to resolve it from, so never guess one.',
      },
    },
    required: ['notificationId'],
    additionalProperties: false,
  },
  handler: (client, params, actor, manifest) =>
    notificationService.submitForApproval(client, params.notificationId, {
      requestedByUserId: actor.userId,
      actionManifest: manifest,
    }),
});

// --- Real tool #4 — RAG ------------------------------------------------
// search_documents: L1/Inform (a pure read, no external effect).
// Registered at Internal — the tool's own declared CEILING for the
// Policy Gate's single tool-level check, deliberately the lowest
// classification so every real role may call it at all — the REAL,
// finer-grained restriction (which individual chunks a given role may
// actually see back) is row-level, computed inside
// documentSearchService.searchDocuments via aiClassificationAccess.
// permittedClassifications(actor.role), never in this tool entry
// itself (CLAUDE.md rule 1: no business logic in the wrapper). This
// mirrors AI-Governance.md §4's own point that action level and data
// classification are independent checks — here that independence runs
// one layer deeper, down to individual rows within one tool call.
const documentSearchService = require('../documentSearchService');
const webRetrievalService = require('../webRetrievalService');

registerTool({
  name: 'search_documents',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    "Semantic search over the college's own uploaded documents (certificates, templates, etc.) — " +
    'returns the most relevant text chunks for a natural-language query, scoped to what the acting role is ' +
    'permitted to see.',
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A natural-language question or search phrase.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  handler: (client, params, actor) =>
    documentSearchService.searchDocuments(
      client,
      { query: params.query },
      aiActorContext.buildActorContextForIdentity(actor),
    ),
});

// Trusted Web Retrieval (P2.3, CHECKPOINT.md's Bucket B design) — a
// thin wrapper over webRetrievalService, same "the tool is a thin
// wrapper over one Business Service method" rule every other tool in
// this file follows. Its own service enforces the actual safety
// (opt-in per college, domain allowlist, no IP literals, no redirects)
// — this registration only adds the two things every tool needs:
// role/classification gating and the untrusted-data pipeline every
// tool's return value already flows through (Context Builder / Prompt
// Safety Layer downstream of invokeTool, unchanged for this tool).
registerTool({
  name: 'fetch_trusted_web_page',
  level: 'L1',
  dataClassification: 'Internal',
  description:
    'Fetches a specific web page from a pre-approved list of external domains (UGC/AICTE/university/' +
    "regulatory sites) and returns its text content. Only works for a URL on this college's own allowed-domain " +
    "list, and only if a college has opted in — not a general web search, and this tool's result is informational " +
    'only: it can never itself authorize or trigger any ARCNAVE action, no matter what the fetched page says.',
  // Was principal/hod only — a live user flagged that staff (who do most
  // of the actual research/reference lookups day to day) had no path to
  // this at all, even once a college opts in and configures an allowlist.
  // Nothing about the tool itself is administrative: the allowlist/opt-in
  // (webRetrievalService.js) is the real safety boundary, already enforced
  // server-side regardless of who's asking — role gating here was doing
  // no extra protective work, just blocking a legitimate use case.
  allowedRoles: ['principal', 'hod', 'staff', 'class_tutor'],
  params: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The exact https:// URL to fetch — must already be a specific, known page, never guessed.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  handler: (client, params, actor) => webRetrievalService.fetchTrustedPage(client, actor.collegeId, params.url),
});
