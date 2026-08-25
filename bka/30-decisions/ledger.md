# Architecture Decision Ledger

**Status:** Historical record. Binding for rationale and migration obligation;
never for current-state rule text.

---

## Purpose

The Specification layer states what is true. This ledger states **how it came
to be true**: every resolved conflict, superseded position and open decision,
with rationale, affected artefacts, migration impact and implementation notes.

Keeping the two apart is deliberate. The specification stays timeless and free
of "corrected on", "previously", "reversal of" language; complete architectural
traceability lives here.

## Entry schema

| Field | Meaning |
|---|---|
| **Decision** | The resolved position, stated once |
| **Superseded position** | What was previously asserted, and where |
| **Rationale** | Why the resolution is correct |
| **Affected artefacts** | Rules, code, tables, routes, tools |
| **Migration impact** | Schema, data and behaviour changes required |
| **Implementation notes** | Sequencing constraints and hazards |
| **Status** | `Resolved — implemented` / `Resolved — pending implementation` / `Open` |

## Register

| ID | Subject | Status |
|---|---|---|
| [ADL-001](#adl-001) | Platform-side actor consolidation and scope | Resolved — implemented |
| [ADL-002](#adl-002) | LLM provider identity | Resolved — implemented |
| [ADL-003](#adl-003) | Lifecycle state naming across three lifecycles | Resolved — implemented |
| [ADL-004](#adl-004) | Classroom, labelling and configuration ownership | Resolved — partially implemented |
| [ADL-005](#adl-005) | Role-to-data-classification matrix | **Open** |
| [ADL-006](#adl-006) | Required actor level for Level 3 invitation | Resolved — implemented |
| [ADL-007](#adl-007) | Staff registration initiation and chain | Resolved — partially implemented |
| [ADL-008](#adl-008) | Staff deactivation AI tool | Resolved — deliberately not built |
| [ADL-009](#adl-009) | Attendance correction tiering | Resolved — implemented (Stage 5) |
| [ADL-010](#adl-010) | Same-actor direct-action carve-out | Resolved — implemented |
| [ADL-011](#adl-011) | Action-carrying system notifications | Resolved — partially implemented (absence flag, Stage 6) |
| [ADL-012](#adl-012) | Student lifecycle approval gate | Resolved — gate/floor implemented (Stage 6); L3 notification still pending |
| [ADL-013](#adl-013) | Fee structure removal and fee-status authority | Resolved — implemented |
| [ADL-014](#adl-014) | Mark entry versus correction | Resolved — implemented (Stage 5) |
| [ADL-015](#adl-015) | Declared limitations register | Resolved — implemented |
| [ADL-016](#adl-016) | Notification ledger | Resolved — implemented |
| [ADL-017](#adl-017) | AI drafting of Send Alert wording | Resolved — implemented |
| [ADL-018](#adl-018) | AI pre-submission confirmation turn | Resolved — implemented |
| [ADL-019](#adl-019) | AI identity-context consumption | Resolved — implemented |
| [ADL-020](#adl-020) | AI downstream scope fidelity | Resolved — implemented (Phase 4) |
| [ADL-021](#adl-021) | Position level integer versus business L-number | Resolved — was never a real defect |
| [ADL-022](#adl-022) | Consolidation of the documentation estate | Resolved — implemented |
| [ADL-023](#adl-023) | Copilot/Workspace AI surface merger | Resolved — implemented |
| [ADL-024](#adl-024) | Send Alert authority widened from Class Tutor to assigned staff | Resolved — implemented |
| [ADL-034](#adl-034) | L2 login/session model — Position Account vs delegated-in-staff-login | Resolved — spec corrected to match shipped code |
| [ADL-045](#adl-045) | General mode renamed to Research mode (label only) | Resolved — implemented |
| [ADL-046](#adl-046) | New AI capability: opt-in image generation (L2) | Resolved — pending implementation |
| [ADL-047](#adl-047) | Conversation history: character budget replaces flat message-count cap | Resolved — implemented |
| [ADL-048](#adl-048) | Per-message visible token usage, captured on the streaming path | Resolved — implemented |
| [ADL-049](#adl-049) | ARCNAVE Context Architecture — structured context replaces flat prompt strings | Resolved — pending implementation |
| [ADL-050](#adl-050) | ADR-030 P2(b) native Gemini request builder — implemented, then empirically rejected | Resolved — implemented (reverted) |
| [ADL-051](#adl-051) | NVIDIA NIM removed; Gemini becomes the default chat AND embedding provider | Resolved — implemented |
| [ADL-052](#adl-052) | ADR-030 P2(c) real tool-use loop — shipped behind a compatibility-mode-default flag | Resolved — implemented |
| [ADL-053](#adl-053) | J1/J2 artifact tool-naming behavioral-suite failures — no-fabrication test fix + focus-hint content inlining | Resolved — partially implemented |
| [ADL-054](#adl-054) | ADR-030 P3 — Gemini `cachedContentTokenCount` telemetry captured; explicit caching deliberately not pursued | Resolved — implemented |

---

## ADL-001

### Platform-side actor consolidation and scope

**Decision.** Exactly one platform-side role exists: Platform Admin, an ARCNAVE
employee holding no seat in any institution's hierarchy. Its authority is
bounded to onboarding plus five key-gated structural actions.

**Superseded position.** Three distinct actors were previously implied across
the estate: "Super Admin" (a naming never built), `college_admin` (a real
tenant role that was subsequently retired), and Platform Admin. Academic Year
lifecycle transitions were previously documented as Platform-Admin-executed on
the Principal's request.

**Rationale.** A cross-tenant operation cannot be modelled as a role inside a
tenant-scoped RLS path without either baking a bypass into every query or
accepting that one role quietly breaks the isolation model. Keeping Platform
Admin structurally outside means RLS stays airtight with no special case to
remember. Separately, a head of institution should not have to ask an outside
party to change their own college's operational settings — so the boundary is
drawn by *kind of change* (structural/legal identity versus operational
policy), not by frequency.

**Affected artefacts.** [RS-GOV-001](../10-specification/RS-GOV-governance.md#rs-gov-001)–[RS-GOV-009](../10-specification/RS-GOV-governance.md#rs-gov-009),
[RS-GOV-014](../10-specification/RS-GOV-governance.md#rs-gov-014),
[RS-TEN-004](../10-specification/RS-TEN-tenancy-security.md#rs-ten-004),
[RS-ACA-002](../10-specification/RS-ACA-academic.md#rs-aca-002),
[ADR-010](adr-register.md#adr-010), [ADR-020](adr-register.md#adr-020).

**RS-GOV-014 ratified 2026-07-26.** The product owner confirmed L2's
per-college flexibility (Platform Admin decides existence at onboarding;
each college's own L1 decides scope and chain position) as the final
governing behavior, not open policy work — no fixed global default is
introduced, and no code changes.

**Migration impact.**

| Item | Change |
|---|---|
| Authorization key mechanism | New — modelled on the existing opaque-token/hash invitation pattern. Generate (L1, one live key per college), cancel, redeem (Platform Admin, atomic), 7-day expiry |
| Department routes | Onboarding-time creation moves to Platform Admin; post-onboarding creation already correctly L1-gated, no change; merge and rename are new key-gated Platform-Admin endpoints |
| Structural versioning | Version column plus audit row on `colleges`/`departments` structural fields |
| `college_admin` | Already retired by migration; references corrected in the classification matrix and document module |

**Implementation notes.** The key mechanism assumes a functioning L1. Its
absence of a vacancy fallback is deliberate
([RS-GOV-007](../10-specification/RS-GOV-governance.md#rs-gov-007)) and MUST NOT
be "fixed" by adding one.

**Status.** Resolved — implemented (2026-07-25, Stage 3a). Key mechanism
(`structuralAuthorizationKeyRepository`, `platformService.generate/cancel/
loadRedeemable/markStructuralKeyRedeemed`), department risk split
(`POST /platform/colleges/:college_id/departments` onboarding-only,
`executeDepartmentMergeOrRename` key-gated), and structural versioning all
built and tested (10 integration tests). One real finding from an
independent reviewer pass fixed before close: redemption was not actually
atomic — `markStructuralKeyRedeemed` could run before the tenant-side
department write was durably committed, meaning an ordinary commit failure
could consume the key with no change landed. Fixed by exposing
`req.commitTransaction()` from `db/tenantTransaction.js` and calling it
explicitly before marking the key redeemed. D18 (RS-GOV-003) removed from
the divergence list — see the Implementation Impact Matrix.

---

## ADL-002

### LLM provider identity

**Decision.** The production LLM provider is **NVIDIA NIM**, reached through an
OpenAI-compatible completions endpoint, with embeddings from the same provider.
Provider identity is not an architectural fact and is recorded in exactly one
place: [ADR-028](adr-register.md#adr-028).

**Superseded position.** Four canonical artefacts asserted Gemini as the
current provider: the AI governance document's provider section, the
architecture document's AI layer diagram, the technology stack list, and the
deferred-decision register's local-LLM row. A fifth artefact already stated the
correct, provider-neutral position.

**Rationale.** Gemini was the original placeholder; no key for it ever existed
in this environment. NIM is a real credential the project actually holds and
against which the pipeline is live-verified. Nothing about the provider
abstraction was broken — the component genuinely is swappable — but four
"locked" documents asserted a fact about the running system that had not been
true since the AI module shipped, and no decision record governed the actual
production choice.

**Affected artefacts.**
[RS-AIG-008](../10-specification/RS-AIG-ai-governance.md#rs-aig-008),
[RS-ASM-008](../10-specification/RS-ASM-assessment-documents.md#rs-asm-008),
[ADR-012](adr-register.md#adr-012) (status corrected),
[ADR-028](adr-register.md#adr-028) (new).

**Migration impact.** None — code was already correct. This was a documentation
and decision-record defect only.

**Implementation notes.** The classification normalization layer
([RS-ASM-008](../10-specification/RS-ASM-assessment-documents.md#rs-asm-008)) is
provider-agnostic by construction and requires no change if the provider
changes again. The prohibition on asserting provider identity outside the ADR
register is what prevents this defect recurring.

**Status.** Resolved — implemented.

---

## ADL-003

### Lifecycle state naming across three lifecycles

**Decision.** Three lifecycles were normalised in one pass:

| Lifecycle | Resolution |
|---|---|
| Academic Year | `Draft → Active → Completed`. `Closed` renamed to `Completed`; `Archived` retired |
| College provisioning | `provisioning → ready → active → archived`, `suspended` a side-branch off `active` only. `active` added as its own state |
| Student | `Alumni` is terminal. No `Archived` student status |

**Superseded position.** Academic Year previously terminated at `Closed` with
`Archived` as a further state. College provisioning previously ran
`provisioning → ready → suspended → archived`, with the readiness gate on the
`provisioning → ready` transition and reactivation returning to `ready`.
Student lifecycle previously implied an `Archived` terminal status.

**Rationale.** Record archival is a record-keeping mechanism applied *on top of*
a lifecycle, not a further state the entity itself passes through
([RS-DAT-003](../10-specification/RS-DAT-data-integrity.md#rs-dat-003)).
Modelling it as a lifecycle state conflated two independent axes in all three
places. Separately, `ready` (onboarding configuration complete) and `active`
(the college is actually running) are genuinely different facts that were
previously collapsed, which put the readiness gate on the wrong transition.

**Affected artefacts.**
[RS-ACA-002](../10-specification/RS-ACA-academic.md#rs-aca-002),
[RS-GOV-010](../10-specification/RS-GOV-governance.md#rs-gov-010),
[RS-GOV-011](../10-specification/RS-GOV-governance.md#rs-gov-011),
[RS-GOV-012](../10-specification/RS-GOV-governance.md#rs-gov-012),
[RS-STU-006](../10-specification/RS-STU-students.md#rs-stu-006).

**Migration impact.**

| Item | Change | Data migration? |
|---|---|---|
| `academic_years.status` | Stored value `Closed` → `Completed`; `Archived` retired | **Yes** — existing rows carry these values, and no CHECK constraint currently narrows them |
| `colleges.provisioning_status` | New column with the four-state enum plus transition guards | **No** — greenfield; the column was never shipped |
| Readiness gate | Moves from the `provisioning → ready` transition to `ready → active` | No |
| Reactivation target | `ready` → `active` | No |

**Implementation notes.** Build the college lifecycle directly in its final
shape — there is no shipped state to migrate. The Academic Year rename is the
only real data migration in this entry and MUST NOT be treated as a code
relabel. Semester-level "closing Semester 3" wording is a different concept
from the Academic Year's own state and is deliberately unchanged.

**Status.** Resolved — implemented (2026-07-25/26, Stages 3a+3b, Student fix
2026-07-26). College provisioning lifecycle done (Stage 3a):
`colleges.provisioning_status` (four-state CHECK constraint), the readiness
gate correctly on `ready→active` (not `provisioning→ready`), reactivation
correctly targeting `active`. Academic Year done (Stage 3b):
`academic_years.status` `Closed`→`Completed` data migration, `Archived`
retired, new CHECK constraint, `completeAcademicYear` replacing
`closeAcademicYear`/`archiveAcademicYear`.

Student's `Archived` removal done 2026-07-26: `studentService.js`'s
`LIFECYCLE_STATES` no longer lists `'Archived'` — `changeStudentStatus`
rejects it like any other unknown value, closing the gap where a caller
could set a student's status straight to `Archived` with no approval step.
Mirrored in `frontend/src/features/students/schemas.js`'s
`LIFECYCLE_STATUSES`. The frontend's "Archive student" feature (buttons +
dialogs on Students List and Student Detail) was removed outright rather
than repointed, per explicit user decision — no valid status carries the
same meaning.

---

## ADL-004

### Classroom, labelling and configuration ownership

**Decision.** A consolidated set of resolutions from the classroom and
labelling review:

| Question | Resolution |
|---|---|
| Is Class Tutor separate from L4? | **No.** L4 is the one real credentialed classroom concept; "Class Tutor" is its default display label |
| L1–L4 versus job titles | Not two concepts. L1–L4 is the fixed authority structure; job titles are per-college display labels resolved at render time |
| Does a class belong to a batch? | **No.** A class is a permanent slot keyed by (department, semester number); occupants rotate annually |
| Who owns Organization Name, position titles, storage backend? | The college's own L1, unrestricted, via Institution Settings |
| Is Community restricted like Aadhaar? | **No.** It is a normal coarse category field under ordinary role-based access |
| Is attendance authority class-level? | **No.** Strictly per-hour |

**Superseded position.** Class Tutor was previously framed as "kept
deliberately separate" from L4, with its own narrower rules stated
independently in several domains. Organization Name and position-title editing
lived on the platform-admin frontend. Community was treated as
restricted-adjacent. Attendance permitted class-tutor and HOD force-marking.

**Rationale.** Two names for one credentialed concept guarantee that rules
stated against one name will drift from rules stated against the other.
Organization Name and position titles are identity and labelling changes, not
the data-integrity risk the structural-key mechanism exists for — the contrast
with department merge/rename is the operative distinction. Community captures
only a coarse category already used as a legitimate scholarship criterion; the
granular sub-caste name is not captured at all, so the Aadhaar exclusion does
not apply.

**Affected artefacts.**
[RS-CLS-002](../10-specification/RS-CLS-classroom.md#rs-cls-002),
[RS-CLS-004](../10-specification/RS-CLS-classroom.md#rs-cls-004),
[RS-CLS-005](../10-specification/RS-CLS-classroom.md#rs-cls-005),
[RS-CLS-007](../10-specification/RS-CLS-classroom.md#rs-cls-007),
[RS-CLS-008](../10-specification/RS-CLS-classroom.md#rs-cls-008),
[RS-CLS-009](../10-specification/RS-CLS-classroom.md#rs-cls-009),
[RS-CLS-010](../10-specification/RS-CLS-classroom.md#rs-cls-010),
[RS-IDN-012](../10-specification/RS-IDN-identity.md#rs-idn-012),
[RS-GOV-013](../10-specification/RS-GOV-governance.md#rs-gov-013),
[RS-ATT-002](../10-specification/RS-ATT-attendance.md#rs-att-002),
[RS-DAT-008](../10-specification/RS-DAT-data-integrity.md#rs-dat-008).

**Migration impact.**

| Item | Change |
|---|---|
| Class auto-generation | New — on department create, generate slots for in-scope years × sections |
| Student create/edit | Scope to L4's own class; timetable-linked view and export for other staff, with export events logged |
| Attendance authority | Rework from class-tutor/HOD force-marking to strict per-hour ownership. Touches the marking routes and the AI assistant's validation |
| Substitute flow | New state machine replacing the current direct HOD-assigns implementation |
| Organization Name / titles | Remove or lock the fields on the platform-admin edit dialog; surface them in Institution Settings |
| Display labels | New per-college lookup (`college_id`, `level`, `custom_label`), consulted at render time only |
| Storage backend | Pluggable backend selection, L1-editable; the document service remains the sole mediator |

**Implementation notes.** The display-label lookup is **additive only**.
Internal role keys stay exactly as they are in every route guard, token claim
and AI tool grant — zero changes to authorization code. Attendance authority
rework and AI tool ownership checks must land together, or the AI path will
enforce a looser rule than the human path.

**Status.** Resolved — partially implemented (2026-07-25/26, Stages 5/8a/8b).

Done: attendance authority reworked to strict per-hour ownership, landed
together with the AI tool's own eligibility check (Stage 5). Organization
Name and level1/level3 position titles moved to Institution Settings,
principal-only, off the platform-admin frontend (Stage 8a). Storage backend
is a real pluggable per-tenant configuration (`storageProviderRegistry.js`,
Stage 8a). Per-college display-label lookup exists for L1/L3/L4
(`colleges.level1/3/4_position_title`, Stage 8a/8b) and is consulted by AI;
no frontend surface renders it yet — deliberately deferred per explicit user
decision, until a real screen (Staff Directory, Approval screens, Profile
page) needs it, not treated as a bug.

Still pending: class auto-generation on department create
([RS-CLS-002](../10-specification/RS-CLS-classroom.md#rs-cls-002)/[RS-CLS-001](../10-specification/RS-CLS-classroom.md#rs-cls-001));
the substitute flow's request→L3-approval step and 24-hour window (the
underlying assignment mechanism itself already exists — see
[RS-CLS-007](../10-specification/RS-CLS-classroom.md#rs-cls-007)'s own
Conformance field, reclassified Partial).

---

## ADL-005

### Role-to-data-classification matrix

**Decision.** A conservative code-level matrix mapping each role to the set of
data classifications it may receive, checked **independently** of whether the
role may invoke the tool at all. Adopted as a **working default** so the first
AI slice could ship something real, explicitly flagged as open rather than
silently assumed.

**Superseded position.** The AI governance document stated that per-tool
classification access is "defined per tool, not assumed" without supplying the
definition. The original matrix also carried an entry for the since-retired
`college_admin` role.

**Rationale.** Action level and data classification are two genuinely
independent properties: a tool with broad read access is not automatically
entitled to Restricted data because it is read-only. A declared default that is
visibly open is better than an undeclared assumption.

**Ratified 2026-07-26.** The product owner ratified the matrix as final
policy, effective immediately, without waiting for a real production case of
a role first needing higher-tier access — the previously open question below
is now moot.

**Formerly open question (resolved by ratification above).** Ratifying the
matrix requires a role's access to be genuinely exercised by real production
use, not merely declared. Today the higher tiers are exercised only by roles
that already held that access, so no case has yet tested a role needing
Confidential or Restricted access for the first time.

**Affected artefacts.**
[RS-AIG-006](../10-specification/RS-AIG-ai-governance.md#rs-aig-006),
[RS-FIN-006](../10-specification/RS-FIN-finance.md#rs-fin-006),
[RS-ASM-004](../10-specification/RS-ASM-assessment-documents.md#rs-asm-004),
[ADR-020](adr-register.md#adr-020).

**Migration impact.** None. The matrix lives in its own module.

**Implementation notes.** One deliberate per-tool divergence exists: the marks
summary tool is registered `Internal` rather than the `Confidential` default
for marks, because the same tutor already holds full read and write access to
those exact marks on the dashboard. Divergences of this kind MUST be stated on
the tool, never left implicit.

**Status.** **Open.**

---

## ADL-006

### Required actor level for Level 3 invitation

**Decision.** The required actor level to invite or reassign a Level 3 seat is
**L1**.

**Superseded position.** The shipped invitation configuration requires actor
level 2 to invite a new Level 3.

**Rationale.** L2 is optional and most colleges will not have one. Requiring an
L2 to create an L3 makes it **structurally impossible to ever create an HOD** at
any college without an L2 — contradicting the L2-optionality invariant that has
held from the outset. This is a live defect, not a design question.

**Affected artefacts.**
[RS-IDN-004](../10-specification/RS-IDN-identity.md#rs-idn-004),
[RS-STF-007](../10-specification/RS-STF-staff.md#rs-stf-007).

**Migration impact.** One configuration value: `2` → `1`.

**Implementation notes.** Ship with a regression test proving an L1 can invite
an L3 at a college with **no L2 present**. The one-line nature of the fix is
what makes the regression test mandatory: without it, nothing prevents the
value drifting back.

**Status.** Resolved — implemented (2026-07-25, Stage 2). Fixed in
`positionAccountInvitationService.js` (`RECURSIVE_INVITERS[3].requiredActorLevel`
`LEVEL2` → `LEVEL1`). Regression test added proving an L1 with no L2 position
anywhere in its capabilities can invite an L3. Full suite green (1393/1393),
independent reviewer pass clean (2 cosmetic findings, both fixed).

---

## ADL-007

### Staff registration initiation and chain

**Decision.** Staff registration is L3-initiated and invite-first: L3 sends an
invite → the invitee accepts and completes their profile → L3 approves → L2 (if
in the chain) or L1 gives final approval → the account is live. Only then may
L3 assign the person as an L4.

**Superseded position.** A self-service chain in which the faculty member
submits a registration request, resolved by a bare approve/reject pair with no
invite step.

**Rationale.** Because the invite originates from a specific L3, the new staff
member's department is set automatically and correctly, which a self-service
request cannot guarantee. The approval chain is retained; only the initiation
changes.

**Affected artefacts.**
[RS-STF-001](../10-specification/RS-STF-staff.md#rs-stf-001),
[RS-STF-002](../10-specification/RS-STF-staff.md#rs-stf-002),
[RS-STF-003](../10-specification/RS-STF-staff.md#rs-stf-003),
[RS-STF-010](../10-specification/RS-STF-staff.md#rs-stf-010).

**Migration impact.** Invitation-first registration path; existing approve and
reject methods re-pointed at the new chain.

**Implementation notes.** **Hazard.** A plain staff hire's own temporary
credential bootstrap is *not* a violation of the invite-only credential-reset
rule. That rule governs Position Account reassignment — L1, L2, L3 and Class
Tutor seats specifically. A base-level person-centric account sits outside that
model entirely
([RS-STF-010](../10-specification/RS-STF-staff.md#rs-stf-010)) and MUST NOT be
"corrected" while rebuilding the invite-first flow.

**Status.** Resolved — partially implemented (2026-07-25, Stage 3d). The
invite-first mechanism itself is built: `staff_invitations` (college_id,
department_id, email, token_hash, invited_by, expires_at, accepted_at —
no RLS, same structural reason `principal_invitations`/
`position_account_invitations` have none), `staffService.inviteStaff`
(`POST /staff/invitations`, hod-only — actorUserId must be the real,
verified hod of the department the invite lands in, resolved via
`findHodDepartmentId`, never a caller-supplied departmentId) and
`acceptStaffInvitation` (`POST /staff/invitations/accept`, unauthenticated
— same pre-tenant-context pattern `routes/invitations.js`/
`routes/positionAccountInvitations.js` already establish). Accept creates
the `users` row (role `staff`, `isActive: false` — live only after final
approval, per RS-STF-002) and the `staff` row (department inherited from
the invitation, never the accepting caller) in one transaction, then
immediately auto-submits into the existing hod->principal chain — RS-STF-002
step 2 ("L3 approves") starts the moment step 1 finishes, not as a
separate manual action. 9 new unit tests + 3 new integration tests
(golden path, non-hod actor forbidden, invalid/reused token rejected).

**Two real gaps deliberately left open, not silently declared done:**
1. The chain `acceptStaffInvitation` submits into is still the old
   hardcoded `findHodForDepartment`/`findPrincipal` 2-step build, not
   `workflowChainService`'s configurable resolver — so RS-STF-002's own
   "L2-or-L1 per the institution's configured chain" is not actually
   reachable; an institution that configures an L2 step gets no
   different behavior. Same restraint `workflowChainService`'s own
   header comment already states for every other still-hardcoded submit
   function — a deliberate, matching scope boundary, not an oversight
   specific to this change.
2. `POST /staff` (bare, non-invite `createStaff`) and
   `POST /staff/:id/submit-registration` are UNCHANGED and still fully
   reachable — the frontend's own "Add Staff" flow still calls them
   directly, bypassing the invite entirely. RS-STF-001's "there is no
   staff-initiated request step" is therefore enforced for the NEW path
   only; the old path is not yet locked down, because doing so today
   would break the live frontend with no replacement UI built for it.
   Locking `POST /staff` down and repointing the frontend at
   `POST /staff/invitations` is deferred to this project's own "frontend
   against stable spec" phase (step 5 of the 6-step sequence this backend
   implementation effort follows), not silently dropped.

---

## ADL-008

### Staff deactivation AI tool

**Decision.** No AI tool for staff deactivation is built.

**Rationale.** The human action itself carries a pre-existing authorization gap
— no per-row scope check. An AI tool would inherit and amplify it. The
human-side fix is a prerequisite, not a parallel task.

**Affected artefacts.**
[RS-STF-005](../10-specification/RS-STF-staff.md#rs-stf-005).

**Migration impact.** None. The prerequisite fix is a per-row scope check on
the human path.

**Implementation notes.** This is recorded so the omission is never
re-discovered as an oversight. Two further AI capabilities are withheld on
similar grounds: document upload and review for tutor and HOD, where the
current permission is principal-only and explicitly provisional pending a real
rule decision; and multi-tool orchestration, which changes the LLM interaction
loop and needs its own scoped decision.

**Status.** Resolved — deliberately not built.

---

## ADL-009

### Attendance correction tiering

**Decision.** Attendance correction is **single-tier**: the Subject Faculty
submits, the class's L4 approves, and L4's approval is final by default. L4 may
discretionarily escalate a specific case.

**Superseded position.** A two-tier model in which "high-risk" corrections
escalated further up the configured chain.

**Rationale.** The high-risk threshold was never precisely defined, and the
overwhelming majority of corrections are ordinary data-entry slips — roll 43
typed as 33 — that cross-checking and L4's own review already catch. The
permanent audit trail is the safety net, in place of a mandatory second
reviewer. Preserving L4's *discretion* to escalate keeps the genuine benefit of
the two-tier model without a system-enforced classification nobody could
define.

**Affected artefacts.**
[RS-ATT-004](../10-specification/RS-ATT-attendance.md#rs-att-004),
[RS-DAT-002](../10-specification/RS-DAT-data-integrity.md#rs-dat-002).

**Migration impact.** Remove the high-risk escalation branch from the
correction implementation. No schema change.

**Implementation notes.** This is a removal, not an addition — the simpler of
the three correction paths to bring into conformance, and a reasonable first
one to land as a template for the other two.

**Status.** Resolved — implemented (2026-07-25, Stage 5). The discretionary
(not system-classified) escalation option is built: `attendanceService.
escalateAttendanceCorrection` + `workflowService.escalateRequest` let L4
append a `hod`/`principal` step to the same pending request, human-discretion
only, no AI entry point. See [RS-ATT-004](../10-specification/RS-ATT-attendance.md#rs-att-004).

---

## ADL-010

### Same-actor direct-action carve-out

**Decision.** A three-condition written test determines when an AI tool may be
registered below Level 3: same actor and scope, already direct for a human, and
never a delete.

**Superseded position.** One specific carve-out — natural-language attendance
marking — was described ad hoc, with no general test. Future tools would have
been checked against precedent rather than a rule.

**Rationale.** Precedent-copying is exactly how a boundary erodes. A written
test that must be verified against real route and service code, never inferred
from naming, converts a judgement call into a check.

**Affected artefacts.**
[RS-AIG-007](../10-specification/RS-AIG-ai-governance.md#rs-aig-007),
[RS-ATT-005](../10-specification/RS-ATT-attendance.md#rs-att-005),
[RS-NTF-006](../10-specification/RS-NTF-notifications.md#rs-ntf-006).

**Migration impact.** None — a registration discipline, backed by a runtime
bypass backstop.

**Implementation notes.** The extension boundary is the operative clause: if
natural-language marking is ever extended to let one user mark a session they
are not already eligible for, that variant **loses** the carve-out and must use
the ordinary correction workflow.

**Status.** Resolved — implemented.

---

## ADL-011

### Action-carrying system notifications

**Decision.** System notifications divide into delivery-only and
action-carrying. The action-carrying set — substitute approval, the
five-consecutive-day absence flag, and pending high-severity student-status
requests — remains outstanding until acted on and its closure is logged.

**Superseded position.** The system-notification carve-out was framed as
uniformly delivery-only, by analogy with OTP.

**Rationale.** The analogy holds for *why* these bypass the draft and approve
pipeline — fixed, mechanical, non-discretionary content — but not for what
happens afterwards. An absence flag that can be silently unread is not a
control.

**Affected artefacts.**
[RS-NTF-005](../10-specification/RS-NTF-notifications.md#rs-ntf-005),
[RS-ATT-008](../10-specification/RS-ATT-attendance.md#rs-att-008),
[RS-CLS-007](../10-specification/RS-CLS-classroom.md#rs-cls-007),
[RS-STU-007](../10-specification/RS-STU-students.md#rs-stu-007).

**Migration impact.** A new notification type plus a lightweight outstanding-flag
state for the absence flag.

**Implementation notes.** The absence flag is deliberately **not** a workflow
entity: there is nothing to approve or reject, only to close. Modelling it as a
workflow request would misrepresent it and add an approver where none exists.

**Status.** Resolved — partially implemented (2026-07-25, Stage 6): the
absence flag itself (raise/outstanding/close, `attendance_absence_flags`) is
built. The "automatic system notification" delivery half is not — the flag is
queryable and AI-readable, not pushed via email/dashboard alert yet.

---

## ADL-012

### Student lifecycle approval gate

**Decision.** All four of Suspended, Discontinued, Debarred and Dismissed
require the institution's configured approval workflow, with **L3 as a
mandatory minimum floor** that no configuration may remove.

**Superseded position.** The gate covered three of the four, omitting
Suspended, and no floor was enforced — an institution could in principle
configure these as Tutor-only.

**Rationale.** Student disciplinary and lifecycle changes are ordinarily
visible and reviewable at HOD level in how institutions actually operate, not
solely at the tutor's discretion. Suspended is no less consequential than the
other three.

**Affected artefacts.**
[RS-STU-007](../10-specification/RS-STU-students.md#rs-stu-007),
[RS-STU-010](../10-specification/RS-STU-students.md#rs-stu-010),
[RS-WFL-003](../10-specification/RS-WFL-workflow.md#rs-wfl-003).

**Migration impact.** The status-change path and the corresponding AI tool's
downstream approval routing.

**Implementation notes.** Note the two independent axes: whether a transition
requires approval to *enter*, and whether the resulting status *blocks
progression*. Suspended requires approval but is promoted or blocked per
institution policy. Conflating the two is the most likely implementation error
here.

**Status.** Resolved — partially implemented (2026-07-25, Stage 6): the gate
now includes `Suspended`, and `workflowChainService.resolveApproverChain`
enforces the L3 floor structurally (`WorkflowChainFloorViolationError` on any
configured chain that never reaches it). RS-STU-007's own automatic
notification to L3 for a pending request is not yet built — see ADL-011.

---

## ADL-013

### Fee structure removal and fee-status authority

**Decision.** The fee-structure concept is removed from ARCNAVE entirely — not
merely its approval workflow. Fee status is a bare Paid/Not Paid flag: L4 marks
it first-time as a receipt-backed direct write; L3 approves any later
correction.

**Superseded position.** A shipped fee-structure table, route, service approval
methods, workflow entity type and two AI tools. First-time payment marking was
principal-only in both the permission model and the AI tool registry.

**Rationale.** How much a student owes is not data ARCNAVE holds — it lives in
the institution's own accounting system, the same territory as the already
excluded gateway, ledger, fine, concession and refund capability. Retaining a
structure record with no amount served no purpose. On authority: the class's L4
is the actor who actually handles fee receipts, and the required receipt
attachment is what makes the direct write safe.

**Affected artefacts.**
[RS-FIN-001](../10-specification/RS-FIN-finance.md#rs-fin-001)–[RS-FIN-004](../10-specification/RS-FIN-finance.md#rs-fin-004),
[RS-AIG-004](../10-specification/RS-AIG-ai-governance.md#rs-aig-004),
[RS-DAT-002](../10-specification/RS-DAT-data-integrity.md#rs-dat-002).

**Migration impact.**

| Item | Change | Real schema change? |
|---|---|---|
| Fee-structure table and route | Drop | Yes |
| Fee-structure service approval methods | Remove | No |
| Fee-structure workflow entity type | Remove | No |
| Fee-structure AI tools | **Remove, not defer** — nothing remains for them to draft or submit | No |
| `fee_payments.fee_structure_id` | `NOT NULL` FK into the dropped table — drop the column and FK | **Yes** |
| `(student_id, fee_structure_id)` unique constraint | Replace with plain `student_id` uniqueness | **Yes** |
| Fee-payment permission and AI tool role | Principal-only → `class_tutor` for first entry | No |
| Correction path | New workflow-submitting AI tool routed to L3's own-department queue | No |

**Implementation notes.** This is the largest real schema change in the current
backlog. `fee_payments` is already amount-free but structurally dependent on
the table being removed, so the migration must run before or with the drop —
not after. The correction path is new work, not a rename of the removed
approval flow.

**Status.** Resolved — implemented (2026-07-25, Stage 4). `fee_structures`
dropped entirely (table, route, workflow entity type, `financeService`
approval methods, both fee-structure AI tools). `fee_payments.fee_structure_id`
FK dropped, `(student_id, fee_structure_id)` unique constraint replaced with
plain `student_id` uniqueness — a fee status is now one row per student, not
per fee-line, matching RS-FIN-002's own `unmarked -> marked -> (corrected)`
lifecycle. `markFeePayment` moved to `class_tutor` (own class only, real
per-row check, not a role-only gate), now requires a receipt document, and
refuses a second direct mark — RS-FIN-003's new `fee_corrections` table +
`requestFeeCorrection`/`approveFeeCorrection`/`rejectFeeCorrection` handle
any later change instead, modeled directly on `attendance_corrections`
(structural pattern P1 — original value never touched, effective value
computed at read time). `finance_status_summary` AI tool reworked to report
counts only, matching RS-FIN-004's "no amount to summarise." Frontend's
fee-structures admin page removed along with the two Dashboard widgets that
read it; the Student Detail page's fee-payment card rebuilt around the new
single-status-plus-correction shape.

Reviewer pass found one real gap, fixed before close: the generic
`POST /workflow-requests/:id/approve` endpoint had no dispatch branch for
`fee_correction` (or the pre-existing `attendance_correction`), so calling it
directly would flip a correction's `workflow_requests` row to Approved
without ever marking the correction applied — a silent violation of RS-DAT-002's
"approved correction becomes the effective value" for exactly the entity
types built to protect it. Fixed by having `dispatchWorkflowAction` reject
both entity types outright (409, new `WorkflowRequestWrongEndpointError`),
directing callers to the dedicated `/finance/fee-corrections/:id/approve`/
`/attendance/corrections/:id/approve` routes instead of silently
under-applying.

---

## ADL-014

### Mark entry versus correction

**Decision.** First-time mark entry is a direct write by the assigned Subject
Faculty. Any later write to an existing value is a correction approved by the
class's L4.

**Superseded position.** No boundary existed: any write proceeded directly.

**Rationale.** This closes a real gap rather than changing a decision. The
class's L4 already owns the Examination section and already approves attendance
corrections, so the same checkpoint applies without inventing a new authority.
Unlike attendance, marks have no live time window to lock, so
first-write-versus-any-write is the natural boundary rather than a workaround
for a missing lock event.

**Affected artefacts.**
[RS-ASM-002](../10-specification/RS-ASM-assessment-documents.md#rs-asm-002),
[RS-ASM-003](../10-specification/RS-ASM-assessment-documents.md#rs-asm-003),
[RS-DAT-002](../10-specification/RS-DAT-data-integrity.md#rs-dat-002).

**Migration impact.** The record-mark path and its AI tool must check for an
existing value before writing. A new workflow entity type within the existing
engine, plus a new workflow-submitting AI tool. No new mechanism.

**Implementation notes.** AI may perform first-time entry on the assigned
faculty's own behalf under the same-actor carve-out, but **never a correction**.
An AI-initiated correction must route through the normal submission path with
the pre-submission confirmation turn
([ADL-018](#adl-018)).

**Status.** Resolved — implemented (2026-07-25, Stage 5). `recordMark` throws
`AssessmentMarkAlreadyRecordedError` instead of overwriting an existing value;
`requestMarkCorrection`/`approveMarkCorrection`/`rejectMarkCorrection` and the
`assessment_submit_mark_correction` AI tool give the correction path a real
route. See [RS-ASM-002](../10-specification/RS-ASM-assessment-documents.md#rs-asm-002),
[RS-ASM-003](../10-specification/RS-ASM-assessment-documents.md#rs-asm-003).

---

## ADL-015

### Declared limitations register

**Decision.** Known data-quality and scope limitations are recorded in one
register that every consumer inherits, rather than being noted incidentally
wherever they were discovered.

**Rationale.** A limitation noted in the domain where it was found does not
reach the analytics or reporting consumer that later builds on the field. A
single register with a rule that consumers must not present a listed limitation
as a precise result makes the inheritance explicit.

**Affected artefacts.**
[RS-DAT-009](../10-specification/RS-DAT-data-integrity.md#rs-dat-009),
[RS-ATT-009](../10-specification/RS-ATT-attendance.md#rs-att-009),
[RS-ASM-010](../10-specification/RS-ASM-assessment-documents.md#rs-asm-010),
[RS-AIG-006](../10-specification/RS-AIG-ai-governance.md#rs-aig-006).

**Migration impact.** None.

**Implementation notes.** Adding an entry requires a ledger entry; removing one
requires the underlying limitation to have actually been resolved, not merely
worked around at one call site.

**Status.** Resolved — implemented.

---

## ADL-016

### Notification ledger

**Decision.** Every outbound notification is a ledger row before dispatch, with
every delivery attempt recorded.

**Superseded position.** The notification service sends email directly, with no
ledger and no delivery-attempt history. This was a deliberate, recorded scope
decision at the time, not an oversight.

**Rationale.** Without a ledger there is no delivery history and no record of
retries. The gap is tolerable only while every send is already gated by a
completed approval. Any caller needing to send a notification **not** already
gated that way — AI-drafted content, bulk send, anything discretionary — cannot
reuse the direct send path.

**Affected artefacts.**
[RS-NTF-001](../10-specification/RS-NTF-notifications.md#rs-ntf-001),
[RS-NTF-002](../10-specification/RS-NTF-notifications.md#rs-ntf-002),
[RS-NTF-003](../10-specification/RS-NTF-notifications.md#rs-ntf-003).

**Migration impact.** Two new tables: the notification record and the
delivery-attempt log.

**Implementation notes.** The trigger condition is already met in principle by
AI-drafted notification content, which makes this higher priority than its
"deferred" framing suggests.

**Status.** Resolved — implemented. Verified against real code, 2026-07-25:
the `notifications` table (migration `1753100000000_module-8-notification-
ledger.js`) and `notification_delivery` table both exist and are populated by
`notificationService`; this entry's own "pending implementation" framing was
stale, not a real gap. See [RS-NTF-001](../10-specification/RS-NTF-notifications.md#rs-ntf-001),
[RS-NTF-002](../10-specification/RS-NTF-notifications.md#rs-ntf-002).

---

## ADL-017

### AI drafting of Send Alert wording

**Decision.** AI may draft the wording of a Send Alert message. The same tutor
must directly review and confirm the final text before it sends.

**Superseded position.** Any AI involvement was treated as disqualifying the
Send Alert exception.

**Rationale.** The disqualifying condition is not "AI touched it" — it is
"nobody reviewed it". The tutor already holds unilateral authority to send this
exact category of message, so AI assisting with wording grants no new authority;
it saves typing. An unreviewed auto-dispatch is a different capability
entirely and keeps the full approval requirement.

**Affected artefacts.**
[RS-NTF-006](../10-specification/RS-NTF-notifications.md#rs-ntf-006),
[RS-NTF-007](../10-specification/RS-NTF-notifications.md#rs-ntf-007),
[RS-WFL-004](../10-specification/RS-WFL-workflow.md#rs-wfl-004).

**Migration impact.** None.

**Implementation notes.** The exception is conditional on all four conditions
at [RS-NTF-007](../10-specification/RS-NTF-notifications.md#rs-ntf-007) holding
simultaneously. Dropping any one of them — cross-class send, rich content,
auto-dispatch — makes it a different feature requiring the full ledger path.

**Status.** Resolved — implemented.

---

## ADL-018

### AI pre-submission confirmation turn

**Decision.** Before filing any workflow submission, the AI must ask the
requesting user for explicit confirmation, and only a clear affirmative reply
triggers submission.

**Superseded position.** Confirmation was implied per tool rather than required
generally; a conversational mention could in principle produce a formal
submission.

**Rationale.** A formal request created off an ambiguous conversational
mention is a real failure mode with a real cost — an approver's queue receives
something the requester never intended to file. Making the confirmation a
general rule rather than per-tool means a future workflow-submitting tool
inherits it automatically.

**Affected artefacts.**
[RS-AIG-005](../10-specification/RS-AIG-ai-governance.md#rs-aig-005), and every
workflow-submitting tool.

**Migration impact.** A new confirmation turn in the AI conversation flow —
**not a backend-only change.**

**Implementation notes.** This is a shared AI-layer change and should land once
all new correction tools exist, rather than being retrofitted per tool. No
reply, an ambiguous reply and "not now" all mean the AI does nothing and no
request is created.

**Status.** Resolved — implemented. `askAgent` (`backend/src/services/aiService.js`)
now stops before running any L3 tool's handler: policy/param preconditions
are checked (`aiToolRegistry.checkToolPreconditions`), then the AI returns a
`pendingConfirmation` (toolName + validated params) plus a natural-language
confirmation question instead of submitting. The frontend (`useAskAgent.js`'s
`confirmSubmission`/`cancelSubmission`, rendered by `MessageDocument.jsx`'s
`SubmissionConfirm`) only fires the real `POST /ai/tools/:name/invoke` call
on an explicit "Yes, submit" click, recorded as its own conversation turn —
no reply, a "No", or navigating away all leave no request created. Applies
generically to every L3 tool by level, not per-tool, so a future
workflow-submitting tool inherits it automatically.

---

## ADL-019

### AI identity-context consumption

**Decision.** AI consumes the resolved identity context generically and
contains no branch asking whether the session is personal or institutional.
Authorization resolves against the request's live effective role.

**Superseded position.** The AI Policy Gate read the raw token role claim
directly and was gated only by authentication rather than by the permission
middleware that reads the resolved role.

**Rationale.** Identity resolution is the identity subsystem's responsibility;
AI is a consumer. The branching happens once, upstream, before AI code runs. A
branch inside AI would be a second place for the two contexts to diverge.

**Affected artefacts.**
[RS-AIG-010](../10-specification/RS-AIG-ai-governance.md#rs-aig-010),
[RS-IDN-007](../10-specification/RS-IDN-identity.md#rs-idn-007),
[ADR-023](adr-register.md#adr-023).

**Migration impact.** None outstanding.

**Implementation notes.** Two effective-role labels are producible only by an
institutional session. The class-tutor label was granted tool-by-tool wherever
a tool's existing staff grant already meant "own taught or tutored classes".
The level-2 label was deliberately granted to **no** tool: granting it
speculatively would pre-empt product policy the AI domain does not own.

**Status.** Resolved — implemented.

---

## ADL-020

### AI downstream scope fidelity

**Decision (principle).** Once request authentication has produced an identity
context, downstream Business Services must consume that context directly and
must not perform a second capability resolution from a user id unless
intentionally resolving a different principal.

**Current defect.** The shared scope-resolution helper always resolves the
**Personal** identity context from the caller's user id, regardless of the role
passed in, and never consults the institutional resolver. An AI tool call from
a Position Account session therefore receives the underlying person's Personal
scope, not the Position Account's Institutional scope — even though the Policy
Gate itself correctly read the institutional context.

**Severity.** **Highest of any open item.** This is an authorization-fidelity
defect, not a documentation problem: a Position Account session's AI tool calls
can return the occupant's own personal data instead of the position's scoped
data.

**Blast radius.** A full audit of every AI-tool-backing function found the
affected set is narrow and precise: **five call sites**. Most functions either
perform their own independent verified lookup or have no per-department or
per-class narrowing at all. The larger "rewire every service to consume the
capability object directly" refactor originally feared is **not** required.

**Affected artefacts.**
[RS-AIG-011](../10-specification/RS-AIG-ai-governance.md#rs-aig-011),
[RS-AIG-010](../10-specification/RS-AIG-ai-governance.md#rs-aig-010).

**Migration impact.** Each of the five functions accepts either the legacy
shape or a pre-built actor context. A pure helper maps the already-resolved
identity context onto that shape with no additional database call. The five
tool handlers pass it. **Every non-AI dashboard caller is untouched** — the
legacy shape resolves exactly as before.

**Implementation notes.** This is the one open item where a specification
disagreement indicated a possible live security-boundary defect rather than
stale text, and it is therefore the first item to verify directly against code.
Verification is an end-to-end test over a real HTTP and database round trip,
proving a Class Tutor Position Account's scope is provably narrower than the
same occupant's personal scope where the two genuinely differ.

**Status.** **Resolved (2026-07-25, verified against real code).** The fix
described under Migration impact above is shipped: `aiActorContext.
buildActorContextForIdentity` exists and is wired into all five identified
call sites through `aiToolRegistry.js`. This entry stays in the ledger as the
historical record of the defect and its fix, not as an open item — see
[RS-AIG-011](../10-specification/RS-AIG-ai-governance.md#rs-aig-011) for the
current, corrected conformance status.

---

## ADL-021

### Position level integer versus business L-number

**Corrected 2026-07-25 — this was never actually true, verified against real
code.** Every HOD position-creation call site (`ensureHodPositionForInvite`,
`staffService.js`) creates the position with `level: 3`. No `level: 2`
assignment for HOD exists anywhere in the codebase. The collision this entry
describes does not exist in the current code.

**Original (incorrect) premise, kept for the historical record.** ~~The
shipped position schema stores the HOD seat as level integer `2`, while every
business rule refers to HOD as **L3**.~~

**Why this is not merely cosmetic.** Any code — a future report query, a new AI
tool written by someone unfamiliar with the resolution façade — that enforces a
rule such as "L3 is a mandatory minimum approval floor" by comparing raw level
integers rather than going through the resolved effective role will silently
check the wrong number. The façade exists precisely so nothing downstream needs
to compare raw integers; the numbering collision becomes a live authorization
defect the moment that discipline is bypassed.

**Options.**

| Option | Consequence |
|---|---|
| Accept the collision | Zero migration. Permanent reliance on the façade discipline never being bypassed |
| Renumber to match the business rule | Real migration across positions and every dependent assignment table. Removes the trap permanently |

**Affected artefacts.**
[RS-IDN-003](../10-specification/RS-IDN-identity.md#rs-idn-003),
[RS-IDN-007](../10-specification/RS-IDN-identity.md#rs-idn-007),
[RS-WFL-003](../10-specification/RS-WFL-workflow.md#rs-wfl-003).

**Sequencing constraint — removed 2026-07-25.** Nothing is blocked by this
entry any longer. [ADL-006](#adl-006), [ADL-007](#adl-007) and
[ADL-003](#adl-003)'s college lifecycle work may all proceed without waiting
on any level-numbering decision.

**Status.** **Resolved — not a real defect, no action needed.**

---

## ADL-022

### Consolidation of the documentation estate

**Decision.** The prior documentation estate is replaced by this connected
specification: a canonical rule layer in which every statement has exactly one
home, derived matrices regenerated from it, and this ledger as the sole home
for change history and rationale.

**Superseded position.** An estate in which the same fact was stated in two to
four places at differing ages, with no mechanism to keep them aligned. Every
conflict resolved in this ledger arose from that structure rather than from a
design error — a fast-moving rules layer outrunning the narrative documents
describing it.

**Rationale.** The recurring failure was structural, not behavioural: a session
correctly updated one document while two or three others describing the same
fact went untouched. Deduplication removes the possibility rather than
mitigating the symptom. Statements now have a single source of truth, and a
validator enforces it mechanically.

**Affected artefacts.** The entire repository. Retirement mapping from every
prior source document is recorded in
[Traceability](../90-appendix/traceability.md).

**Migration impact.** None to code.

**Implementation notes.** Three controls sustain the property:

1. Prose restatement of another rule's normative content is prohibited; only
   cross-reference is permitted
   ([Conventions §8](../00-foundation/scope-and-conventions.md#8-cross-reference-convention)).
2. Every amendment edits exactly one rule and regenerates the derived matrices
   in the same change.
3. `tools/validate.py` fails the build on duplicate identifiers, unresolved
   cross-references, asymmetric dependency edges and orphaned rules.

**Status.** Resolved — implemented.

---

## ADL-023

### Copilot/Workspace AI surface merger

**Decision.** ARCNAVE has one AI surface: the Workspace shell at
`/workspace`. Conversation is a capability that surface expands into on a
second non-entity ask, not a separate destination. `/ai/copilot` redirects to
`/workspace`.

**Superseded position.** Two independent AI surfaces shipped side by side:
`/ai/copilot` (a full-page, dark-themed, multi-conversation chat app) and
`/workspace` (the task-first shell — hero, single ask box, entity resolution,
waiting tray). Nothing in the specification or ADR layer had ever decided
which would win or how they would merge; `routes.jsx` carried its own
in-code comment flagging `/workspace` as a preview build pending that
decision.

**Rationale.** A new user should never have to decide "Copilot or
Workspace?" before doing any work — the two surfaces answered the same
question (ask ARCNAVE AI something) with different amounts of chrome
depending on which URL was typed, not which task was being done. Merging
them removes that false choice: the single-ask flow stays the default for a
quick lookup, and a second follow-up question promotes into the same
threaded conversation Copilot offered, in place, without navigating away.
Entity resolution short-circuits at every turn regardless of thread state, so
resolving a record is never slower inside a conversation than outside one.

**Affected artefacts.** `frontend/src/app/routes.jsx` (`/ai/copilot` now a
redirect), `frontend/src/contexts/WorkspaceContext.jsx` (owns the
promotion rule via `askQuestion`), `frontend/src/components/workspace/*`
(AskSpine, WorkspaceLandingPage, ArtifactViewer, PersonalShelf,
WorkspaceHero), `frontend/src/components/ai/*` (the shared conversation
components — ConversationThread, PromptComposer, MessageDocument,
DocumentUploadConfirm, and the useConversations/useAskAgent/useToolInvoke
hooks — promoted out of `features/ai/` since they are cross-cutting, used by
Workspace, owned by none). `CopilotPage.jsx`, `AiWorkspace.jsx`,
`ConversationSidebar.jsx` and `EmptyState.jsx` are deleted outright — they
were Copilot-page-specific chrome with no further caller once the redirect
landed.

**Migration impact.** None to data. Workspace's conversation history reuses
Copilot's existing `localStorage` keys directly (same per-user/college
namespace) rather than migrating or duplicating them — the correct
single-store design for a client-only conversation cache, not a compatibility
shim. No production users existed at the time of this change, so no user-
facing migration was needed either way.

**Implementation notes.** Landed as four sequential commits, each verified
live before the next began:

1. Visual unification first, decoupled from the structural merge — Concept A
   theme (light, warm-cream/navy, Space Grotesk/Manrope) applied to
   Workspace, and Copilot's dark `arcnave-ai-theme` override stopped being
   toggled so both surfaces read as one product immediately, before any
   behavioural change landed.
2. Pure file move of the shared conversation components into
   `components/ai/` — zero behavior change, verified by confirming Copilot
   still worked identically afterward.
3. The actual merge: conversation wired into Workspace as a promotable
   capability, entity short-circuiting preserved at every turn, document
   upload confirm and the Curriculum/Circulars/Reminders prompts carried
   over from Copilot's sidebar into Workspace's hero as chips.
4. Retirement: `/ai/copilot` becomes a redirect, the four Copilot-only files
   are deleted, and the by-then-fully-dead `arcnave-ai-theme` CSS block is
   removed.

**Known residual gap — closed.** `DataTable`'s entity links (used inside
conversation threads) initially still resolved through
`features/ai/lib/entityRoutes`' legacy `/students/:id`-style routes rather
than Workspace's own `/workspace/e/:type/:id` scheme — harmless (the link
opened in a new tab) but inconsistent with Workspace's own route family.
Closed in a follow-up change: `entityRoutes.js`'s legacy `resolveEntityRoute`
(now callerless — Copilot was its only other consumer, and Copilot no
longer exists) was replaced with `resolveWorkspaceEntityRoute`, and
`DataTable` now renders these as an in-app `react-router` `Link` instead of
a new-tab `<a>`, so opening an entity from inside a thread stays within the
Workspace shell like every other entity resolution.

**Second follow-up — landing page.** `information-architecture.md`'s own
rule 1 ("Landing page = the AI Workspace, for every tenant role except
Platform Admin") was not actually true after M4: `/` still rendered
`DashboardPage` inside the nav-based `AppShell`, and `/workspace` was only
reachable via the "ARCNAVE AI" nav item, not where a session actually
landed. Closed: `DashboardPage` moved from `/` to `/dashboard` (still
reachable from `AppShell`'s nav, now pointing there instead), and `/` is a
plain `<Navigate to="/workspace" replace />`. `LoginPage`/`MfaChallengePage`
already navigate to `/` (or `location.state.from.pathname`) on success, so
no auth-flow code needed changing — they land on the Workspace for free.
Platform Admin is unaffected: it authenticates through the structurally
separate `/platform/login` → `/platform/dashboard` flow and never touches
`/`.

**Status.** Resolved — implemented.

---

## ADL-024

### Send Alert authority widened from Class Tutor to assigned staff

**Decision.** [RS-NTF-007](../10-specification/RS-NTF-notifications.md#rs-ntf-007)'s
Send Alert exemption is widened from "Class Tutor, own class" to **any staff
member currently timetable-assigned to that class** (subject/period
assignment, not just the tutor role), sending a plain-text message to that
class's students and parents.

**Superseded position.** RS-NTF-007 as written scoped Send Alert's
unilateral, no-approval authority to "L4, own class" — i.e. the Class Tutor
only. A subject staff member teaching that class but not tutoring it had no
equivalent unilateral path; a routine message like "bring your record note"
would have had to go through the full `draft → approve → dispatch` ledger
([RS-NTF-001](../10-specification/RS-NTF-notifications.md#rs-ntf-001)/
[RS-NTF-003](../10-specification/RS-NTF-notifications.md#rs-ntf-003)).

**Rationale.** Raised while reviewing the Students List visual redesign's
proposed bulk "Notify" action against [RS-WFL-004](../10-specification/RS-WFL-workflow.md#rs-wfl-004)
(the two hard-coded workflow exemptions). The original tutor-only scoping
was an arbitrary narrowing, not a deliberate authority boundary — the same
low-stakes, plain-text, human-reviewed, own-scope reasoning that justifies
the Tutor exemption applies identically to any staff member who is
genuinely, currently assigned to that class. Widening the *scope test* from
role ("is Tutor") to assignment ("is timetable-assigned") keeps every
existing safeguard intact (plain text only, own class only, human review
before send, no retry/fallback) while closing a gap that would otherwise
force routine subject-teacher communication through a full approval chain.

**Conditions — all must hold (verified via `AcademicService`, not
self-declared):**
1. The staff member is currently timetable-assigned to that class
   (subject/period link — tutor assignment also qualifies, since a tutor is
   definitionally assigned to their own class).
2. Sending to that class only — never a class the sender is not assigned to.
3. Content is plain free text.
4. Delivery is per-recipient, best-effort, no auto-retry, no channel
   fallback.
5. The sending staff member reviews the final wording before it sends.

**Any variant that drops one of these conditions** remains out of scope for
this exemption and must use the normal draft → approve → dispatch ledger,
exactly as RS-NTF-007 already stated for the tutor case.

**Affected artefacts.**
[RS-NTF-007](../10-specification/RS-NTF-notifications.md#rs-ntf-007) and
[RS-WFL-004](../10-specification/RS-WFL-workflow.md#rs-wfl-004) (authority and
conditions reworded); `backend/src/services/academicService.js`
(`sendClassAlert`'s gate now accepts the tutor OR any staff member with a
`faculty_allocation` row for the class, via the file's own
`listFacultyAllocationsForClass`; `ClassSendAlertNotTutorError` renamed to
`ClassSendAlertNotAssignedError`); `backend/src/routes/classes.js` (error
mapping + comment updated to match); `backend/src/services/aiToolRegistry.js`
(comment only — `class_send_alert` calls the same `sendClassAlert`, so it
inherits the widened check with no code change of its own);
`backend/tests/send-class-alert.test.js` (renamed error-case test, added a
case covering a non-tutor assigned-faculty sender).

**Migration impact.** None — no schema or data change; this is an
authorization-scope change to an existing, already-built endpoint.

**Status.** Resolved — implemented.

---

## ADL-025

### Platform-wide default license + Trial expiry window

**Decision.** [RS-GOV-015](../10-specification/RS-GOV-governance.md#rs-gov-015)
is added: a platform-wide `default_license` setting seeds the Onboarding
Wizard's License step, and a Trial license carries a fixed, non-configurable
30-day expiry window from the college's `created_at`.

**Superseded position.** Neither existed before this session. The wizard's
License step hardcoded `'Trial'` as its own initial value, with no platform
setting behind it. No trial-expiry concept existed anywhere in the schema —
Dashboard's "Trial Colleges" stat card had no sub-metric because there was
nothing real to back one (documented at the time as "left blank rather than a
fabricated number," not a bug).

**Rationale.** Raised while wiring the Platform Settings page's "Default
License for New Colleges" toggle from the design mock — the toggle existed in
the UI with nothing behind it. Making the platform-wide default real is a
one-column addition; the trial-expiry window followed naturally from the same
session's Dashboard sub-metric flag. 30 days was chosen as a fixed, simple
policy rather than per-college configurable, since no requirement for
per-college variation was raised.

**Affected artefacts.** `platform_settings.default_license` (migration
`1760700000000`); `colleges.trial_ends_at` (migration `1760800000000`);
`platformRepository.createCollege`/`updateCollege` (derives `trial_ends_at`
from the same placeholder as `subscription_status`, in the same statement);
`platformCollegeRepository.countTrialCollegesExpiringSoon`; `OnboardingWizard.jsx`
(seeds its License step from `GET /platform/settings` once, never overwriting
a manual selection); `PlatformSettingsPage.jsx` (Default License toggle, now
real); `DashboardStats.jsx` ("N expire this week" sub-metric, now real).

**Migration impact.** Two additive columns, both nullable/defaulted; existing
trial colleges backfilled with `trial_ends_at = created_at + 30 days` at
migration time (`1760800000000`'s own `UPDATE` statement).

**Status.** Resolved — implemented.

---

## ADL-026

### Principal Invitation resend can revive a revoked invitation; resend accepts an email override

**Decision.** [RS-GOV-016](../10-specification/RS-GOV-governance.md#rs-gov-016)
is added, documenting Principal Invitation as its own lifecycle. Two real
behavior changes: (1) `resendInvitation`'s guard is narrowed from
`accepted_at IS NULL AND revoked_at IS NULL` to `accepted_at IS NULL` only —
resend now revives a revoked invitation (clears `revoked_at`) instead of
rejecting with 409; (2) resend optionally accepts an `email` override,
redirecting the SAME invitation row to a different address in the same call
(typo-correction), rather than requiring revoke-then-fresh-invite.

**Superseded position.** Before this session, a revoked invitation's row had
no real action available on the Invitations screen (shown as "—"), and any
wrong-email pending invitation required revoking it and starting the heavier
Organizations Invite-L1 flow (email → OTP → invite) from scratch, since resend
always mailed the invitation's stored email verbatim with no override.

**Rationale.** Raised directly by the product owner: a revoked invitation
whose only real problem was a wrong email address didn't need the college
recreated or a whole new Invite-L1 flow — a design mock supplied for the
Invitations screen showed a revoked row's action flowing through the SAME
resend modal (with a 3-second "link invalid" flash immediately after revoke,
then a real "SEND INVITATION" button), confirming revive-via-resend as the
intended real behavior, not a shortcut invented ad hoc.

**Affected artefacts.**
`principalInvitationRepository.resendInvitation` (WHERE guard narrowed; adds
`revoked_at = NULL` and `email = coalesce($4, email)` to the UPDATE);
`platformService.loadResendableInvitation` (new, accepted-only guard, used
only by resend — `loadPendingInvitation` is unchanged and still gates revoke
to pending-only); `routes/platform.js`'s resend route (accepts `email` in the
body); `platformAdminApi.resendInvitation` (frontend, takes an optional
email); `InvitationsPage.jsx` (`ResendModal`'s email field is editable, not
read-only; revoked rows get a real "SEND INVITATION" action with a 3-second
`justRevokedId`-gated "link invalid" flash immediately after revoke);
`tests/platform-service.test.js` (revoked-invitation-resend unit test
rewritten from "throws" to "succeeds"); `tests/principal-invitation.test.js`
(new e2e test: revoke → resend → old token still 401s, new token accepts).

**Migration impact.** None — no schema change, an authorization/behavior
change to existing endpoints.

**Status.** Resolved — implemented.

---

## ADL-027

### Principal's wizard-entered profile auto-populates the real account; L1 Head Email OTP made real

**Decision.** [RS-GOV-017](../10-specification/RS-GOV-governance.md#rs-gov-017)
is added: the Onboarding Wizard's L1 Head name/designation/phone/address now
flow through `principal_invitations` into the real `users` row at accept
time, instead of being discarded. Separately, but found while reviewing the
same wizard step: the L1 Head Email field's OTP "verify" step is now a real
send-code/verify-code round trip (new `wizard_email_verifications` table),
replacing a fake client-side `setTimeout`.

**Superseded position.** `toCollegePayload`'s own prior comment explicitly
documented the personal-profile fields as "deliberately NOT mapped" — the
established pattern (matching Staff invitations) was that an invited person
always fills their own profile on accept, Platform Admin never enters it for
them. Separately, `wizardAtoms.jsx`'s `OtpField` was documented as "inert demo
interaction... no backend OTP endpoint exists for institution or L1-head
contact fields."

**Rationale.** The product owner explicitly reversed the profile-population
decision: unlike a Staff invite (sent by L3 for someone L3 has never met), the
Wizard's L1 Head fields are filled by Platform Admin *during a live
onboarding conversation with the institution* — the data already reflects
what the institution told Platform Admin, so asking the incoming Principal to
re-type it only reintroduces transcription risk already resolved once.
Reviewing this surfaced a real, separate gap in the same step: the L1 Head
Email field is the exact address `invitePrincipal` emails a live 24-hour
invitation token to at college-creation time, and its "verification" was
entirely fake — a typo there would previously have sailed through undetected
and sent a real invitation to the wrong address. Every OTHER wizard OTP field
(institution mobile/email, L1 mobile/alt-mobile/alt-email) was deliberately
left on the fake simulation — none of them are ever used to send anything
real, so no equivalent risk exists there.

**Affected artefacts.** `principal_invitations.full_name`/`designation`/
`phone`/`address` and matching nullable columns on `users` (migration
`1761000000000`); `principalInvitationRepository.createInvitation`/
`getInvitationByTokenHash` (now select/store the four fields);
`authRepository.createUser`/`getUserById` (now accept/return them);
`authService.acceptInvitation` (copies `invitation.full_name` etc. onto the
new `users` row); `platformService.invitePrincipal`/`createCollege` (accept
`fullName`/`designation`/`phone`/`address` and forward them);
`routes/platform.js` (`POST /colleges` accepts `principal_full_name` etc.);
`routes/auth.js` (`GET /auth/me` now does a real DB read via
`authService.getUserProfile`, not just JWT claims); `ProfilePage.jsx` (renders
the four fields); `OnboardingWizard.jsx`'s `toCollegePayload` (maps
`l1FirstName`/`l1LastName` → `principalFullName`, etc.). Separately:
`wizard_email_verifications` table (migration `1760900000000`);
`platformService.sendWizardEmailVerificationCode`/`verifyWizardEmailCode`
(reuse the same generate/hash helpers and error classes as the existing
Organizations Invite-L1 OTP flow, but keyed by email alone — no `college_id`
exists yet at this wizard step); `POST /onboarding/verify-email/send-code`\|
`verify-code`; `OnboardingWizard.jsx`'s new `EmailOtpField` component
(replaces the fake `OtpField` for `l1Email` only).

**Migration impact.** Four additive nullable columns on two tables; no
backfill needed (both tables' existing rows simply have NULLs, matching prior
behavior for every invitation/user that predates this change).

**Status.** Resolved — implemented.

---

## ADL-028

### Storage tier is now a real, enforced quota

**Decision.** [RS-ASM-011](../10-specification/RS-ASM-assessment-documents.md#rs-asm-011)
is added: `colleges.storage_tier` (set once, by Platform Admin, at onboarding)
is now a real byte quota, enforced by `documentService.assertWithinStorageQuota`
inside the single real upload path (`uploadDocument`) — rejecting any upload
that would push the college's total stored bytes over it.

**Superseded position.** `storage_tier` was a free-text label that "nothing
ever read" (per `platformRepository.js`'s own prior comment on why it isn't
in the Platform Admin PATCH route's editable-columns list) — captured at
onboarding, displayed nowhere, enforced nowhere.

**Rationale.** Raised directly by the product owner while reviewing the
Onboarding Wizard's Cloud Storage/Storage Quota step: "storage tier is real,
enable it." Parsing the tier string generically (number + unit, binary
1024-based) rather than a fixed lookup table means new tier options (the
wizard's dropdown can grow) need no corresponding code change. A college with
no tier set (Cloud Storage = No at onboarding) stays unmetered — this does
not retroactively impose a quota on any college that never had one.

**Affected artefacts.** `documentService.parseStorageTierBytes`/
`assertWithinStorageQuota`/`DocumentStorageQuotaExceededError`;
`collegeProfileRepository.getStorageTier` (new, mirrors the existing
`getLevel1/3/4PositionTitle` read-only tenant-side pattern); `documentRepository.sumFileSizeBytes`
(new); `uploadDocument`'s call to `assertWithinStorageQuota` before
`fileStorage.writeFile` (covers `uploadTemplate`/`uploadInstitutionalDocument`
for free, since both delegate to `uploadDocument`); `routes/documents.js`
(`DocumentStorageQuotaExceededError` → HTTP 413); `platformRepository.js`'s
own comment on why `storage_tier` isn't PATCH-editable (updated — it's real
now, but still only ever set once at `createCollege` time, same as
`level1/3PositionTitle`); `tests/document-service.test.js` (all upload-path
tests mock `collegeProfileRepository.getStorageTier` → `null`, i.e.
unmetered, matching every pre-existing test college's real state).

**Migration impact.** None — no schema change (`storage_tier` already
existed); a behavior change to an existing write path, defaulting to
unmetered (today's behavior) for every college with no tier set.

**Status.** Resolved — implemented.

---

## ADL-029

### Student flag/clear widened from tutor-only to any subject faculty

**Decision.** [RS-STU-013](../10-specification/RS-STU-students.md#rs-stu-013)
now authorizes flagging/clearing a student by the same boundary as VIEWING
them (`visibilityService.assertCanViewStudent`), not the narrower
tutor-only `assertCanModifyStudent` boundary editing the student's profile
uses. A staff member who teaches a subject to the student's class — not
just the class's tutor-of-record — may now flag/clear, matching the fact
they can already see that student.

**Superseded position.** RS-STU-013 previously pinned flag authority to
`assertCanModifyStudent` (class's own L4, HOD's own department, Principal
college-wide) "no boundary invented specially for this" — deliberately
tutor-only.

**Rationale.** Product owner confirmed directly: a subject teacher who
isn't the tutor should be able to flag a student and record why, since
they hold direct classroom knowledge of that student the tutor may not.
No separate boundary was invented — the existing, broader "can view this
student" rule (tutor-of-record OR faculty-allocated) already draws exactly
the line wanted, so flagging now reuses it instead of the write-side rule.

**Affected artefacts.** `studentService.flagStudent`/`clearStudentFlag`
(now call new `assertCanFlagStudent`, wrapping
`visibilityService.assertCanViewStudent` and re-throwing
`VisibilityForbiddenError` as `StudentNotAuthorizedError` so existing route
error mapping is unchanged); `tests/student-flag-service.test.js` (updated
to mock `visibilityService.assertCanViewStudent` instead of
`identityService.resolveActiveClassTutorPosition`); frontend: new Flag/
Clear flag action added to the Student Detail header dropdown
(`StudentRecord.jsx`), previously unbuilt for any role despite the backend
route and AI tools (`students_flag`/`students_flag_clear`) already
existing — closes the ROLE-COVERAGE.md gap flagging this as GUI-missing.

**Migration impact.** None — authorization-only change, no schema change.

**Status.** Resolved — implemented.

---

## ADL-030

### Staff page expansion — profile self-service, phone OTP, directory, assessment authoring, personal calendar

**Decision.** A batch of five staff-facing changes, decided together in one
product conversation and implemented together: (1) [RS-STF-013](../10-specification/RS-STF-staff.md#rs-stf-013)
widened — a staff member may now self-edit first/last name, contact email,
designation (fixed dropdown), appointment type, structured education
(doctorate/UG/PG), and work experience, on top of the fields already
self-service; (2) [RS-STF-014](../10-specification/RS-STF-staff.md#rs-stf-014)
added — self-reported mobile requires OTP verification, reusing RS-STU's
existing student-phone-OTP mechanism; (3) [RS-STF-015](../10-specification/RS-STF-staff.md#rs-stf-015)
added — any staff member may view a limited directory (name, designation,
department, phone) of every colleague, reversing the prior "self only"
default; (4) [RS-ASM-012](../10-specification/RS-ASM-assessment-documents.md#rs-asm-012)
added — any teaching staff member may create/name/edit their own assessment
type (was Principal-only), creator-only edit; (5) [RS-PRF-001](../10-specification/RS-PRF-personal-workspace.md#rs-prf-001)
widened — Personal Notes gains a `noteDate`, rendered as a calendar grid
merged (read-only, presentation-only merge) with the institutional calendar,
replacing the flat reminder-sorted list. Separately, [RS-STU-013](../10-specification/RS-STU-students.md#rs-stu-013)'s
flag remark changes from required to optional.

**Superseded position.** RS-STF-011/013 previously held appointment type,
education, and work experience as Principal-only ("administrative half").
`assertCanViewStaff` previously blocked an ordinary staff member from viewing
any colleague besides themselves. `assessment_types.create`/`.update` were
Principal-only ("institution-wide configuration, authorized administrators").
Personal Notes was explicitly a flat, reminder-sorted list with no date
association. RS-STU-013's flag remark was required, not optional.

**Rationale.** Raised directly by the product owner while reviewing the Staff
login end to end: a teacher should be able to maintain their own identity
details without waiting on the Principal for every change (splitting exactly
which fields per RS-STF-004/RS-STF-011's existing payroll/staff-code/
department carve-outs, none of which were named in the widening and so stay
Principal-only); phone OTP closes the trust gap a self-reported, suddenly-
self-editable number would otherwise open, by reusing a mechanism that
already exists rather than inventing a new one; a basic staff directory was
judged to have no real sensitivity reason to stay hidden between colleagues,
unlike the fields the directory deliberately excludes; assessment authoring
was widened because the actual protection against misuse — RS-ASM-002's
assigned-faculty check at mark-entry time — already exists independently of
who may name a type, so Principal-only creation was gatekeeping a low-risk
action; the personal calendar rebuild responds directly to how staff
described actually wanting to use it (a real calendar, not a flat list); and
the flag remark was made optional because an in-the-moment flag (e.g.
straight from Class Log after an incident) shouldn't be blocked on writing a
reason immediately.

**Affected artefacts.** Backend: `staffService.js` (`SELF_SERVICE_FIELDS`
widened; `first_name`/`last_name` kept in sync with `full_name`),
`staffPhoneVerificationService.js` (new, mirrors `phoneVerificationService.js`
exactly but targets `staff.phone`/`phone_verified`), `routes/staff.js`
(`POST /staff/me/phone-verification/otp`\|`verify`; `GET /staff` returns a
limited-field shape for `staff`/`class_tutor`), migration adding
`staff.first_name`/`last_name`/`email` and `staff_phone_otps` table;
`assessmentService.js` (`assertHasTeachingAssignment`, creator-only check in
`updateAssessmentType`), `permissions.js` (`assessment_types.create`/`.update`
widened to `['staff','class_tutor','hod','principal']`); `personalNoteService.js`/
`personalNoteRepository.js` (`noteDate` column, `listByUserInRange`);
`studentService.js` (`flagStudent`'s remark check removed). Frontend: new My
Profile edit screen + OTP verification UI, new Staff Directory page (Staff
nav), new assessment create/edit UI under Marks, new Personal Calendar page
(replaces the old flat notes panel), Flag dialog's remark field made
optional.

**Migration impact.** Additive only — new nullable columns
(`staff.first_name`/`last_name`/`email`, `personal_notes.note_date`), one new
table (`staff_phone_otps`, same shape as `student_phone_otps`). No backfill:
existing staff rows simply have NULLs for the new name-split/email columns
until self-edited; `full_name` remains populated and authoritative until then.

**Status.** Resolved — implemented.

---

## ADL-031

### Substitute request now checks the named candidate's department and actual availability

**Decision.** [RS-CLS-007](../10-specification/RS-CLS-classroom.md#rs-cls-007)
is tightened: `academicService.requestSubstituteAssignment` now rejects a
named substitute who (a) isn't in the same department as the class needing
coverage, or (b) doesn't actually have a free hour at that exact period/date —
checked against both their regular weekly `faculty_allocation` and any
existing `substitute_assignments` row for that period/date.

**Superseded position.** The function accepted any `substituteStaffUserId`
with zero eligibility checking — any staff member, any department, already
teaching or not, could be named and would sail through to a pending L3
approval request regardless.

**Rationale.** Raised directly by the product owner: a substitute should only
ever be requested from within the same department, and only if they
genuinely have a free hour then — otherwise the request either creates an
impossible double-booking or forces the wrong candidate onto a class outside
their subject area. Notably, RS-CLS-007's own prior text already promised
this ("AI suggesting who is genuinely free that period") — the checking logic
to back that claim simply didn't exist; this decision makes an existing
promise real rather than introducing a new one. Checked at request time
(not deferred to a confusing failure at approval) so the requester finds out
immediately if the person they named can't actually take it.

**Affected artefacts.** `academicService.requestSubstituteAssignment` (new
department + free-hour checks); three new error classes
(`SubstituteAssignmentCandidateNotFoundError`,
`SubstituteAssignmentCandidateNotInDepartmentError`,
`SubstituteAssignmentCandidateNotFreeError`); `routes/classes.js`'s
`mapAcademicServiceError` (404 / 422 / 409 respectively).

**Migration impact.** None — authorization/validation-only change, no schema
change. A substitute request that would previously have been accepted and
only failed later (or silently double-booked someone) is now rejected
immediately if it violates either rule.

**Status.** Resolved — implemented.

---

## ADL-032

### AI Conversations/Projects backend persistence, and a new ArtifactService

**Decision.** AI chat Conversations, Messages and Projects move from
client-side-only `localStorage` (`frontend/src/components/ai/lib/
conversationStorage.js`) to real, tenant-scoped, self-owned backend
persistence (`projects`, `conversations`, `messages` tables). Separately, a
new `ArtifactService` is introduced to own structured, editable AI-generated
content (markdown, versioned) as its own DB rows (`artifacts`,
`artifact_versions`) — distinct from `DocumentService`. An artifact only
becomes a real binary document when a user explicitly publishes it, at which
point `ArtifactService.publishArtifact` is the sole call site into
`DocumentService` (`uploadPersonalDocument`) for this whole slice. This
narrows ADR-009's "DocumentService owns all storage" to persistent **binary
file** storage specifically — see [ADR-009 Amendment 1](adr-register.md#adr-009).

**Superseded position.** The AI backend was, and remains, fully stateless
per turn (`aiService.js`'s `askAgent` still takes no history parameter and
creates no server-side session of its own — unchanged by this decision).
Prior to this decision, all conversation/message/project state existed only
in one browser's `localStorage`, explicitly documented in
`conversationStorage.js`'s own comment as "no backend concept exists" —
meaning a Project never actually grouped anything durable, and chat history
never survived a cleared browser or a second device. CLAUDE.md rule 2
previously read simply "`DocumentService` is the sole owner of file
storage," with no carve-out for structured, not-yet-published content.

**Rationale.** A Project only means something if there's real chat content
behind it — a thin backend Projects table referencing client-only
conversations would leave Projects fragile and per-device underneath, so
Conversations/Messages move server-side together with Projects, not
separately. Artifacts (AI-generated content saved for reuse/editing) were
found to have no existing backend or frontend concept at all —
`ArtifactViewer.jsx` is an unrelated, non-persisted "Draft" display for one
in-flight L2 AI turn, not a saved/reusable object. Splitting `ArtifactService`
from `DocumentService` — rather than storing every artifact as a file, or
inventing a second bare table that inevitably grows its own versioning/
status/ownership concerns anyway — keeps `DocumentService` focused on actual
binary file storage/lifecycle while giving artifacts room to be edited
cheaply (DB row updates) before a user decides something is worth
publishing. `messages` is immutable/append-only (same reasoning
`timetable_revisions` already established) with a relational
`parent_message_id`/`tool_params` shape replacing the frontend's ad-hoc
`regenerate` JSONB payload — regenerating a turn becomes "re-read the parent
user message's own columns," not a separate payload shape to construct or
parse. Artifact deletion is soft (`deleted_at`), matching
`documentRepository.js`'s own `archived_at`/`superseded_at` lifecycle-
timestamp pattern rather than a hard delete, since a draft artifact is
structurally a not-yet-published document. Publish is terminal in v1 (no
edit/republish) to avoid designing edit-after-publish reconciliation before
there's a real use case for it.

**Affected artefacts.** Migrations
`1761500000000_ai-conversations-and-projects.js` (projects, conversations,
messages, `messages_touch_conversation` trigger maintaining
`conversations.updated_at`/`message_count`/`last_message_preview`) and
`1761600000000_ai-artifacts.js` (artifacts, artifact_versions);
repositories `projectRepository.js`/`conversationRepository.js`/
`messageRepository.js`/`artifactRepository.js`/`artifactVersionRepository.js`;
services `projectService.js`/`conversationService.js`/`artifactService.js`;
routes `routes/projects.js`/`routes/conversations.js`/`routes/artifacts.js`,
registered in `tenantApp.js`; CLAUDE.md/AGENTS.md rule 2 reworded;
`adr-register.md` ADR-009 Amendment 1. Frontend:
`useConversations.js` rewritten onto React Query against the new API
(`replaceMessage` removed from its surface — its two callers no longer need
it under the new sequential-POST flow); `useAskAgent.js`/`useToolInvoke.js`
post the user message, then the assistant message, rather than an
optimistic placeholder patched in place; new `api/projects.js`/
`api/conversations.js`/`api/artifacts.js`; new minimal
`ProjectsListPage.jsx`/`ArtifactsListPage.jsx` (functional only — visual
design is separate, later work per
`docs/bka/50-frontend/FRONTEND-REDESIGN-HANDOFF.md`); "Save as artifact"
buttons added to `ArtifactViewer.jsx`/`MessageDocument.jsx`.

**Migration impact.** Additive only — five new tables, no existing table
touched. A user's pre-existing `localStorage` chat history is left alone,
neither migrated nor read by the new backend; new chats persist server-side
from this point on. Two real, user-visible behavior changes ship with this
slice: regenerating an in-thread answer now appends a new message instead of
overwriting the old one, and full message-body search in the conversation
list narrows to title-only (message bodies are no longer loaded up front for
every conversation) until a later server-side search param is built.

**Status.** Resolved — implemented.

## ADL-033

### Search-vs-empty-groups precedent for grouped/foldered list search

**Decision.** When a search/filter is added to any grouped-by-folder (or
similarly grouped) list, groups with zero matching items are hidden while a
search is active; they reappear once the search is cleared. First raised
for Staff Documents' Personal tab document search
(`docs/bka/60-product-reasoning/staff-documents-personal.md`) via a
Product Refinement question
([workflow §12/§15](../60-product-reasoning/00-workflow.md#15-step-12-product-refinement-strict-decision-threshold)),
answered by the user 2026-08-08.

**Superseded position.** No prior rule existed. Personal Documents'
existing "every registered folder shows, even empty" guarantee (recorded
in `StaffDocumentsPage.jsx`'s own code comment, and confirmed as `Existing`
in the Personal-tab reasoning pass) was written before search existed and
does not, by its own stated rationale, extend to an actively-filtered view
— it was silent on this case, which is why it met the Product Reasoning
workflow's decision threshold rather than being auto-classified.

**Rationale.** Hiding empty groups while searching keeps search results
legible (only relevant groups shown) without weakening the original
guarantee, which remains fully in effect for the normal, unfiltered view —
an empty folder still shows there. This precedent is recorded so future
Product Reasoning passes on other grouped/foldered lists (if any) can
follow it automatically under workflow §13's "if an existing ARCNAVE
pattern exists, follow it" rule instead of re-asking the same question.

**Affected artefacts.**
`docs/bka/60-product-reasoning/staff-documents-personal.md` (Document
Search feature contract, Approved Spec addendum). No application code yet
— this decision covers the Approved Spec `/build-slice`/`/wire-frontend`
will implement against, not an implementation already shipped.

**Migration impact.** None (no schema change; this governs client-side
filter display behavior only).

**Status.** Resolved — implemented (`frontend/src/features/documents/
pages/StaffDocumentsPage.jsx`'s `PersonalTab`, with behavior coverage in
`StaffDocumentsPage.test.jsx`).

---

## ADL-034

### L2 login/session model — Position Account vs delegated-in-staff-login

**Decision.** L2 **is** a real Position Account with its own `position_access`
session, identical in kind to L1/L3 — not a delegated capability surfaced
inside the holder's personal Staff login. Raised while compiling a
consolidated role-reference document
(`docs/bka/90-appendix/role-reference-platform-admin-L1-L4-staff.md`) and
found to be a direct textual contradiction between two normative passages
that were both marked "Conformant."

**The contradiction.** [RS-GOV-014](../10-specification/RS-GOV-governance.md#rs-gov-014)
stated "Whether L2 has its own login | **Never**" while
[RS-IDN-003](../10-specification/RS-IDN-identity.md#rs-idn-003) listed L2
alongside L1/L3 as getting a Position Account row, and
[RS-IDN-007](../10-specification/RS-IDN-identity.md#rs-idn-007)'s
Institutional Identity Context derivation table mechanically produces
`effectiveRole: 'level2'` from a `position_access` token — which only exists
for a Position Account session. RS-GOV-014's own Implementation field
already said as much ("`effectiveRole: 'level2'` produced only by the
Institutional resolver") without the surrounding prose noticing the
conflict.

**Resolution basis — checked against shipped code, not just re-read
harder.** `backend/src/services/positionAccountAuthService.js`'s
`assertLevelAllowsPositionLogin` explicitly allows Position Account login
for levels 1–3 (plus level 4 with `position_type='class_tutor'`), backed by
a full wired stack: `positionAccountInvitationService.js`,
`routes/positionAccounts.js`, the `position_accounts`/
`position_account_refresh_tokens` tables. This is real, reachable,
already-built behavior — reversing it to match the "Never has a login"
wording would have been a live backend change (removing L2 from the
eligibility guard, invitation flow, and routes), not a documentation fix.
Aligning the spec to the code was the lower-risk, already-correct path.

**Superseded wording.**
- RS-GOV-014: ~~"Whether L2 has its own login | **Never** — L2's duties
  surface inside the existing login of whoever holds them"~~ → now "Yes,
  where L2 exists — a real Position Account with its own `position_access`
  session."
- `actor-model.md` §3 table: L2's "Account type" cell previously omitted
  "Position Account" (the only level 1–4 row that did) and said "Duties
  surface inside an existing staff login" → corrected to "Position Account
  — own `position_access` session, per L1's configuration."
- `actor-model.md` §8: L2's "Never may" column previously said "Hold a
  separate login" → corrected to "Act without a resolved position context;
  hold institutional authority without the Institutional Identity Context"
  (the actual invariant — mirrors what L1/L3/L4 are each held to).

**What does not change.** The L2 optionality invariant
([RS-IDN-004](../10-specification/RS-IDN-identity.md#rs-idn-004),
`actor-model.md` §3.1) is untouched — L2 still may not exist at a given
college, and no rule/route/permission/invitation path may require it. This
decision is purely about the session mechanics *when* L2 does exist, not
about whether it must.

**Affected artefacts.**
[RS-GOV-014](../10-specification/RS-GOV-governance.md#rs-gov-014) (fixed),
`docs/bka/00-foundation/actor-model.md` §3/§8 tables (fixed),
[RS-IDN-003](../10-specification/RS-IDN-identity.md#rs-idn-003) and
[RS-IDN-007](../10-specification/RS-IDN-identity.md#rs-idn-007) (already
correct, no change needed),
`docs/bka/90-appendix/role-reference-platform-admin-L1-L4-staff.md` (role
reference, updated in the same pass).

**Migration impact.** None — no code changed. Documentation-only
correction to match already-shipped, already-Conformant behavior.

**Status.** Resolved — spec corrected to match shipped code, 2026-08-16.

---

## ADL-035

### Short-session conversation memory, scoped to one conversation

**Decision.** `askAgent`/`askAboutTool` may now be given the last 10
messages of the single conversation the current request already names —
never a broader history, never persisted as a new memory concept, never
cross-conversation or cross-session.

**Superseded position.** `aiService.js`'s own prior comment stated "every
`/ai/ask` call remains fully independent... takes no history parameter" —
a deliberate round-3 trade-off for a multi-tenant ERP (reject unbounded
persistent memory), not an oversight.

**Rationale.** Round 3 itself already recommended this narrow fix, not
"leave it stateless forever" — the concrete cost of full statelessness was
a chat *shell* that couldn't hold a follow-up question. Bounding by
message count (10) and by ownership (the same RLS-plus-actor-id check any
conversation read already uses) keeps the relaxation narrow: this is
"remember the last few turns of this one thread," not "remember this
user."

**Affected artefacts.**
[RS-AIG-017](../10-specification/RS-AIG-ai-governance.md#rs-aig-017)
(new).

**Migration impact.** None — additive read of already-stored conversation
messages, no schema change.

**Implementation notes.** `routes/ai.js`'s `resolveAskContext`
(`HISTORY_LIMIT = 10`) resolves the conversation through
`conversationService.resolveOwnConversation`'s existing ownership check
before slicing history; `aiService.js`'s `buildHistoryHint` renders it as
labelled background text explicitly marked superseded by the current
question, not as a structured multi-turn message array — the 4 provider
adapters' `complete()`/`completeWithTools()` interface only takes one
system/user prompt pair each, and widening that shape was out of scope
for this change.

**Status.** Resolved — implemented, 2026-08-21 (round 13).

---

## ADL-036

### Bounded multi-step workflow plan (`run_workflow_plan`)

**Decision.** One AI turn may span up to 6 tool calls via a single
proposed plan, each step re-entering the exact same Policy Gate a
standalone call uses, with one confirmation covering the whole plan.

**Superseded position.**
[RS-AIG-009](../10-specification/RS-AIG-ai-governance.md#rs-aig-009)
previously stated the agent selects exactly one tool per question and
that compound questions were unsupported, "requires its own scoped
decision" — this is that decision.

**Rationale.** Round 6/7's own design (a bounded engine: fixed tool set,
hard step cap, no recursive plan creation, per-step Policy Gate re-fire
via the existing `invokeTool` path rather than a new gate) was flagged in
round 10's audit as designed but never actually implemented — `askAgent`
invoked at most one tool per request. Implementing it exactly as designed
closes that doc/code divergence rather than reopening the design
question. The plan mechanism is also the concrete, load-bearing example of
why this codebase excludes arbitrary code execution: a plan step is
always one of the same GUI-parity Business Service tools, never free-form
code — the "no `run_any_code()`" boundary was previously stated only in
session narrative (`CHECKPOINT.md`), never in `bka/` itself.

**Affected artefacts.**
[RS-AIG-018](../10-specification/RS-AIG-ai-governance.md#rs-aig-018)
(new); [RS-AIG-009](../10-specification/RS-AIG-ai-governance.md#rs-aig-009)
(superseded declared limitation, corrected in place, same rule).

**Migration impact.** None — no schema change; `run_workflow_plan` is a
per-call construct, never a registered/stored tool.

**Implementation notes.** `aiService.js`: `buildPlanMetaTool`
(constructs the meta-tool per call, offered only alongside that turn's
already role/relevance-filtered real tools — never a superset),
`validatePlanSteps` (`MAX_PLAN_STEPS = 6`; rejects any step naming a tool
outside that same filtered set — the plan tool itself is never in that
set, so a step cannot name itself, making recursion structurally
impossible rather than merely disallowed), `resolvePlanSteps` (resolves
every step's preconditions before anything executes; one combined
confirmation if any step needs it), `executeWorkflowPlan` (fail-transparent
— a failed step is reported to the synthesis call, never silently
dropped), `groupStepsByParallelizability` (consecutive read-only,
low-risk steps only).

**Status.** Resolved — implemented, 2026-08-21 (round 13).

---

## ADL-037

### Numeric-claim verification is deterministic, advisory, and reuses already-fetched data

**Decision.** A numeric claim in an AI answer is checked against the same
sanitized tool-result data the answer was generated from — never a fresh
Business Service re-query, never a second model call — and the outcome
(`PASS`/`CONFLICT`/`INSUFFICIENT_EVIDENCE`) is surfaced to the caller,
never used to silently edit or block the answer.

**Superseded position.** An earlier design pass (recorded only in session
narrative, not in `bka/`) described this as "deterministic DB/tool
re-query, compare against the LLM's claim" — the real implementation
re-parses data already retrieved for the same request instead of issuing
a fresh query. Recorded here so the spec matches what actually shipped,
not the earlier design sketch.

**Rationale.** Re-parsing already-fetched data is strictly cheaper than a
second query and carries the identical guarantee for this specific
purpose (catching a claim that contradicts data already in hand) without
a second round-trip. Keeping the outcome advisory-only (never
auto-correcting or blocking) avoids a new, opaque failure mode where the
AI silently rewrites its own answer.

**Affected artefacts.**
[RS-AIG-019](../10-specification/RS-AIG-ai-governance.md#rs-aig-019)
(new).

**Migration impact.** None.

**Implementation notes.** `aiService.js`: `buildEvidence` (re-parses the
same `aiPromptSafetyLayer`-sanitized payload already produced for this
request), `buildEvidenceTrail` (renders it as a human-readable
source/count/timestamp trail), `verifyNumericClaims` (narrow
`COUNT_CLAIM_PATTERN` regex — deliberately narrow to avoid false
positives on years/roll numbers/percentages — compares claimed counts
against known, already-fetched record counts).

**Status.** Resolved — implemented, 2026-08-21 (round 13).

---

## ADL-038

### Trusted Web Retrieval: single SSRF-hardened tool, opt-in, domain-allowlisted, no search capability

**Decision.** One tool (`fetch_trusted_web_page`) fetches a single,
already-known `https://` URL against a per-college domain allowlist
(platform-default regulatory domains, non-removable, plus per-college
additions), opt-in per college, SSRF-hardened (https-only, no embedded
credentials, no IP literals, no redirects followed, bounded time/size),
result flowing through the same untrusted-data boundary every tool result
already carries.

**Superseded position.** None — this is a genuinely new capability, not a
correction. It closes P2.3 of the AI capability roadmap.

**Rationale.** No search API is configured anywhere in this codebase — a
retrieval tool against a known, already-trusted-domain URL is a bounded,
auditable capability; an open-ended search is a categorically different
(and much larger) trust surface this decision deliberately does not
grant. Web content, once fetched, is data like any other tool output —
[RS-AIG-003](../10-specification/RS-AIG-ai-governance.md#rs-aig-003)'s
existing untrusted-data boundary already covers it without needing a
special case; this decision is about *how a page may be reached*, not
about weakening what happens to it once reached.

**Affected artefacts.**
[RS-AIG-020](../10-specification/RS-AIG-ai-governance.md#rs-aig-020)
(new).

**Migration impact.** New per-college configuration category
(`web_retrieval`) on the existing generic `configurations` table — no new
table.

**Implementation notes.** `webRetrievalService.js`: `assertSafeUrl`
(https-only; rejects userinfo-embedded URLs; rejects IPv4/IPv6 literal
hostnames; `fetch(..., { redirect: 'error' })` never follows a redirect;
checked *before* the allowlist comparison so an attacker-controlled
hostname string never reaches that comparison in a form that could
confuse it), `hostnameIsAllowed` (exact-or-subdomain match only — guards
against a `ugc.gov.in.evil.com`-shaped bypass of a naive substring
check), `getWebRetrievalConfig` (opt-in `enabled` flag per college; a
10-second fetch timeout; a 2MB response-size expectation checked against
the `content-length` header — noted in the rule itself as checked
pre-body-read against the declared header, not a streamed byte count, a
minor known characteristic rather than a gap this decision treats as
unresolved); a 20,000-character extracted-text cap after HTML
stripping.

**Status.** Resolved — implemented, 2026-08-21 (round 13).

---

## ADL-039

### Scoped preference memory: AI tool restricted to 3 explicit keys, enforced in the handler

**Decision.** The `user_preferences_set` AI tool may only write
`report_format`, `default_chart`, or `language` — enforced by an explicit
allowlist check inside the tool's own handler, not only declared as a
JSON-schema `enum` hint.

**Superseded position.** The underlying `user_preferences_set` tool
previously had no key restriction at all, "by design, for a future
human-driven settings UI that doesn't exist yet" (per the tool's own
original comment) — a deliberately general-purpose store for a
not-yet-built human settings surface.

**Rationale.** `aiToolRegistry`'s generic parameter validator checks
required fields and array shape, but never enforces a schema's `enum`
values — a schema-only restriction would be a hint a sufficiently
adversarial or confused model could be talked past, not a real gate.
Restricting the *AI tool's handler* specifically (not the underlying
service, which stays general-purpose on purpose for the human settings UI
this was always meant to serve) means the enforcement is real regardless
of what the schema says. This is the bounded, safe form of "persistent AI
memory" the roadmap called for: explicit, structured, opt-in fields only —
never a freeform inferred fact about anyone, which would be an unbounded,
unauditable PII-retention risk this decision explicitly does not grant.

**Affected artefacts.**
[RS-AIG-021](../10-specification/RS-AIG-ai-governance.md#rs-aig-021)
(new).

**Migration impact.** None — reuses the existing `user_preferences`
table/service/RLS scoping unchanged; only the AI tool's own handler
gained a new check.

**Implementation notes.** `aiToolRegistry.js`:
`AI_ALLOWED_PREFERENCE_KEYS = ['report_format', 'default_chart',
'language']`, checked explicitly inside the `user_preferences_set`
handler in addition to the same list's declaration in the tool's JSON
schema `enum` (the schema declaration is a hint for the model, not the
enforcement). `userPreferenceService.setPreference` scopes the write by
both `collegeId` and `userId`.

**Status.** Resolved — implemented, 2026-08-21 (round 13).

---

## ADL-040

### General/Curriculum scope mode: structural tool-free path, not a softer prompt

**Decision.** A conversation's `mode` selects between two fully separate
code paths — Curriculum mode (the pre-existing tool-scoped path,
byte-for-byte unchanged) and General mode (a new path that never
constructs a tool list at all, so nothing exists for the Policy Gate to
re-fire against). Default is Curriculum everywhere a caller does not
explicitly opt into General, so no existing caller's behaviour changes.

**Superseded position.** None directly superseded — this replaces the
composer's prior Ask/Act toggle, which was a UI-only distinction with no
corresponding backend split; every request went through the same
tool-scoped path regardless of which the user had selected.

**Rationale.** The user's own framing: staff doing research, coursework,
or general questions unrelated to any college record shouldn't be boxed
in by a tool-selection prompt built for exactly college-record lookups —
but that breadth must never come at the cost of the Policy Gate. A softer
system-prompt instruction ("don't use tools for this kind of question")
was rejected as insufficient — a sufficiently adversarial or confused
model could ignore an instruction; removing the tool list from the call
entirely removes the capability regardless of what the model does with
the prompt. This is the same "structural, not conventional" discipline
[RS-AIG-018](../10-specification/RS-AIG-ai-governance.md#rs-aig-018)'s
plan mechanism already applies to recursion.

**Affected artefacts.**
[RS-AIG-023](../10-specification/RS-AIG-ai-governance.md#rs-aig-023)
(new).

**Migration impact.** None — no schema change; `mode` is a request
parameter, not stored state.

**Implementation notes.** `routes/ai.js` passes `mode` straight through to
`aiService.askAgent`. `askAgent`'s branch: `mode === 'general'` →
`askGeneralChat`, which calls `completeMaybeStreaming` (never
`completeWithTools` — no `tools` array is ever constructed in this
branch's own code path); anything else (missing, `'curriculum'`, an
unrecognized value) falls through to the unchanged, pre-existing
tool-scoped branch. `GENERAL_CHAT_SYSTEM_PROMPT` retains the same
identity-masking instruction as the Curriculum-mode prompt and states
explicitly that this mode has no access to the college's own data.

**Status.** Resolved — implemented, 2026-08-21 (round 18).

---

## ADL-041

### Attendance re-mark protected by the platform's existing optimistic-concurrency mechanism

**Decision.** A re-mark of an already-marked, still-unlocked attendance
session is now version-checked, reusing the exact
[RS-GOV-009](../10-specification/RS-GOV-governance.md#rs-gov-009)
pattern (a `version` column bumped on write, paired with an `audit_log`
row) `colleges`/`departments` already use — not a second mechanism.

**Superseded position.** None directly — this closes a real gap round 10's
audit flagged and round 11 deliberately deferred (P2, not P0/P1): the
first write for an hour was always a safe `INSERT` (nothing to race), but
a re-mark was a plain `UPDATE` with no version check at all, so two
concurrent re-marks of the same period silently resolved last-write-wins.

**Rationale.** A live-caught implementation detail changed the design
mid-pass: the first draft compared on `updated_at` (reasoning that this
table already bumps it on every write, so no new column was needed) —
live testing of a genuine, *non-concurrent, sequential* re-mark caught
this as broken. Postgres's `timestamp with time zone` has microsecond
precision; the `pg` driver deserializes it into a JS `Date`, which only
holds millisecond precision — round-tripping that value back out as a
query parameter for the version-check `WHERE` clause silently truncates
the sub-millisecond remainder, so the comparison almost never matched the
real stored value, regardless of whether a genuine race occurred. Fixed
by adding a real integer `version` column instead, matching
[RS-GOV-009](../10-specification/RS-GOV-governance.md#rs-gov-009)'s
already-proven pattern rather than reasoning about timestamp precision
from scratch.

**Affected artefacts.**
[RS-ATT-010](../10-specification/RS-ATT-attendance.md#rs-att-010) (new);
[RS-GOV-009](../10-specification/RS-GOV-governance.md#rs-gov-009)
(`Governs` cross-reference added, no rule text changed).

**Migration impact.** `1762800000000_attendance-sessions-version` adds
`attendance_sessions.version integer NOT NULL DEFAULT 1`. Reversible
(`DROP COLUMN`).

**Implementation notes.** `attendanceRepository.updateWithVersionCheck`
(new — `WHERE id = $1 AND deleted_at IS NULL AND version = $2`, sets
`version = version + 1`); `attendanceService.markAttendance`'s re-mark
branch now calls it with `existing.version`, throwing the new
`AttendanceReMarkConflictError` (409, mapped in `routes/attendance.js`
and `routes/ai.js`) when the version has moved. A losing caller's write
is never silently discarded — it gets a clean, actionable conflict
instead.

**Status.** Resolved — implemented, 2026-08-21 (round 22).

---

## ADL-042

### `marksObtained` range validation (non-negative, bounded by `max_marks`)

**Decision.** `recordMark`/`updateMark` now reject a negative
`marksObtained` unconditionally, and reject one exceeding the assessment
type's own `max_marks` whenever that value is actually set.

**Superseded position.** None directly — round 10's audit found no
range/sanity check existed at all, distinct from
[RS-ASM-002](../10-specification/RS-ASM-assessment-documents.md#rs-asm-002)'s
"no grade/weightage calculation" rule (that rule is about not *deriving* a
second number from `marksObtained`, never about accepting an impossible
one).

**Rationale.** `max_marks` is genuinely optional at the schema level
([RS-ASM-012](../10-specification/RS-ASM-assessment-documents.md#rs-asm-012):
an assessment type may have none), so a hard cross-field CHECK constraint
at the database level cannot express the upper bound generically — CHECK
constraints are single-table. Split accordingly: the non-negative floor
(which has no such exception) is a real, un-bypassable DB constraint; the
`max_marks` ceiling is an application-level check, run once
`assessmentTypeRepository.findById` resolves whether one exists. Checked
*after* the existing batch-editable gate (`assertBatchDraft`), not
before, so a batch that cannot be directly edited at all still rejects on
that state — value validation never masks a state-conflict error.

**Affected artefacts.**
[RS-ASM-013](../10-specification/RS-ASM-assessment-documents.md#rs-asm-013)
(new). Also surfaced, not resolved: the batch draft/lock/submit lifecycle
`updateMark` itself belongs to has no dedicated `RS-ASM` rule at all —
flagged in RS-ASM-013's own text as a real, pre-existing documentation
gap, materially larger than this decision's own scope.

**Migration impact.**
`1762600000000_assessment-marks-non-negative-check` adds
`CHECK (marks_obtained >= 0)` to `assessment_marks`. Verified against the
real table first (zero existing negative rows) before writing the
migration, not assumed. Reversible (`DROP CONSTRAINT`).

**Implementation notes.** `assessmentService.assertMarksInRange`, called
from both `recordMark` (after `findBatchStatus`/`assertBatchDraft`) and
`updateMark` (same ordering). New tests mock
`assessmentTypeRepository.findById` explicitly rather than relying on
whatever it happened to resolve to from an earlier test's own mock —
codebase's `t.mock.method`/`t.after()` restore pattern is per-subtest,
but a test that never mocks a dependency its own call path now reaches
is exposed to whatever the *previous* test in file order left behind;
made explicit here to avoid that class of flakiness.

**Status.** Resolved — implemented, 2026-08-21 (round 22).

---

## ADL-043

### DocumentService upload: compensating cleanup on both immediate and deferred failure

**Decision.** `documentService.uploadDocument`'s disk write is now
compensated in both failure windows: the row's own `INSERT` failing
immediately (synchronous cleanup, same call), and a *later*, unrelated
statement in the same request's transaction failing and rolling
everything back after the row appeared to succeed (deferred cleanup, via
a new `registerAfterRollback` mechanism).

**Superseded position.** None directly — round 10's audit found the
second window entirely unhandled: the immediate-failure case already had
a `try`/`catch` around `documentRepository.create`, but nothing existed
for a rollback caused by a statement *after* `uploadDocument` itself had
already returned.

**Rationale.** The existing `registerAfterCommit`
(`db/tenantTransaction.js`, built round 11 for
`backgroundJobService.enqueue`'s worker trigger) is the established
precedent for "defer work until this request's transaction has actually
settled" — but it fires on the opposite outcome (commit, not rollback)
and, critically, must be *discarded* rather than fired if the OTHER
outcome happens, which `registerAfterCommit` itself has no need to do
(nothing was ever queued for the opposite case there). `registerAfterCommit`
also falls back to firing immediately with no request context (safe,
since "no context" there means "nothing to defer against, run now"); the
mirror-image fallback for rollback would mean the opposite — unconditionally
deleting a file this function has no way to know will actually need
deleting — so `registerAfterRollback` deliberately does NOT fire when
there is no request context; a caller outside the normal HTTP/transaction
lifecycle is expected to manage its own cleanup.

**Affected artefacts.**
[RS-ASM-014](../10-specification/RS-ASM-assessment-documents.md#rs-asm-014)
(new); [RS-ASM-005](../10-specification/RS-ASM-assessment-documents.md#rs-asm-005)
(`Governs` cross-reference added, no rule text changed).

**Migration impact.** None — no schema change.

**Implementation notes.** `logging/context.js`'s new
`AFTER_ROLLBACK_CALLBACKS` Symbol (mirrors `AFTER_COMMIT_CALLBACKS`, same
reasoning for staying a Symbol key — kept out of the generic per-request
log payload); `middleware/requestContext.js`'s initial store now seeds
both; `db/tenantTransaction.js`'s `commitAndRelease` discards the queue
(never fires it) on a successful commit, `rollbackAndRelease` drains and
fires it, each callback isolated in its own try/catch, only once
`ROLLBACK` has actually completed. `documentService.uploadDocument`
registers the cleanup right after the row commits to this request's
still-open transaction — a no-op once the transaction actually commits.

**Status.** Resolved — implemented, 2026-08-21 (round 22).

---

## ADL-044

### AI tool invocation audit trail: handler failures, provider/model, workflow-request linkage

**Decision.** Every AI tool invocation attempt now writes exactly one
audit row regardless of outcome — a genuine Business Service failure
(new `ai_tool_handler_failed` action) is audited exactly as a Policy Gate
rejection (`ai_tool_denied`) and a success (`ai_tool_invoked`) already
were. Separately, a successful `ai_tool_invoked` row now also records
`provider`/`model` (when the calling context is LLM-mediated) and, for an
L3 result, the `workflow_requests` row it produced.

**Superseded position.** None directly — round 10's audit found both gaps
real and unaddressed: `aiToolRegistry.js`'s `invokeTool` had a try/catch
around the L3-bypass backstop check but none around `tool.handler` itself;
`aiService.js`'s `invokeTool` metadata carried only
`toolName`/`estimatedAffectedRows`.

**Rationale.** The handler-failure gap is closed with the same
audit-then-rethrow shape already established for Policy Gate rejections
in the same function — `ai_tool_handler_failed` is a distinct action name
specifically so it is never conflated with `ai_tool_denied` (an
authorization outcome, not an execution failure). The metadata gap is
closed additively, threading already-resolved values rather than
re-deriving them: `provider`/`model` come from whichever adapter/config
the calling context (`askAgent`, `askAboutTool`, each
`executeWorkflowPlan` step) had already resolved for its own LLM call —
`executeWorkflowPlan` itself was reordered so that resolution happens
*before* the step loop instead of after it, purely a config read with no
dependency on step results, so nothing about execution order changes.
`workflowRequestId` is read directly off the handler's own returned
result (`result.workflow_request_id`) rather than a second query — every
L3 handler in this registry already returns the entity row it just
updated, and that row already carries the FK as a plain column
(`notificationService.submitForApproval` and its siblings). The one call
site that never gets `provider`/`model` — `invokeToolIdempotent`,
`POST /ai/tools/:name/invoke` — is correct as-is: no LLM chose that
call, so there is nothing to record; the fields are simply omitted, never
recorded as `null`.

**Affected artefacts.**
[RS-AIG-024](../10-specification/RS-AIG-ai-governance.md#rs-aig-024)
(new); [RS-AIG-001](../10-specification/RS-AIG-ai-governance.md#rs-aig-001),
[RS-AIG-022](../10-specification/RS-AIG-ai-governance.md#rs-aig-022)
(`Governs` cross-references added, no rule text changed).

**Migration impact.** None — additive JSONB metadata on the existing
`audit_log` table, no schema change.

**Implementation notes.** `aiToolRegistry.js`'s `invokeTool` wraps
`tool.handler(...)` in try/catch (`ai_tool_handler_failed`, metadata
`{toolName, errorName, reason}`, rethrows after logging).
`aiService.js`'s `invokeTool` gains optional `provider`/`model` params;
callers: `askAboutTool` (aiConfig resolution moved before the
`invokeTool` call — a config read, not the LLM call itself, so the
existing "tool call audited regardless of downstream LLM failure"
ordering is unaffected), `askAgent`'s direct tool-call branch (adapter
already resolved earlier in the function), `runPlanStep` (new
`adapter`/`aiConfig` params, threaded from `executeWorkflowPlan`).

**Status.** Resolved — implemented, 2026-08-21 (round 22).

---

## ADL-045

### General mode renamed to Research mode (label only)

**Decision.** The user-facing label for the tool-free chat mode changes
from "General" to "Research". The wire-level `mode` parameter value stays
the literal string `'general'` everywhere (routes, service, frontend
state, `GENERAL_CHAT_SYSTEM_PROMPT`'s internal purpose name) — this is a
presentation rename, not a protocol change. "Curriculum" (the DB-access,
policy-gated mode) is unchanged.

**Superseded position.** [RS-AIG-023](../10-specification/RS-AIG-ai-governance.md#rs-aig-023)
previously named the two modes "Curriculum mode" and "General mode" in its
own rule prose.

**Rationale.** User's own framing (2026-08-22): "Research" more accurately
describes the mode's purpose to campus staff than the internal engineering
term "General" — the mode exists specifically for research/coursework/
new-tech questions unrelated to any college record, per round 18's
original design intent. Resolved directly by user answer to
`AskUserQuestion` (no ambiguity — "Research (no DB) / Curriculum (DB
access)" was the explicit, only chosen option), not a case the workflow's
§15 threshold would otherwise have escalated on its own (a label is
cosmetic), but recorded here because it changes a system-invariant rule's
own prose, not just UI copy.

**Affected artefacts.**
[RS-AIG-023](../10-specification/RS-AIG-ai-governance.md#rs-aig-023)
(prose only — mechanism unchanged); `frontend/src/components/ScopeToggle.jsx`
(`LABEL.general`); `backend/src/services/aiService.js`
(`GENERAL_CHAT_SYSTEM_PROMPT` text referring to "General mode").

**Migration impact.** None. No schema, no API contract change — `mode`
values, DB columns, and stored conversation data are untouched.

**Implementation notes.** Change the label string only; grep for every
literal "General mode"/"General" occurrence in user-facing (not
wire-level) text before considering this done, since a partial rename
would leave the product referring to itself by two different names.

**Status.** Resolved — implemented, 2026-08-22.

---

## ADL-046

### New AI capability: opt-in image generation (L2)

**Decision.** A new AI tool, `generate_image`, is added: classified `L2`
(Generate — RS-AIG-001's ceiling for artifact-producing tools with no
external effect, same class as `generate_document`), per-college opt-in
(off by default), provider-limited to adapters with a real
vendor image-generation API (OpenAI, Gemini at launch — Claude/NIM/
self-hosted raise the existing `AiProviderCapabilityError`, the same
mechanism `claude.js` already uses for its missing `embed()`). Generated
binaries are stored via the existing `documentService.uploadPersonalDocument`
path — no new storage mechanism (CLAUDE.md rule 2).

**Superseded position.** None — this is a genuinely new AI capability.
Per [RS-AIG](../10-specification/RS-AIG-ai-governance.md)'s own governing
principle ("if a new AI capability is proposed and it is not obviously
covered by this domain, it is not built until it is"), a new rule
(`RS-AIG-025`) is required before this is built, not an extension of an
existing one.

**Rationale.** User's explicit request (2026-08-22), scoped through three
rounds of `AskUserQuestion` clarification confirming this is a genuinely
new capability, not vision/analysis of an uploaded image (already built,
unrelated). Authority level, opt-in posture, and provider-limitation are
each settled by an already-established pattern rather than a fresh design
choice: `L2` follows directly from RS-AIG-001's existing table (no
external effect, same class as PDF/Word/Excel generation); per-college
opt-in mirrors RS-AIG-020's Trusted Web Retrieval precedent (a costly,
potentially-abusable capability, off by default, no new migration —
reuses the existing `configurationService`/`configurations` table);
provider-limitation follows RS-AIG-008's "provider is configurable, never
architecturally load-bearing" principle — the capability's presence is a
property of which adapter object exposes `generateImage`, never a
hardcoded provider-name branch outside `aiProviders/`.

**Affected artefacts.**
[RS-AIG-025](../10-specification/RS-AIG-ai-governance.md#rs-aig-025) (new);
[RS-AIG-001](../10-specification/RS-AIG-ai-governance.md#rs-aig-001),
[RS-AIG-008](../10-specification/RS-AIG-ai-governance.md#rs-aig-008),
[RS-AIG-020](../10-specification/RS-AIG-ai-governance.md#rs-aig-020)
(`Governs` cross-references added, no rule text changed);
`aiToolRegistry.js` (new `generate_image` tool); `aiProviders/openai.js`,
`aiProviders/gemini.js` (new `generateImage` method); `documentService.js`
(no change — existing `uploadPersonalDocument` reused); `configurationService`
(no change — existing category mechanism reused, new category name
`image_generation` only).

**Migration impact.** None. Opt-in flag reuses the existing generic
`configurations` table (same mechanism as Trusted Web Retrieval's
allowlist) — no new table or column.

**Implementation notes.** Register `generate_image` following
`generate_document`'s exact shape (`aiToolRegistry.js:2764-2794`) —
`params: { prompt }` only, `additionalProperties: false`, no free-form
fields (RS-AIG-002). Gate the opt-in check exactly where Trusted Web
Retrieval's own precedent actually puts it (verified against the real
registration, not assumed): `fetch_trusted_web_page` is always present in
the offered tool list, and `webRetrievalService.fetchTrustedPage` itself
throws `WebRetrievalNotEnabledError` at invocation time when the college
hasn't opted in — a real, already-shipped, already-tested runtime check
inside the Business Service, not list-filtering. `generate_image` mirrors
this exactly: always listed, `imageGenerationService` (or the tool's own
handler calling `configurationService`'s new `image_generation` category
read) throws the equivalent not-enabled error at call time. A provider
lacking `generateImage` must fail the same structural way `claude.js`'s
missing `embed()` already does — no adapter-specific branch anywhere
outside `aiProviders/`.

**Status.** Resolved — pending implementation.

---

## ADL-047

### Conversation history: character budget replaces flat message-count cap

**Decision.** `routes/ai.js`'s `HISTORY_LIMIT = 20` (a raw message-count
slice, applied before `aiService.js` ever sees the data) is replaced by a
two-stage design: `routes/ai.js`'s renamed `HISTORY_MESSAGE_CEILING = 200`
now bounds only DB/memory fetch cost, and `aiService.buildHistoryHint`
applies the real limit — a character budget (`DEFAULT_HISTORY_CHAR_BUDGET
= 100,000`), keeping the most recent turns and dropping the oldest first
once exceeded, always preserving at least the single most recent turn.

**Superseded position.** [RS-AIG-017](../10-specification/RS-AIG-ai-governance.md#rs-aig-017)'s
own implementation note named `HISTORY_LIMIT = 10` (later raised to 20 in
round 29, per `CHECKPOINT.md`, never reconciled back into the rule text) —
the rule's actual invariant ("bounded, per-conversation, never a
persistent cross-session memory") is unchanged; only the mechanism that
enforces "bounded" changes, from a raw count to a character budget.

**Rationale.** User's own framing (2026-08-22): a flat 20-message cap
behaves nothing like a real large-context assistant (their own comparison:
"Claude Code has a 1M context window") — a fixed count discards context
inconsistently (20 short messages could still lose an old, unfinished,
still-relevant topic; 20 long messages could overflow a small-window
provider). A character budget is the direct fix and mirrors an already-
established pattern in this exact file: `ATTACHMENT_BUDGET_BY_PROVIDER`/
`allocateAttachmentBudget` (round 27) already solved the identical
"provider window varies, a raw count doesn't account for it" problem for
attachments. **Deliberately not made provider-aware at this call site**,
for the same reason `buildAttachmentHint`'s own existing comment already
gives: the provider adapter isn't resolved yet at the point `askAgent`
builds this hint (`askGeneralChat` vs. the Curriculum tool-selection path
each resolve their own adapter independently, later), and disturbing that
test-asserted call order to learn the provider a few lines earlier isn't
worth it for this pass — `buildHistoryHint` accepts an explicit
`charBudget` override for any future caller that already knows its
adapter. `DEFAULT_HISTORY_CHAR_BUDGET = 100,000` was chosen to leave real
headroom stacked alongside `DEFAULT_ATTACHMENT_TOTAL_CHAR_BUDGET`'s own up
to 200,000 chars, the system prompt, and tool schemas, within NIM's
128K-token default window (ADR-028) — the same provider whose real,
previously-caught context-overflow incident (round 27) is why the
attachment budget's default is conservative in the first place.

**Affected artefacts.**
[RS-AIG-017](../10-specification/RS-AIG-ai-governance.md#rs-aig-017)
(implementation note only — mechanism, not the invariant); `routes/ai.js`
(`HISTORY_LIMIT` renamed `HISTORY_MESSAGE_CEILING`, 20 → 200);
`aiService.js`'s `buildHistoryHint` (new `charBudget` parameter,
`DEFAULT_HISTORY_CHAR_BUDGET`).

**Migration impact.** None — no schema or API contract change.

**Implementation notes.** Truncation walks the turns list from the end
(most recent) backward, accumulating length, and always keeps at least
one turn (the newest) even if that single turn alone exceeds the budget —
never returns an empty hint just because the newest turn is large. A
truncation note ("N earlier turn(s) omitted") is appended only when
turns were actually dropped, so the model (and, transitively, a human
reading a transcript) can tell the difference between "nothing older
existed" and "older context was trimmed."

**Status.** Resolved — implemented, 2026-08-22.

---

## ADL-048

### Per-message visible token usage, captured on the streaming path

**Decision.** Real per-vendor token usage (`{inputTokens, outputTokens}`)
is now captured on the streaming path too (previously non-streaming only,
`aiService.js`'s own `logLlmCall` comment had flagged this gap as
deliberately deferred, not an oversight) and persisted on the assistant's
own `messages` row (new nullable `input_tokens`/`output_tokens` columns),
rendered as a small, understated line under the reply — a plain token
count, never a dollar figure.

**Superseded position.** None directly — this closes an already-recorded,
explicitly-deferred gap (`CHECKPOINT.md`'s P1 item 6: "User-facing usage
display is a separate, later concern from internal billing").

**Rationale.** User's own request (2026-08-22), explicitly framed as
"however Claude handles this" — Claude Code's own usage indicator is
understated and developer-adjacent, never a prominent cost figure, which
is why this renders `"120 in · 45 out tokens"`-style text, not a `$`
amount (the existing `logLlmCall` comment already gives the reason $
estimation is out of scope: pricing drifts per model/vendor faster than
this codebase should hardcode a table). Each provider adapter's own
`completeStream` reports usage only when the real vendor stream actually
carried it — Anthropic's `message_start`/`message_delta` events, an
OpenAI-compatible `stream_options.include_usage` final chunk (nim, openai,
self-hosted), Gemini's per-chunk cumulative `usageMetadata` — via a new
optional `onUsage` callback mirroring the existing `onDelta` pattern
exactly, so `completeStream`'s own return value (a plain string) is
unchanged and no existing test asserting that shape breaks.
`completeMaybeStreaming`'s return shape changes internally, from a bare
string to `{text, usage}` — safe because it is not itself exported or
directly unit-tested (only exercised indirectly through `askAgent`'s full
result), so every one of its ~5 call sites inside `aiService.js` was
updated together, in the same pass, to thread `usage` into its own
returned result object.

**Affected artefacts.** `aiProviders/{nim,openai,selfHosted}.js`
(`stream_options.include_usage`, final-chunk `usage`);
`aiProviders/claude.js` (`message_start`/`message_delta` usage);
`aiProviders/gemini.js` (`attemptStream`'s per-chunk `usageMetadata`,
only the succeeding attempt's usage ever reported); `aiService.js`
(`completeMaybeStreaming`, `askGeneralChat`, `askAboutTool`,
`executeWorkflowPlan`'s synthesis, `summarizeToolResult`/askAgent's
tool_call branch — each now returns/threads `usage`); new migration
`1763300000000_message-token-usage.js`; `messageRepository.js`
(`COLUMNS`); `conversationService.addMessage`; `routes/conversations.js`
(`input_tokens`/`output_tokens` wire fields); frontend
`api/conversations.js`, `WorkspaceProvider.jsx` (`runAiTurn`/`seedThread`),
`ChatMessage.jsx` (`UsageLine`).

**Migration impact.** Additive only — two new nullable `INTEGER` columns
on `messages`, populated at INSERT time (never a later UPDATE), so no
column-level `UPDATE` grant is needed beyond the existing table-level
`INSERT` grant.

**Implementation notes.** Usage is genuinely absent (never fabricated as
`0`) for: a message sent before this migration, a provider/path whose
vendor stream never returned a usage block, a stream interrupted before
the usage-bearing final event arrived, or Gemini's own discarded
empty-thinking-budget retry attempts (only the attempt that actually
`sawAnyText` ever reports usage). `UsageLine` (`ChatMessage.jsx`) renders
nothing in every one of these cases rather than a placeholder.

---

## ADL-049

### ARCNAVE Context Architecture — structured context replaces flat prompt strings

**Decision.** `aiService.js` stops building a flat `{systemPrompt,
userPrompt, tools, images}` string pair and instead builds an internal
`ARCNAVE Context`: an ordered list of segments, each tagged `static` /
`conversation-scoped` / `turn-scoped` / `volatile`, plus a fingerprint (hash)
of the `static` + `conversation-scoped` segments for cache-identity
purposes only (never caching logic itself, which stays entirely inside each
provider adapter). `AGENT_SYSTEM_PROMPT` and `CONVERSATIONAL_POLICY` — two
undifferentiated ~9,162-char blobs sent on every call regardless of
relevance — are replaced by a small, fixed, enumerated, **monotonic**
module set (`CORE`, `CONTINUITY`, `TOOL_SELECTION`, `PLAN`, `FILE`,
`ARTIFACT`) assembled by a pure, synchronous function of already-known
structural state, never message semantics and never an LLM classifier call.
Turn-specific guidance (tool-result reporting style, ₹ formatting, scope-
substitution disclosure, image-unavailable note, emotional-register
guidance) moves out of the system prompt entirely, into the message stream
attached to its own turn. Provider-specific behavioral corrections (already
real and already in the code — see Rationale) become a small, bounded,
optional per-adapter addendum, never an `if (provider === 'x')` branch
inside a shared policy module. Full text: [ADR-030](adr-register.md#adr-030).

**Superseded position.** None directly. `AGENT_SYSTEM_PROMPT` and
`CONVERSATIONAL_POLICY` (introduced across earlier rounds — see their own
in-code comments in `aiService.js` at the lines cited below) remain in force
unchanged until P1 of this ADR's phasing executes; this entry records the
target architecture and the sequencing to reach it, not an immediate code
change.

**Rationale.** Triggered by measuring a fresh, history-free `"hi"` at
~2,387 input tokens after semantic tool retrieval (round 32,
[ADL-041](#adl-041) et seq.) had already fixed the larger, earlier all-69-
tools-sent defect. Tracing the remainder found it was almost entirely
`identityBlock + AGENT_SYSTEM_PROMPT + CONVERSATIONAL_POLICY`
(`aiService.js` ~9,162 chars ≈ 2,300 tokens), sent unconditionally on every
call. Further review found two things that outweigh the token count itself:
(1) `identityBlock` (per-user/per-college, `aiActorContext.js`) is
concatenated *before* the static policy text at `aiService.js`'s decision-
call site (~line 1598-1600) and general-chat site (~line 1486-1488) — this
breaks prefix-cache eligibility for any provider's caching mechanism
immediately, regardless of prompt size, and is fixed for free by reordering
text with no behavior change (P0 of the phasing); (2) the tool-selection
"decision" call and the post-tool "answer" call
(`aiService.js` ~line 1608 and ~line 1443) are independent one-shot
requests, each carrying its own full copy of `CONVERSATIONAL_POLICY` and the
serialized history hint (`buildHistoryHint`, `DEFAULT_HISTORY_CHAR_BUDGET =
100_000` chars ≈ 23,000 tokens) — a larger, duplicated-context cost on every
real tool turn than the `"hi"` case that prompted the review, forced by the
adapter interface only ever accepting one `systemPrompt`/`userPrompt` pair
rather than a real conversation/tool-loop structure. Modularizing the
policy (rather than only shortening it) is chosen over prompt compression
alone because every clause in the current two constants is a fix for a
real, previously live-caught failure — documented in `aiService.js`'s own
comments: a tool-happy `meta/llama-3.1-8b-instruct` calling
`get_college_profile` for "capital of France" (~line 69); Gemini
self-identifying as "I am Gemini... built by Google" (~line 78); two vague
messages in a row producing the same capability-list greeting twice
(~line 131); `update_artifact_content` never getting called without
explicit naming, chat text alone never actually updating the artifact
(~line 274). Deleting words risks silently reintroducing any of these;
gating a rule on the state where it's actually needed does not. An LLM
classification step ("is this a tool request?") before policy assembly was
considered and rejected: every predicate policy assembly needs
(`historyHint !== ''`, `tools.length` `>0`/`>=2`, images/documents present,
`focusContext`/`projectContext` present, call stage, tool L1/L2/L3 level)
is already known deterministically before any model call. Policy selection
via embedding/semantic retrieval — the same mechanism that fixed tool
selection — was also considered and rejected as a false analogy: ~69 tools
vs. ~8 policy modules, and a missed tool produces a visible "I can't do
that" while a missed policy module produces a silent behavioral regression
found in production, not at request time.

**Affected artefacts.** `aiService.js` (`AGENT_SYSTEM_PROMPT`,
`CONVERSATIONAL_POLICY`, `GENERAL_CHAT_SYSTEM_PROMPT`,
`TOOL_RESULT_ANSWER_SYSTEM_PROMPT`, `buildHistoryHint`,
`buildPlanMetaTool`/`PLAN_TOOL_NAME`, `askGeneralChat`, `askAgent`, and the
decision/answer call sites — full rewrite across P1/P2 of the phasing, not
this entry); `aiProviders/{claude,gemini,openai,nim,selfHosted}.js` and
`aiProviders/index.js` (native per-adapter request builders, P2b — all five
already implement `completeWithMeta`/`completeStream`/`completeWithTools`
today, so this is an upgrade to the existing seam, not a new one);
`aiPromptSafetyLayer.js` (unaffected — already structural, not prompt-only,
per its own file comment); `documentSearchService.js` (~line 226, ~line
293 — folded into P0 as a correctness fix, not later optimization: still
resolves embeddings via the chat provider's own adapter instead of the
already-built `embeddingService.js`, so a college on an adapter with no
`embed()` silently loses document search); `ai_document_chunks` and
`ai_tool_embeddings` migrations (both `vector(1024)` hard-coded, no `model`
column — also folded into P0, since a provider/model change today would
silently leave old rows in the wrong vector space with no detection,
`ensureEmbeddings`'s self-healing backfill in `aiToolRetrievalService.js`
checking tool-name existence only).

**Migration impact.** None in this entry — P0 is text-reorder plus
telemetry plus a `model` column addition (additive), P1/P2 are code-only
restructuring of the same request shape, no schema change beyond the P0
column. Full schema impact, if any, to be recorded against whichever
phase's own ledger entry introduces it.

**Implementation notes.** Phasing is deliberately incremental, not a single
migration: P0 (reorder + telemetry + plan-tool gating + the two
correctness fixes) → P0.5 (assembly tests + provider behavioral suite,
required before any policy text is rewritten) → P1 (modularize, rewrite
only `CORE`) → P2a (introduce the context representation, adapters flatten
back to today's shape — a pure refactor, existing tests in
`backend/tests/ai-service.test.js`/`ai.test.js` should pass unchanged) →
P2b (native builders, Gemini first) → P2c (real tool-use loop, eliminating
the duplicated decision/answer context) → P3 (provider-specific caching,
only after P0's telemetry shows what a clean prefix buys — not scoped as a
project until measured). P0's reorder step alone will show no measured
token/cost improvement by itself — it is an enabling change for P3, not a
savings, and should not be judged or reverted on that basis. Session detail
and exact next action: [`70-checkpoint/CURRENT-STATE.md`](../70-checkpoint/CURRENT-STATE.md).

## ADL-050

### ADR-030 P2(b) native Gemini request builder — implemented, then empirically rejected

**Decision.** Do not ship a native per-adapter Gemini request builder that
maps each `system`-targeted `ARCNAVE Context` segment to its own
`systemInstruction.parts` entry (instead of joining every segment into one
string first, as the P2(a) flattening shim does). `gemini.js` stays on the
P2(a) shim. This is not "not started" — it was designed, planned (plan
mode, user-approved), implemented, and unit-tested, then reverted after
live evidence.

**Superseded position.** None — the P2(a) flattening shim
(`aiContextAssembly.flattenToPrompts`, `gemini.js` unchanged from its
P2(a) form) remains in force. This entry records a completed, rejected
experiment, not a pending item.

**What was built.** A `buildRequest(context)` function in `gemini.js`
replacing all 3 of its request-building call sites
(`completeWithMeta`/`attemptStream`/`completeWithTools`)'s
`flattenToPrompts` calls: each `system`-targeted segment became its own
`{ text }` part (with the P2(a) shim's `'\n\n'` join separator baked into
each non-final segment's own part text, so reconstruction stayed
byte-identical to `flattenToPrompts`'s joined string — a fix a Plan-agent
design review required before approving the plan), same treatment for
`user`-targeted segments after any image parts. 5 new unit tests proved
wire-shape correctness, including an explicit reconstruction-equality
assertion. Full backend suite: 2094/2096 (same 2 pre-existing unrelated
failures, +5 new tests, zero regressions). Live-DB `ai.test.js`: 28/28,
unchanged.

**Why it was rejected anyway.** The Plan-agent review that approved the
design flagged one thing unit tests structurally cannot prove: "the model
may still behave slightly differently because Gemini receives multiple
parts rather than one text part... only a real model call can settle it."
That risk materialized. The live behavioral suite's `e1` scenario ("can
you make me a PDF of the attendance report?" with no attendance data on
record) tests the `FILE` policy module's rule "NEVER tell the user you
cannot produce a document" (`aiPolicyAssembly.js:136`). A single live run
showed `E: document-capability claim` dropping from the P2(a) baseline's
3/3 to 2/3. Because Gemini's own thinking-budget behavior is documented
elsewhere in this codebase as genuinely non-deterministic
(`gemini.js`'s own `MAX_EMPTY_RETRIES` comment), a single scenario flip
isn't enough signal on its own — so `e1` was isolated and re-run
repeatedly against both the old (joined-string) and new (native-parts)
code, via a temporary `SCENARIO_FILTER` env var added to
`ai-behavioral-suite.js` for this diagnosis only (not shipped — reverted
along with the rest): **old code: 3/4 valid live samples passed (75%);
new code: 2/7 valid live samples passed (29%)**, gathered across a mix of
full-suite runs and isolated single-scenario runs, discounting only
genuine network-timeout attempts (a separate, unrelated Docker/DNS
flakiness observed mid-session) as inconclusive. Same instruction text
both times — `flattenToPrompts(context).systemPrompt` and the
reconstructed native-parts text are provably byte-identical (that was the
whole point of the reconstruction test) — the only variable that changed
is whether Gemini received that text as 1 `systemInstruction` part or 3.
Splitting a system instruction that carries a hard governance rule
(action-truthfulness / document-capability truthfulness, RS-AIG) across
multiple API parts measurably weakened the model's compliance with it,
even with the text itself unchanged. This project treats action-
truthfulness as a hard rule, not a best-effort one, so this cost isn't
acceptable to ship silently.

**Rationale for reverting rather than mitigating in place.** A mitigation
exists in principle (e.g. never split a segment carrying a hard
governance rule away from its neighbors — keep the `policy-modules`
segment's surrounding context joined even in a "native" builder), but
designing and re-verifying that mitigation is new work requiring its own
live-suite confirmation, not a same-session fix. Reverting to the known-
good P2(a) shim now and treating any retry as a fresh, explicitly-scoped
attempt (not a continuation) keeps the governance-relevant regression
window at zero.

**Migration impact.** None — `gemini.js`, `ai-providers.test.js`, and
`ai-behavioral-suite.js` are all reverted to their exact P2(a)-committed
(round 32, commit `654fa67`) state. No schema, no data, nothing left
half-applied.

**Full ADR text and the "Rejected" entry this decision adds:**
[ADR-030](adr-register.md#adr-030).

## ADL-051

### NVIDIA NIM removed; Gemini becomes the default chat AND embedding provider

**Decision.** The `nim` AI provider adapter is removed from the codebase
entirely (`backend/src/services/aiProviders/nim.js` deleted). Gemini
becomes the platform's default for both chat (`config.defaultAiProvider`)
and embeddings (`config.embeddingProvider`) — previously both defaulted
to `nim`. The two configuration keys remain independent, unchanged
architecturally (`embeddingService.js`'s own decoupling rationale, ADL-041
et seq., still holds): a future college could still run Claude for chat
and Gemini for embeddings, or any other combination. Alongside this, a
global `openai` config block is added (`config.openai`,
`GLOBAL_CONFIG_BUILDERS.openai`) — not previously a global-default-capable
provider — specifically so `DEFAULT_AI_PROVIDER=openai` is a real, working
choice and so this codebase's own test suite has a simple, globally-
configurable OpenAI-compatible fixture provider now that `nim` (which
served exactly that role in ~40 orchestration-level tests) is gone.

**Superseded position.** [ADR-028](adr-register.md#adr-028)/[ADL-002](#adl-002)
(NIM as the original zero-configuration default) — those decisions
recorded real rationale for their time and are left unedited as history;
this entry records the reversal, not a rewrite of them.

**Rationale.** The user will not be using NVIDIA NIM. Gemini was chosen
as the replacement default because it already had a working global
config block, live-verified credentials in this development environment
throughout the ADR-030 P0–P2(a) effort, and is the provider the existing
live behavioral suite (`scripts/ai-behavioral-suite.js`) already targets
by default. For embeddings specifically: `gemini-embedding-001` (Google's
current unified English/multilingual/code embedding model — a better fit
for ARCNAVE's own English/Tamil/Tanglish/tool-description/document mix
than NIM's retrieval-specific `nvidia/nv-embedqa-e5-v5`) is requested with
Vertex's `outputDimensionality: 1024` parameter
(`services/aiProviders/gemini.js`'s new `EMBEDDING_DIMENSIONS` constant),
matching the existing `ai_document_chunks`/`ai_tool_embeddings`
`vector(1024)` column sizing with no new migration needed.

**Migration impact — a real data re-index, not just a config flip.** The
embedding-provenance `model` column (already landed, round 32,
`1763500000000_embedding-model-provenance.js`) means old NIM-model rows
are never silently blended with new Gemini-model rows in a cosine-distance
ranking — the read paths (`aiDocumentChunkRepository.search`,
`aiToolRetrievalService.ensureEmbeddings`) already filter on `model`. Two
different consequences per consumer: tool embeddings self-heal
automatically (`ensureEmbeddings` re-embeds every "missing under the
current model" tool on the next real tool-retrieval call, zero manual
work); document chunks do NOT self-heal (created once at upload time,
never re-derived on search) — a new one-off, idempotent script,
`backend/scripts/reembed-document-chunks.js`, re-embeds every existing
chunk's already-stored `chunk_text` under the new model. Both were run as
part of this change's rollout, not left as a theoretical future step.

**Test-suite impact.** 11 test files referenced `nim` as either a
dedicated-adapter-coverage subject (deleted outright — equivalent
coverage already exists for `openai`/`gemini`/`claude`/`self_hosted` in
`ai-providers.test.js`/`ai-providers-streaming.test.js`) or a generic
"some provider" fixture (repointed to `openai`, which shares NIM's exact
OpenAI-compatible wire shape, so most of this migration was a mechanical
rename rather than a wire-shape rewrite). Two vision-related tests in
`ai-service.test.js` needed a real fix, not a rename: `openai.
supportsVision` is `true` (unlike NIM's `false`), so the "provider without
vision support" test now uses `self_hosted` (also `false`) via a direct
`configurationService.getAiConfig` stub, matching the pattern the
sibling "vision-capable provider" test already used for Claude.

**Documentation impact.** `bka/00-foundation/domain-model.md`'s
Technology Baseline table, `bka/10-specification/RS-AIG-ai-governance.md`,
and `bka/20-matrices/ai-capability-matrix.md` — all current-fact
assertions naming NIM as the live default — updated to name Gemini.
`bka/30-decisions/adr-register.md`/this ledger's own NIM-era entries
(ADR-028/ADL-002) are left unedited, per this project's established
convention of recording a reversal as a new entry rather than rewriting
history (same convention [ADL-050](#adl-050) followed).

## ADL-052

### ADR-030 P2(c) real tool-use loop — shipped behind a compatibility-mode-default flag

**Decision.** `askAgent`'s single-tool_call branch (`backend/src/services/
aiService.js`) is now a bounded, adaptive loop: after a tool runs, its
result is fed back into the SAME conversation (same `decisionContext`,
same model, same tool list) and the model may either answer directly or
call one more tool, up to `config.maxToolCallsPerTurn` tool executions.
This replaces the two-call shape ADR-030's own review flagged as most
expensive (a `completeWithTools` decision call, followed unconditionally
by a separately-built `summarizeToolResult` synthesis call). Scope was
explicitly minimal, confirmed with the user before implementation: only
the single-tool_call path changes. `executeWorkflowPlan` (the pre-planned
`run_workflow_plan` meta-tool path) is untouched — it already does its own
bounded, LLM-proposed-once sequencing and was never part of the
"duplicated calls" problem.

**Superseded position.** ADR-030's own phasing text, which listed P2(c) as
"not started" with no design. That line now reads "implemented
2026-08-24, shipped behind `config.maxToolCallsPerTurn` — see ADL-052."

**Design, in brief (full detail: the approved plan this session's
implementation followed).** `completeWithTools(cfg, arcnaveContext,
priorTurns = [])` — every adapter (`gemini.js`/`claude.js`/`openai.js`/
`selfHosted.js`) gains a third, optional parameter: a plain,
provider-agnostic array of `{toolName, arguments, callId, rawToolCall,
resultText}` records, appended as native multi-turn messages AFTER the
unchanged base system+user turn — `decisionContext` itself is built once
and reused unchanged across every iteration, so the governance-bearing
system segments are packaged identically every call (the exact invariant
ADL-050's P2(b) rejection showed was unsafe to violate). No model
switching across continuation calls — every completeWithTools call in the
loop uses the same raw `aiConfig`; `selectModelForPurpose` fast-model
routing is confined to the fallback/compatibility synthesis path only (a
mid-loop model swap would ask a different model to continue a conversation
containing a tool-call turn it did not itself generate). The L3/bulk
confirmation gate (RS-AIG-005) re-runs on every iteration, not just the
first; a tool needing confirmation at iteration > 0 stops the loop without
running it, surfacing an explicit "would need confirmation, not taken"
note rather than silently dropping it.
`config.maxToolCallsPerTurn` (env `MAX_TOOL_CALLS_PER_TURN`, strict
`^[1-9]\d*$` validation, hard ceiling 5, default 1) is the rollout
mechanism: at `1` ("compatibility mode"), the loop's first iteration hits
the cap immediately after one tool executes and falls into
`summarizeToolResult` (generalized from a single `tool` to a `tools`
array, but collapsing to the exact same construction for one tool) — the
same call sequence as before this change existed. Raising it to 2-5 turns
on the real adaptive loop.

**A real live-only bug found and fixed mid-implementation, not just
theorized.** The first live multi-tool-call run against real Vertex AI
(not caught by any mocked-fetch unit test) surfaced a genuine Gemini API
rejection: with thinking enabled (this codebase's `GENERATION_CONFIG`
default), a real `functionCall` response part carries a sibling
`thoughtSignature` field, and Vertex's real API returns 400 ("Function
call is missing a thought_signature...") on any continuation request that
replays a `functionCall` part without it. `gemini.js`'s `completeWithTools`
now returns the ENTIRE response part as `decision.rawToolCall` (not just
`{name, args}`), and `buildPriorTurnContents` replays that exact part
verbatim on a continuation call rather than reconstructing a bare
`{functionCall:{name,args}}` — locked in by a new adapter unit test
(`ai-providers.test.js`) asserting a `thoughtSignature`-bearing part
survives a round trip unchanged. `claude.js`/`openai.js`/`selfHosted.js`
also carry `rawToolCall` (their own native tool-call payload) for the same
fidelity reason, preferred over `JSON.stringify`-reconstructing arguments
when available.

**A second bug caught in the verification harness itself, not production
code.** `scripts/ai-behavioral-suite.js`'s first version set
`config.maxToolCallsPerTurn = 3` once, globally, for the whole suite run —
not scoped to the new category K — which let several long-established A-J
scenarios chain a second tool call they never would have under the real
default (`1`), corrupting the baseline comparison and making the
thought_signature bug (above) look like it affected unrelated categories.
Fixed via `withScenarioToolCallCap`, which sets the cap to `3` only for
category K's own scenarios and leaves every other category at the true
default of `1`.

**Verification.**
- `docker compose run --rm app npm test` (full suite): 2112/2114 (same 2
  pre-existing, unrelated `fetch_trusted_web_page` failures every prior
  checkpoint has recorded; +28 new tests — 14 adapter-level in
  `ai-providers.test.js` (13 for the priorTurns contract, 1 locking in the
  live-caught `thoughtSignature` fix below), 8 control-flow in
  `ai-service.test.js`, 7 config validation in the new
  `tests/config.test.js` — zero regressions).
- `docker compose run --rm app node --test tests/admission-drafts.test.js
  tests/ai.test.js tests/ai-config.test.js` (live DB): 45/45.
- Compatibility-mode equivalence is asserted directly, not just inferred
  from "tests still pass": a dedicated test captures the actual outbound
  synthesis request at the default cap of 1 and asserts its
  system/user/model/tools shape — not a claim of byte-identity with a now-
  deleted code path, since `summarizeToolResult`'s generalization changed
  several construction details that happen to collapse to the same output
  for exactly one tool.
- **Live behavioral suite, three runs, real Gemini via Vertex ADC.** Run 1
  (before the two bugs above were found): 32/50, dominated by the global-
  cap-scoping bug's fallout plus scattered thought_signature 400s. Run 2
  (after both fixes): the new category K's core mechanism proved correct —
  `k1` chained `get_college_profile` → `draft_notification` in one turn
  with a coherent combined answer, `k3` correctly paused for confirmation
  before the L3 tool and never invoked it (`k2` failed on a plain timeout);
  zero thought_signature errors anywhere in this or any later run. A-J
  categories in run 2 were themselves contaminated by leftover quota
  pressure from run 1 (mass "fetch failed"/timeout errors, not content
  failures). Run 3 (after a 4-minute wait for quota recovery): B (identity
  masking) 8/8, C (vague-request handling) 6/6, D (action truthfulness)
  4/4 — all clean, zero regression signal; A (tool-selection restraint)
  5 timeouts out of 12 (the same class of Vertex network-timeout flakiness
  prior checkpoints already document as content-independent); E
  (document-capability claim) 3/3 failures were explicit `429
  RESOURCE_EXHAUSTED` responses, not content failures. Killed by user
  instruction partway through category F once it was clear the project's
  Vertex quota was genuinely exhausted for a sustained period (not a
  transient per-minute limit) after three consecutive full-suite runs in
  one session — continuing would have burned more quota for the same
  quota-exhaustion signal, not new information. **A clean, uninterrupted
  full A-J run (once quota resets) remains a real gap against ADR-030's
  own go/no-go criteria and is recorded as follow-up work below, not
  silently treated as passed.**

**Migration impact.** None by default — `config.maxToolCallsPerTurn`
defaults to `1`, and compatibility mode is the shipped behavior. No schema
change, no data migration. Raising `MAX_TOOL_CALLS_PER_TURN` above `1` (2-5)
turns on the real loop; this has NOT been done for any environment as part
of this change.

**Follow-up work (not done this session).**
- A clean, uninterrupted live behavioral suite run (A-J at the true
  default cap of 1, K at cap 3) once Vertex quota resets, to close the
  go/no-go gap noted above before ever raising the default cap.
- The remaining go/no-go criteria from ADR-030's own phasing text: a real
  cost/latency comparison (loop enabled vs. disabled) via the new
  `tool_select_continue` `logLlmCall` audit rows, and confirming no
  increase in `ai_tool_denied` rows / no `workflow_requests` created
  without a matching confirmation audit trail.
- `bka/10-specification/RS-AIG-ai-governance.md`'s RS-AIG-022 entry was
  reviewed and left unedited — its rule ("a fast model may only ever
  describe an already-authorized, already-fetched result, never decide
  whether a tool may run") remains exactly true under the loop, since no
  continuation call is ever downgraded — but its `Implementation` note
  could be extended to name the loop explicitly; a documentation nicety,
  not a correctness gap.

**Full ADR text:** [ADR-030](adr-register.md#adr-030).

---

## ADL-053

### J1/J2 artifact tool-naming behavioral-suite failures — no-fabrication test fix + focus-hint content inlining

**Decision.** Product Reasoning pass on the two live-caught, previously
unscoped `ai-behavioral-suite.js` category J failures CURRENT-STATE.md
flagged as needing one (`docs/bka/70-checkpoint/CURRENT-STATE.md`
"Available next work"). Both were genuine open decisions — no existing
rule settled either (confirmed via `spec-navigator`-style search before
asking). User answered both via a single batched `AskUserQuestion`:

1. **j1** ("draft a one-page summary of this term's academic performance"
   against a test tenant with no seeded assessment-marks rows): the AI
   correctly looked up data, found none, and told the user honestly in
   chat instead of writing anything to the artifact. **Decided: this is
   correct product behavior, not a bug — the TEST's own expectation was
   wrong.** Never fabricate report content from missing data (matches
   `RS-AIG-014`'s "refuses to forecast rather than fabricating" and every
   analogous no-fabrication precedent already in this codebase — token
   usage, search-result, and usage-metric renderers all "render nothing"
   rather than a placeholder when data is genuinely absent).
2. **j2** ("please rewrite this to be more formal" against an open
   artifact with real content `"Initial draft content."`): `aiService.js`'s
   `buildFocusHint` sent the model only the artifact's `id`, never its
   actual text, so the model correctly had nothing to rewrite and asked
   the user to paste it. **Decided: inline the artifact's current content
   into the focus hint** (budget-guarded, ownership-checked through
   `artifactService`, same untrusted-data boundary CLAUDE.md rule 9
   already requires) so a single compatibility-mode tool call is enough —
   not a test fix, a real context-builder gap.

**Affected artefacts.**
- `backend/src/services/aiService.js` — `buildFocusHint` is now `async`
  and takes `(focusContext, client, identityContext)`; new
  `buildArtifactFocusHint` fetches the focused artifact via
  `artifactService.getOwnArtifact` (CLAUDE.md rule 1 — never the
  repository directly), truncates to `ARTIFACT_FOCUS_CONTENT_CHAR_BUDGET`
  (50,000 chars), and wraps it in the same
  `aiPromptSafetyLayer.BOUNDARY_START/SAFETY_PREAMBLE/BOUNDARY_END`
  mechanism already used for chat attachments/tool output — never a second
  boundary convention. A cross-tenant, not-owned, deleted, or malformed
  artifact id degrades to the old id-only hint (never throws the turn),
  the same graceful-degrade shape `routes/ai.js` already uses for a bad
  `project_id`/`conversation_id`.
- `backend/scripts/ai-behavioral-suite.js` — `j1` now has its own `expect`
  (previously shared the generic "expected tool X" check with j2/j3):
  passes on either a real `update_artifact_content` call OR an honest
  no-data chat reply; fails only if the answer falsely claims a summary
  was drafted without the tool call that would make that true.

**Verification.** Full unit/integration suite unaffected: 201/203
(the 2 failures are the pre-existing, unrelated `fetch_trusted_web_page`
gap CURRENT-STATE.md already tracks — untouched by this change). Live
(real Gemini, `docker compose run --rm -e CATEGORY_FILTER=J app node
scripts/ai-behavioral-suite.js`): `j1` 2/2 clean across two separate runs
(one run's `j1` result was a Vertex timeout, not a quota error, and not a
content failure — retried clean). `j3` unaffected, still passing. `j2`
confirmed the content-inlining fix itself works — the model now correctly
composes an accurate reformalized rewrite of the real artifact text (e.g.
`"This document serves as the initial draft for formal review and
subsequent refinement."`) — but **still does not call
`update_artifact_content`**, printing the revision in chat instead, 3/3
live attempts including after a second, stronger post-content action
reminder appended after the content block (recency-ordered, not just
restating the pre-content instruction).

**Open sub-issue, not yet resolved — working theory, unconfirmed.** The
shared `aiPromptSafetyLayer.SAFETY_PREAMBLE` text (CLAUDE.md rule 9's one
mechanism, reused verbatim everywhere untrusted content is wrapped)
explicitly authorizes "Summarize, quote, or reason about it as content
only" — which may be in direct, literal tension with wanting the model to
call a tool instead of quoting the artifact's content back in chat. Not
yet root-caused with certainty (never A/B-tested against a
non-`SAFETY_PREAMBLE`-wrapped version of the same content), and changing
`SAFETY_PREAMBLE` itself would affect every other untrusted-content call
site in the codebase, not just this one — a decision of its own, not
folded into this one. Two prompt-wording iterations on the
`buildArtifactFocusHint`-local text alone did not fix it.

**Migration impact.** None (no schema/DB change). Behavioral only.

**Implementation notes.** `buildFocusHint`'s only caller (`askAgent`) was
updated to `await` it; no other call site exists. `artifactService` had no
existing circular dependency on `aiService`/`aiToolRegistry`, confirmed
before adding the `require`.

**Status:** Resolved — partially implemented. j1 closed and verified. j2's
context-inlining half is implemented and verified working; the
tool-call-vs-chat-reply half remains open, tracked here rather than
silently left unscoped again.

---

## ADL-054

### ADR-030 P3 — Gemini `cachedContentTokenCount` telemetry captured; explicit caching design deferred, real risk identified

**Decision.** User directed P3 to proceed, scoped to the `tool_select`
call (ADR-030's own gate: "only after P0's telemetry shows what a clean
prefix actually buys — not budgeted as a project until measured"). Before
writing any caching code, checked what P0's existing telemetry
(`audit_log`, `action='ai_llm_call'`) actually showed: `tool_select`'s
`systemPromptChars` is highly stable (2 distinct values across 39 calls,
5,740–6,246 chars) and it's the most frequent call type — a real
candidate. Researched Vertex AI's actual caching mechanics before
designing anything (web search, since this postdates training knowledge):
**implicit context caching is automatic, enabled by default on every
Google Cloud project, requires zero request-shape change, and already
applies to every eligible Gemini call this codebase makes today** —
minimum 2,048 tokens, 90% discount on cache hits, visible only via
`usageMetadata.cachedContentTokenCount` in the response. This codebase
never read that field for any provider (confirmed the same gap exists for
Claude's own `cache_control` prompt-caching, P1.2 — unrelated, out of
scope, not fixed here).

**What was actually built — telemetry, not caching.** `gemini.js` gains
`extractUsage(usageMetadata)`, a single shared read of
`cachedContentTokenCount` reused across all 4 of that adapter's
usage-construction call sites (`completeWithMeta`, `attemptStream`,
`completeWithTools`'s tool_call and answer branches) — `undefined` when
genuinely absent, never coerced to 0. `aiService.js`'s `logLlmCall` now
persists `cachedTokens` into `audit_log.metadata` alongside the existing
`inputTokens`/`outputTokens`. No request sent to Gemini changed shape at
all — this only reads a field the API was already returning.

**Real measurement, not a guess.** A temporary diagnostic query (added to
`ai-behavioral-suite.js`'s cleanup path for one run, then reverted — never
committed) against a live category-A run: of 10 successful `tool_select`
calls (avg 5,697 input tokens, comfortably above the 2,048 minimum), only
**1 got an implicit cache hit** (3,393 cached tokens). Implicit caching
demonstrably works on this exact prompt shape, but the hit rate under this
codebase's natural call pattern (sequential, 3s-paced, spread across a
live behavioral-suite run) is low — consistent with Vertex's own
documented guidance that implicit hits need "a similar prefix in a short
amount of time," which this call pattern doesn't reliably provide.

**Why explicit caching (the natural next step for a guaranteed, high hit
rate) was NOT designed or built this round.** Explicit caching
(`cachedContents` API) requires the system instruction + tool definitions
to be created as a separate, server-side cached resource, then referenced
by id in later calls instead of resent inline — a real, structural change
to how the governance-bearing system instruction reaches the model on
every `tool_select` call. This is the same category of change ADR-030
P2(b) already attempted and empirically rejected: [ADL-050](#adl-050)
found that splitting that exact system instruction (byte-identical text,
delivered as multiple `systemInstruction.parts` instead of one) measurably
weakened the model's compliance with a hard governance rule embedded in
it (`E: document-capability claim` dropped from 3/3 to 2/7 live samples) —
proof that HOW the governance-bearing instruction is packaged and
delivered to Gemini, not just its text content, is a live, measurable
compliance variable for this specific model/provider. Explicit caching is
a different delivery mechanism (a cache reference vs. inline parts), not
proven safe or unsafe by ADL-050's own result, but it is untested, and
ADL-050's own "Rationale for reverting rather than mitigating in place"
section already states the applicable principle: a new packaging change to
this same governance-bearing content is "new work requiring its own
live-suite confirmation, not a same-session fix" — a "fresh, explicitly-
scoped attempt," never a casual extension of this session's telemetry work.
Not designed or attempted this round; flagged for the user rather than
built or silently skipped.

**Affected artefacts.** `backend/src/services/aiProviders/gemini.js`
(`extractUsage`, all 4 usage call sites). `backend/src/services/
aiService.js` (`logLlmCall`'s `cachedTokens` field).

**Verification.** Full suite via `docker compose run --rm app npm test`:
2111/2114, same 2 pre-existing unrelated failures as every prior round in
this ledger, zero regressions (confirmed across 2 runs; a 3rd failure in
one run didn't reproduce on immediate re-run — flaky, not a regression).
`ai-providers.test.js` (40/40) unaffected — no wire-shape assertion
needed updating since request shape is unchanged.

**Migration impact.** None — telemetry-only, no schema change (`audit_log.
metadata` is already JSONB), no request-shape change.

**Follow-up decision (same session, after a pause).** Presented the
explicit-caching risk above to the user as a genuine 3-way choice (design
it with a live-suite verification gate / stop here / a narrower
tools-only-cache design). **User decided: stop here — implicit caching
plus this round's telemetry is enough for now.** Explicit caching is not
rejected outright, just not undertaken this round; revisit only if
cost/latency becomes a real, demonstrated problem (not preemptively). No
code exists for it, nothing left half-built.

**Status:** Resolved — implemented (telemetry only; explicit caching
deliberately not pursued, per the user's own decision above, not left
silently unscoped).

---

## ADL-055

### Implicit-cache investigation reopened — tool-declaration variance exonerated, and the real cost centre found to be `analyze_document_table`'s unbounded tool result

**Context.** A design conversation about giving Curriculum a persistent,
Claude-Code-style workspace (ARC.md / STATE.md / INDEX.md, skills, agents)
raised a prerequisite question: which parts of such a workspace are worth
placing in a stable, cacheable prompt prefix. Rather than design the
context tiers speculatively, the user directed that the caching question
be **measured first** — explicitly rejecting an early recommendation
(pin the tool set so the prefix stops changing) on the grounds that it
would be engineering against an unproven cause.

**Superseded position.** This entry does not supersede [ADL-054](#adl-054),
which remains correct: implicit caching works, is automatic, and was
already observed live (1 hit of 3,393 cached tokens across 10
`tool_select` calls averaging 5,697 input tokens). It supersedes a
hypothesis raised *in this session only* — that round-32's per-turn
semantic tool retrieval (`aiToolRetrievalService.js`) was destroying the
cacheable prefix by varying the `tools` block on every call. That
hypothesis is disproved below and must not be revived without new
evidence.

**Finding 1 — tool declarations are not the cause (controlled experiment).**
`backend/scripts/cache-experiment.js` (added this round) runs three arms
against real Vertex, changing exactly one variable at a time: A =
identical ~22k-char system instruction with **no tools**; B = identical
plus a **fixed** tool block; C = identical with a **rotating** tool set
(A A B A). Result: **0 cache hits across all 10 calls, including arm A.**
Arm A carries no tool declarations at all, so tool-set variance cannot
explain its misses. Tool retrieval is exonerated; `aiToolRetrievalService.js`
and `aiToolRegistry.js`'s `RANK_CAP` shortlisting must not be changed for
caching reasons.

**Finding 2 — hit rate is size-and-timing sensitive, not a hard threshold.**
Arm A/B/C ran at ~4,092–4,179 input tokens, 20s apart: no hits in 10
attempts. A separate raw-`fetch` probe at **18,793** input tokens, same
project/region/model (`gemini-3.7-flash`, `global`, the app's own `/v1/`
request shape), 25s apart: call 1 miss, call 2 miss, **call 3 hit with
`cachedContentTokenCount: 16350`** (87% of the prompt). Read together
with ADL-054's own live hit at 5,697 tokens, the honest conclusion is
that eligibility is **probabilistic and improves with prompt size**, not
a clean cutoff — an intermediate reading in this session that ~5k
requests are "below the threshold and therefore permanently uncacheable"
was stated too strongly and is corrected here. The exact minimum was
deliberately not bisected: it is tuning data, ranked below the findings
that follow.

**Finding 3 — every recorded `ai_llm_call` row shows no cache signal.**
`backend/scripts/cache-hit-analysis.js` (added this round, read-only)
aggregates the `audit_log` rows `logLlmCall` already writes. Across all
45 rows: 0 hits, 0 confirmed zeros, **45 no-signal** (`cachedTokens`
absent — never coerced, per `gemini.js`'s own rule that absent ≠ zero).
Also surfaced two telemetry gaps: `metadata.model` is `null` on every row
(`aiConfig.model` is not populated at the `logLlmCall` call site), and
`toolCount`/`systemPromptChars` are absent for the `tool_answer` and
`general_chat` purposes. Note also that **zero `tool_select_continue`
rows exist** — ADR-030 P2(c)'s bounded tool-use loop has never taken a
continuation in recorded traffic, so its intra-turn growing-prefix
behaviour remains unmeasured, not measured-and-failed.

**Finding 4 — the real cost centre, and it is not `tool_select`.**
Per-call average input tokens by purpose: `general_chat` 1,367;
`tool_select` 5,320; **`tool_answer` 84,010, peak 125,927**. The two
largest calls were traced through `audit_log` to a single tool —
`analyze_document_table` — invoked twice on the **same `documentId`**
39 seconds apart (`111_cons_result_apr2026.txt`, 278,403 extracted
chars), each time re-downloading, re-extracting and re-injecting.

**Finding 5 — why that path cannot cache, and why the first hypothesis
about it was also wrong.** The initial suspicion was that
`aiPromptSafetyLayer.renderForLlm` (`aiPromptSafetyLayer.js:72`) places a
per-invocation `retrievedAt` timestamp at the head of each data block,
invalidating an otherwise byte-identical 125k prefix. The user required
this be tested rather than assumed, and it does not hold:
`documentAnalysisService.analyzeAttachment` returns
`documentAggregateService.aggregate(scoped, {groupBy, filter, operation})`,
whose parameters are **supplied per-question by the LLM**. Two different
questions produce entirely different payload bytes, so there is no stable
prefix for the timestamp to spoil. The `retrievedAt` ordering remains a
latent issue for tools whose output *is* deterministic, and the invariant
worth adopting is *stable evidence bytes before volatile metadata* — but
it is not the cause here and fixing it would change nothing measurable.

**Finding 6 — the tool result is unbounded, and no cap exists on that
path.** `documentAggregateService.aggregate` returns `records.map(...)` —
one object per row, in both `annotate` (default) and `include` modes, with
**no scalar total and no size cap** (`documentAggregateService.js:148-155`).
`MAX_RAW_EXTRACTED_CHARS` (1,000,000, `documentTextExtractionService.js:42`)
bounds *extraction*, and `DEFAULT_ATTACHMENT_TOTAL_CHAR_BUDGET` (200,000,
`aiService.js:521`) bounds the *attachment text-hint* path — but a **tool
result** reaches the prompt through `summarizeToolResult` and is subject
to neither. That is how 278,403 chars of derived rows became a single
125,927-token request: an O(document) payload for what is often an O(1)
answer.

**Decision.** No code change is made this round beyond the two read-only
diagnostic scripts. Specifically: (a) tool retrieval / tool-set pinning is
**closed, not deferred** — disproved by Finding 1; (b) workspace context-tier
design (ARC.md / STATE.md / INDEX.md stability annotations) is **not**
to be optimised around implicit caching, since a well-shaped agent request
is small enough that caching is a marginal concern at best; (c) the
`analyze_document_table` result size is **blocked pending a new Product
Reasoning pass**, per the reason below.

**Why (c) is blocked rather than fixed.** The behaviour matches its own
Approved Spec: `bka/60-product-reasoning/ai-chat-result-sheet-evidence.md`
specifies per-student facts as the tool's Output (its "API contracts"
section), so returning rows is not a defect. But two of that spec's stated
premises are now empirically false: its **Edge cases** entry ("Very large
result sheet → already bounded by the existing `MAX_RAW_EXTRACTED_CHARS` /
`ATTACHMENT_TOTAL_CHAR_BUDGET` ceilings") assumes an input bound implies an
output bound, which Finding 6 disproves; and its **OUT OF SCOPE** rationale
for a per-attachment retrieval index ("solves a context-window scale
problem this use case doesn't have — one attachment fits within
`ATTACHMENT_TOTAL_CHAR_BUDGET`") is contradicted by a 278,403-char
attachment producing a 125,927-token request. Since OUT OF SCOPE is a hard
boundary under CLAUDE.md, and since bounding the payload changes what a
user actually receives (a full 3,000-row list is a legitimate answer to
some questions), this requires a new pass rather than an in-place edit.
One narrowing worth carrying into that pass: the spec's own design intent
routes computed facts to `buildEvidence`/`verifyNumericClaims`, and it
never specifies that the full facts array must be placed in the prompt —
so bounding the *prompt* payload while keeping the *return value* and
*verification* intact may be within the existing spec.

**Affected artefacts.** Added: `backend/scripts/cache-hit-analysis.js`,
`backend/scripts/cache-experiment.js` (both read-only diagnostics; the
latter makes real, billable Vertex calls and is manually triggered, never
CI). No production code changed. Implicated but unchanged:
`documentAggregateService.js:148-155`, `documentAnalysisService.js:126`,
`aiPromptSafetyLayer.js:72`, `aiService.js:521`, `aiService.js:1358-1386`.

**Migration impact.** None.

**Implementation notes / hazards.** `cache-experiment.js` first run at
~17k tokens x 12 rapid calls returned `429 RESOURCE_EXHAUSTED` while a
single small call immediately afterwards succeeded — a per-project
tokens-per-minute quota, not a hard block. The committed script is tuned
to ~5.5k tokens with 20s spacing for that reason; raising either requires
re-checking quota, and a 429 mid-arm would otherwise be misread as a cache
result.

**Implementation (same session).** Shipped exactly the Approved Spec's
CORE + two REQUIRED SUPPORT items, nothing else.
`documentAggregateService.summarize()` added alongside an **unchanged**
`aggregate()` (so all 13 of that service's existing tests stayed green):
computes `total`, `matchedCount`, `scopedCount`, a `bySemester` cross-record
rollup for `breakdown` only, and a sample capped at
`DEFAULT_SAMPLE_SIZE = 100` with a truthful `sampleShown`/`sampleOmitted`
split. 100, not a smaller round number, because the prior slice's own
verified ground-truth ranges are 55 and 41 records — the documented
"consolidate serial X to Y" question still returns every matching row, so
the cap only engages beyond any scale that spec contemplated. The sample is
drawn from **matched** rows, not all scoped rows: in the default `annotate`
mode most rows are zeros, and a sample of zeros would spend the budget
saying nothing. `documentAnalysisService.analyzeAttachment` now returns
`{status, strategy, ...summary}` instead of `{status, strategy, results}`.
`aiService.extractDeterministicSummary` routes evidence for any result
carrying that shape (keyed on shape, never on a tool name) to the
deterministic figures **plus the sample's own row values** — deliberately
not the deterministic figures alone, because `collectFieldValues` exists to
catch "right number of rows, wrong count on ONE of them" (ADR-029's
original Muhammad-Ashik miscount) and dropping row values entirely would
have silently removed that check. Bounding the sample already fixes the
dilution: ~100 values instead of ~6,000. No change was needed in
`summarizeToolResult` — bounding at the tool means the prompt is bounded by
construction.

**Verification.** Full suite via `docker compose run --rm app npm test`:
**2120/2122**, the same 2 pre-existing unrelated failures
(`Policy Gate: 'class_tutor'...`, `fetch_trusted_web_page: registered as
L1...`) recorded against every prior round in this ledger — zero
regressions, 8 net new tests.

Payload measured against **the original document itself** — the user
re-supplied `111_cons_result_apr2026.pdf` after the stored copy was found
missing from local storage (the `documents` row
`20154058-c490-480d-8a4c-9f7b2a5a31a2` survives; its file does not). Same
document confirmed: extraction produces **278,403 chars**, byte-identical to
the figure the `ai_attachment_analyzed` audit row recorded on 2026-08-22.
1,603 records across 20 sections; 652 matched; deterministic total 2,189.
Tool-result payload, boundary-wrapped exactly as `renderForLlm` delivers it
and counted with Vertex's own `countTokens` on `gemini-3.7-flash`:

| operation | before | after | |
|---|---|---|---|
| `count` | 62,029 tok | 3,872 tok | 16x |
| `breakdown` | 88,849 tok | 6,214 tok | 14x |

**Live end-to-end run (throwaway seeded tenant, real upload through
`documentService.uploadChatAttachment`, real `askAgent`, real Vertex).**
Two runs against the same re-supplied PDF. This is where the earlier
"unexplained remainder" hypothesis got tested, and it holds — with two
further findings that matter more than the payload size this spec fixes.

*Run 1, natural phrasing* ("How many arrears are there in the ECE Sandwich
section?"): one `tool_select` call, **124,548 input tokens**,
`toolsUsed: null`, `verification: undefined`. **The deterministic tool was
never invoked.** The model answered by narrating counts straight out of the
attachment text — a live reproduction of precisely the failure ADR-029 and
[`ai-chat-result-sheet-evidence.md`](../60-product-reasoning/ai-chat-result-sheet-evidence.md)
exist to prevent. The tool only ran once the question named it explicitly.
This is a real, reproduced defect in the deterministic path's reachability;
it is **not** addressed by this spec and needs its own pass.

*Run 2, tool explicitly named* (consolidate serial 818-872):

| purpose | input tokens |
|---|---|
| `tool_select` | 125,493 |
| `tool_answer` | 125,512 |
| **turn total** | **251,005** |

The bounded payload works as designed — `toolsUsed:
["analyze_document_table"]`, evidence in the new shape (`recordCount` 34,
`fieldValues` `[100, 55, …]` = total 100 arrears, scopedCount 55, then the
sample's own per-row counts). Serial 818-872 resolves to exactly 55
records, the prior spec's own documented range, and all 34 matching rows
were still listed — the 100-row cap never engaged, as intended.

**But the dominant cost is `buildAttachmentHint`, not the tool result.**
That hint is **211,604 chars (~124.5k tokens)** for this document and rides
in **both** the `tool_select` and `tool_answer` requests — the document is
sent twice per turn, and was sent a third time as the tool result before
this change. This spec removed the third copy (measured 62,029 → 3,872
tokens for `count`); the two hint copies are untouched and account for
roughly 80% of the turn. Out of scope here, deliberately: it is a different
path, a different budget (`DEFAULT_ATTACHMENT_TOTAL_CHAR_BUDGET`,
`aiService.js:521`), and it needs its own Product Reasoning pass rather
than an opportunistic edit alongside this one.

**Root cause of the run-1 failure, measured (not inferred).** A direct call
to `aiToolRetrievalService.retrieveRelevantTools` against the same role's
73 permitted tools shows `analyze_document_table` is **not retrieved** for
"How many arrears are there in the ECE Sandwich section?" — nor for
**"consolidate arrears for serial 818 to 872"**, which is the prior spec's
own canonical user-flow example. It is retrieved only once the question
contains "attached result sheet" or names the tool. The eight tools offered
instead were `finance_submit_fee_correction`, `mark_attendance_nl`,
`academic_generate_timetable` and similar: "arrears" embeds closer to this
domain's finance vocabulary than to a document tool whose description never
uses the word. So the model did not decline the tool — it was never offered
one. `aiService.js:1732` passes only `{ roleTools, question }`; the turn's
own attachment state, already resolved by `resolveChatAttachments`, never
reaches retrieval.

The complementary case was then tested live rather than assumed: asked
"how many students failed in the attached result sheet?" (a phrasing that
does retrieve the tool), the model selected it immediately —
`toolsUsed: ["analyze_document_table"]`, `verification: PASS`, a
deterministic 748. **Selection-given-availability already works; only
availability is broken.** That single result is what keeps the fix narrow:
no mandatory-tool mechanism, no policy-module nudge, no retrieval tuning.
Resolved into
[`ai-chat-document-tool-routing-approved-spec.md`](../60-product-reasoning/ai-chat-document-tool-routing-approved-spec.md)
(Product Reasoning, same day, zero questions needed).

**Routing fix implemented and re-measured (same session).** Shipped exactly
the routing spec's single CORE item: `aiService.pinDocumentAnalysisTool`
appends `analyze_document_table` to the retrieved set when
`resolveChatAttachments` returned one or more **documents**, sourced from
`roleTools` (so an unpermitted role still never sees it) and appended
rather than substituted (so pinning can never drop a tool the question
needed). No forced-call mechanism, no policy-module nudge — both were left
out precisely because the availability-vs-selection split above showed they
weren't the broken part. Live re-measurement of the original failing
question, *"How many arrears are there in the ECE Sandwich section?"*:

| | before | after |
|---|---|---|
| `toolsUsed` | `null` | `["analyze_document_table"]` |
| `verification` | `undefined` | `PASS` |
| tools offered | 8 | 9 |
| answer | "14 students with Arrears" | "77 arrears across 21 students (out of 41 evaluated)" |

**The pre-fix answer was not merely unverified — it was wrong.** The
deterministic tool computes 77 arrears across 21 students; the free-text
narration claimed 14. That is the concrete harm ADR-029 exists to prevent,
now measured rather than argued.

**An honest cost trade, recorded so it isn't mistaken for a regression.**
The turn went from 124,548 to 250,216 input tokens, because a correct
answer now requires a second (`tool_answer`) call where the wrong answer
needed only one. The per-call cost is unchanged; the duplication is
`buildAttachmentHint` riding in both calls, which is the already-identified
P1 and is what the user sequenced next. Correctness first, then the
duplicate hint.

Full suite after this change: **2126/2128**, same 2 pre-existing unrelated
failures, zero regressions (6 net new tests).

**P1 — the duplicated attachment hint, resolved (same session).** Product
Reasoning pass →
[`ai-chat-attachment-hint-answer-call-approved-spec.md`](../60-product-reasoning/ai-chat-attachment-hint-answer-call-approved-spec.md).
The question was narrow: does the full hint need to be in both calls? It
does need to be in `tool_select` (a no-tool question like "summarise this
document" is answered from it, and it carries the verbatim `attachmentId`
per `aiService.js:603-608`) — and it is actively harmful in the answer call,
where the deterministic result is already present and the raw text merely
re-opens the narration branch the routing slice just closed. User chose:
drop it from the answer call; when the tool result doesn't answer the
question, say so and ask rather than guess.

Implemented as `answerPromptQuestion` — `promptQuestion` minus the
attachment hint, keeping history/project/focus/memory — routed to both
`summarizeToolResult` and `executeWorkflowPlan`'s `plan_synthesis` (the same
"compose an answer from tool results" step by a different route; classified
REQUIRED SUPPORT, not asked about, since the same decision applies
identically). The insufficient-result guidance went into the existing
`TOOL_RESULT_ANSWER_SYSTEM_PROMPT` `STATIC` segment rather than a new
policy module. `buildAttachmentHint` itself is untouched — only which call
receives it changed.

Live re-measurement, same question, same document:

| | before routing | after routing | after this |
|---|---|---|---|
| `tool_select` | 124,548 | 125,168 | 125,166 |
| `tool_answer` | — (no tool ran) | 125,048 | **2,771** |
| turn total | 124,548 | 250,216 | **127,937** |
| answer | "14 students" (**wrong**) | 77 arrears / 21 students | 77 arrears / 21 students |
| `verification` | `undefined` | PASS | PASS |

The answer call fell 45x and the turn halved, with the deterministic figures
and evidence byte-identical — the spec's own acceptance bar was that
cheaper-but-different numbers would be a failure, not a success. Full suite
**2131/2133**, same 2 pre-existing unrelated failures, zero regressions
(5 net new tests). Remaining cost is the `tool_select` hint at ~125k, which
is load-bearing and explicitly OUT OF SCOPE in that spec.

**Follow-up slice — structural refusal on incomplete document coverage.**
Product Reasoning →
[`ai-chat-document-coverage-refusal-approved-spec.md`](../60-product-reasoning/ai-chat-document-coverage-refusal-approved-spec.md),
implemented and live-re-run the same day. This addresses the fabrication
recorded below (two documents attached, one analysed, a reconciliation
asserted with a subgroup breakdown invented to sum to 41).

`detectDocumentCoverageGap` compares the documents the turn resolved against
the `attachmentId` values the tools were **actually invoked with**; when
`N >= 2` and coverage is short, `askAgent` skips the answer call entirely
and returns a message composed here, deterministically. Skipping is the
design, not an optimisation: asking the model to narrate an answer it cannot
support is what produced the fabrication. Generalises the pattern
`imageAnalysisUnavailable` (`aiService.js:1663`) already establishes for the
vision capability gap — its own comment states the principle, *"a safe
backstop, not reliant on the model remembering the instruction."* Prompt
guidance was explicitly rejected as the mechanism: two separate instructions
(the pre-existing "if the data is scoped differently… say so explicitly"
rule and round 40's own addition) both failed to fire on this exact turn.

Deliberately structural, never intent-based — detecting whether a *question*
means a cross-document comparison would be the same unreliable intent
matching that caused the defect, so it is barred in the spec rather than
deferred.

Live re-run, same two PDFs, same question:

| | before | after |
|---|---|---|
| answer | claimed all 41 students covered, with a fabricated 16/7/5/4/9 breakdown | names both files, states the missing capability, says what to do next |
| `verification` | `CONFLICT`, `claimedNumbers: [7,5,9]` | `INSUFFICIENT_EVIDENCE` |
| LLM calls | 2 | **1** — answer call never made |
| input tokens | 67,774 | 64,180 |

`evidence` still carries the real computed figures (`recordCount` 21, total
77 across 41 scoped), so a user who attached two documents but cared about
one loses nothing. Full suite **2137/2139**, same 2 pre-existing unrelated
failures, zero regressions (6 net new tests).

**Verification stays advisory.** Asked as part of the same pass and decided
unchanged: RS-AIG-019 / ADL-037 are not superseded. A false CONFLICT is
real and was observed the same day — "the remaining 21 students have no
arrears" is a correct derivation (55 scoped − 34 matched) flagged only
because it is not itself a known count. Blocking on CONFLICT would suppress
correct answers; the coverage check works independently of it.

**Follow-up slice — the tool catalogue (queued item 6).** Product Reasoning →
[`ai-tool-catalogue-approved-spec.md`](../60-product-reasoning/ai-tool-catalogue-approved-spec.md),
implemented and live-checked the same day. Round 39 fixed the retrieval-miss
problem for ONE tool by pinning it; nothing protected the other 68, and a
model that was never offered a tool does not say "I have no tool for this" —
it answers anyway.

Every role-permitted tool's **name** plus one sentence is now a
`tool-catalogue` system segment on the decision call, and a `describe_tools`
meta-tool fetches full schemas on demand, after which those tools become
callable in the same turn. Retrieval is **not removed** — it is demoted from
deciding what is *possible* to deciding what is *pre-loaded*, so a good
guess still costs no extra round-trip.

**Costs measured before designing, and this is not a saving** (Vertex
`countTokens`, `gemini-3.7-flash`, 69 principal tools): all full schemas
11,514 tok; the 8 retrieval pre-loads today 1,423; the catalogue 2,176; bare
names 424. The change costs roughly **+2,176 tokens per turn** and buys the
guarantee that the model is never blind to a capability it has. An earlier
framing of this idea as "lazy loading, therefore cheaper" was wrong and is
corrected here — it must not be re-justified as a cost win.

Three constraints, each load-bearing. `describe_tools` does **not** push to
`invokedTools` and does **not** consume `config.maxToolCallsPerTurn`: at the
default of 1, a fetch that ate the turn's only tool call would leave the
model unable to call what it just looked up. It has its own separate cap
(`MAX_SCHEMA_FETCHES = 3`) whose overflow is a plain refusal, never a throw.
And an unpermitted name and a nonexistent one return the *same* message, so
nothing leaks about tools this actor cannot use.

**The ADL-050 constraint is honoured structurally, not by convention.** The
decision call's segments are held in one `decisionSegments` const and reused
**by identity** on every rebuild; only the `tools` array grows. [ADL-050](#adl-050)
measured that re-packaging that governance-bearing system instruction
weakened a hard rule's live compliance 3/3 → 2/7, so a regression test
asserts the outbound system prompt is byte-identical across every iteration
of a turn in which a fetch occurred.

**One real defect this surfaced:** `toolsUsed`/`toolUsed` were derived from
`priorTurns`, which now also carries schema lookups. They are derived from
`invokedTools` instead — a lookup runs no handler and is not a tool *use*.

**Live check.** `user_preferences_list` was confirmed a genuine retrieval
miss for "en settings-a kaatunga" (a direct `retrieveRelevantTools` run
excludes it). With the catalogue: `toolsUsed: ["user_preferences_list"]`,
correct answer, one turn, at the default cap of 1 — the model found the name
in the catalogue, fetched the schema, and called it. A second live run
("consolidate arrears for serial 818 to 872", no attachment, so round 39's
pin cannot fire) showed the softer half of the same benefit: rather than the
eight unrelated finance tools retrieval offers for that phrasing, the model
correctly asked for the document it needs to run the analysis it now knows
exists. Full suite **2144/2146**, same 2 pre-existing unrelated failures,
zero regressions (7 net new tests; 3 existing tool-count assertions updated
for the always-offered meta-tool).

**One non-regression worth recording.** Run 2 returned
`verification: CONFLICT, claimedNumbers: [21]` — the model wrote "the
remaining 21 students have no arrears", a correct derivation (55 scoped − 34
matched) that is not itself a known count. This is the pre-existing
false-CONFLICT risk `COUNT_CLAIM_PATTERN`'s own comment already describes,
**not** introduced by narrowing `knownCounts`: `serialNo`/`regNo` are
strings and were never collected, so 21 would have been absent from the old
knownSet too.

**Status:** Resolved — implemented and verified. The Product Reasoning pass
this entry required was run the same day and produced
[`ai-chat-document-analysis-payload-bounds-approved-spec.md`](../60-product-reasoning/ai-chat-document-analysis-payload-bounds-approved-spec.md)
(user chose: deterministic total + capped row sample; explicit "showing N
of M", never silent truncation; cap scoped to `analyze_document_table`
only). That pass also found two further defects sharing the same root
cause, both now in the Approved Spec as `REQUIRED SUPPORT`: no cross-row
aggregate exists anywhere (`operation: 'sum'` only sums within one record,
so the LLM still totals thousands of rows itself), and `collectFieldValues`
(`aiService.js:950-955`) puts every numeric field of every row into
`verifyNumericClaims`'s `knownSet` — roughly 6,000 values at 3,000 rows —
which inverts that check's failure mode from false CONFLICT to false PASS
at scale. Tool-set pinning remains closed. Cache-threshold bisection and
the `retrievedAt` ordering invariant remain deliberately unranked
follow-ups, not queued work.

### ADL-055 addendum — item 1's Product Reasoning pass (2026-08-25)

Queued item 1 was recorded as *"table extraction generalisation"* — a
coverage gap. Measurement before designing (this thread's own discipline)
found a **second, worse problem that is not a coverage gap at all**, and it
reordered the item.

**Coverage, first (`backend/scripts/extraction-coverage-probe.js`, the same
4-row table in every attachable format):** xlsx and ods produce
`delimited`/4 records; **csv, tab-delimited plain text, and docx tables all
produce `strategy: 'none'`/0 records.** The docx case is not a missing
delimiter — `mammoth.extractRawText` flattens every table cell into its own
paragraph, so the 2D structure is destroyed in
`documentTextExtractionService`, *upstream* of any detector. No
table-detector change could have recovered it.

**Then the real finding.** The exam-fees PDF does not fail. Run end to end,
`analyze_document_table` returns
`{ status: "ok", strategy: "sequential_id", total: 17, scopedCount: 4 }` —
for a **23-student** document, with no failure signal of any kind.
`documentAnalysisService.js:116` guards only `strategy === 'none'`; there is
no check that a *recognised* layout was recognised **correctly**. Worse,
this defeats `verifyNumericClaims` by construction: that mechanism checks
the narration against the tool output, never the tool output against the
document, so a wrong tool result verifies **PASS**. The day book's honest
`strategy: 'none'` is a strictly better outcome than this. The whole
five-slice thread above was spent making this exact path trustworthy.

**A first candidate signal was measured and rejected.** "More pattern
matches than records" does not work: counting 77 arrears across 21 student
records is the primary *working* use case. The signal that holds is the
detector's own contract — `sequential_id` already requires
`STUDENT_ROW_SIGNAL_PATTERN` to accept any record, so every document
reaching it carries one marker per genuine row by construction, and every
marker must be accounted for either as its own record or as a page-break
continuation the detector itself merged.

| | result sheet | exam fees |
|---|---|---|
| markers in text | 1781 | 23 |
| records produced | 1603 | 4 |
| accounting | 1425×1 + 178×2 = **1781, exact** | **17 of 23**, one record holding 10 |

The result sheet balances perfectly, and its 178 two-marker records are
precisely the deliberate page-break merges. The check is self-calibrating —
no per-document constant — and demonstrably does not fire on the working
reference document.

**The proposed alternative was measured too, and the queue's own phrasing
of it was optimistic.** `pdfjs-dist` y-bucketing on the exam-fees PDF
recovers identity **23/23** (serial, regNo, name, in order) where flat text
yields 4. But the numeric columns are **misattributed**: per-semester
figures print *above* their student inside a merged cell, so ASHWIN JOHN
EDISON S's `1,1,65,625,690` lands on the previous record. Correct
attribution needs x-column-boundary detection — which was done by hand
earlier in this session, not automatically. "Bucket by y then x
reconstructs the table" is therefore corrected in the Approved Spec.

**Two §15-threshold questions were asked, batched once.** ADR-029 forbids
building the whole multi-format layer at once but does not say which
increment is first; and no rule settles what a partly-trustworthy
extraction should return. User chose **trust check + csv/tsv/docx** (PDF
geometry gets its own slice), and **identity-only records with numeric
operations refused** for the partial-trust case.

That second answer is a rule going forward, so it is recorded here rather
than only in the spec: *when extraction recovers record identity but cannot
attribute numeric columns, the deterministic path returns the records and
answers count/list questions, and refuses sum/total questions with an
explicit reason — it never emits an unverifiable number.* It has **no
producer until geometric reconstruction exists**, so it is deliberately not
built now; ADR-029's stated purpose for fixing shapes ahead of slices is
exactly this.

Not asked, because rules settled them (workflow §15 steps 1–3): a
deterministic check rather than prompt guidance (this entry's own rule,
proven three times); routing csv through a real parser rather than teaching
the detector to split on commas (csv quoting, plus prose false positives —
`exceljs.csv.read` was verified at analysis time to handle quoted commas
and to emit the exact `' | '` shape the existing `delimited` strategy
already consumes, so **no table-detector change is needed for csv at
all**); and guarding `sequential_id` only, since `delimited` is exact by
construction.

**Status:** Resolved — pending implementation.
[`ai-chat-document-extraction-trust-and-formats-approved-spec.md`](../60-product-reasoning/ai-chat-document-extraction-trust-and-formats-approved-spec.md).
ADR-029's revisit trigger ("≥2-3 concrete formats beyond the first slice")
is now formally fired: result sheet, exam-fees list, Tally day book.
Nothing here approaches RS-AIG-018 — every piece is developer-shipped
deterministic library work.

### ADL-055 addendum — item 1 slice 1 implemented (2026-08-25)

[`ai-chat-document-extraction-trust-and-formats-approved-spec.md`](../60-product-reasoning/ai-chat-document-extraction-trust-and-formats-approved-spec.md)
implemented in full. Full suite **2164/2162**, the same 2 pre-existing
unrelated failures, zero regressions, 18 net new tests.

**The trust check.** `documentTableExtractionService.extractRecords` now
returns a `coverage` assessment alongside `sequential_id` records, and
`documentAnalysisService` refuses with a new `unreliable_extraction` status
when it fails. The check counts `RECORD_IDENTITY_MARKER` (`DoB:` — the
one-per-person half of `STUDENT_ROW_SIGNAL_PATTERN`; the semester/regulation
half repeats per subject and is unusable for counting) and requires every
marker to be accounted for, as either its own record or one of the
page-break merges this detector performs itself. Two failure modes are
reported separately — `orphanCount` (rows never reached) and
`collapsedRecords` (several rows swallowed into one). `applicable: false`
when a document carries no marker at all: no signal must mean no judgement,
never a refusal. `coverage` is `null` for `delimited`, which is exact by
construction.

Measured after implementation, unchanged from the pass:

| | strategy | records | coverage |
|---|---|---|---|
| result sheet | `sequential_id` | 1603 | reliable, 1781/1781, 0 orphans, 0 collapsed |
| exam fees | `sequential_id` | 4 | **unreliable**, 17/23, 6 orphans, 3 collapsed |
| day book | `delimited` | 839 | n/a |

**Formats.** `text/csv` now routes to `exceljs`'s `csv.read` (method
`exceljs_csv`) rather than `extractPlainTextDirect`, emitting the same
`' | '` rows the `delimited` strategy already consumes — so no table-detector
change was needed for csv, and quoted commas are handled by a real parser
rather than a split. A docx containing a `w:tbl` goes through
`mammoth.convertToHtml` (method `mammoth_tables`) so row/cell structure
survives; a docx **without** a table takes the original `extractRawText`
path untouched, which makes prose output byte-identical by construction
rather than by assertion. Tab-delimited plain text is admitted; commas are
deliberately never admitted as a delimiter anywhere.

**The tab guard was tightened during the slice, by measurement.** The first
version required only that tab-carrying lines be a majority and agree on a
column count — and a test written to fail it did not fail: a ragged
indented list genuinely satisfies both, because `"<tab>one"` and
`"<tab>five"` really do agree on a column count of 2. The guard now also
requires every cell on a line to have content, on the principle that a
delimiter separates content from content while an indent separates nothing
from content. The trade-off is recorded and deliberate: a genuine TSV whose
rows mostly contain a blank cell will not be detected, and under-detecting
leaves today's honest `strategy: 'none'` while over-detecting would misread
prose as a table — the exact failure this slice exists to remove.

**An unplanned result.** The Tally day book — previously `strategy: 'none'`,
one of the three documents that motivated this item — turns out to have a
tab-separated PDF text layer and now yields **839 delimited records**. Its
columns are *not* reliably aligned, because the source omits empty cells
rather than emitting consecutive tabs (a row with no debit amount arrives
with 5 cells against a 6-column header). That does not affect what ships
here, which matches patterns against row text, but it **will** affect
queued item 2's column-indexed `groupBy` and is recorded now so that pass
does not rediscover it. Note also that `delimited` is exact for row
identification but not for column alignment when a source omits empty
cells; "exact by construction" in the spec should be read with that scope.

**Live-checked, both required cases.** Exam-fees PDF:
`toolsUsed: ["analyze_document_table"]`, `verification: INSUFFICIENT_EVIDENCE`,
and an answer that refuses and states the shortfall — where before the same
document produced `status: 'ok'` with `total: 17`. Reference regression on
the result sheet: **77 arrears across 21 students, `verification: PASS`**,
identical to the pre-slice figure.

**One defect the live check caught, and fixed.** The first refusal ended
"Please re-upload a clearer copy of the document" — which the spec's own
Edge cases forbid ("never imply the document is invalid or that the user
did something wrong"), and which is also simply false: the document is
fine, ARCNAVE cannot read merged-cell PDF layouts yet. The tool description
now states the limitation is this system's and explicitly forbids asking
for a re-upload. Re-checked live; the answer now says so correctly.

**Found, not fixed, out of scope.** On one live run the model supplied
`sectionPattern: "(?i)ELECTRONICS..."` — a Python-style inline flag that
JS `RegExp` rejects — and `filterBySection` threw
`DocumentAnalysisValidationError` out of the turn rather than degrading.
Pre-existing (that throw predates this slice), nondeterministic, and
unrelated to extraction; a retry with the same question succeeded. Recorded
here rather than fixed in place, per the OUT OF SCOPE boundary.

**Status:** Resolved — implemented and verified. Item 1's remaining slice
(PDF geometric reconstruction) is unstarted and needs its own pass.
