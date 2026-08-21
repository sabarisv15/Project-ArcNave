# RS-IDN — Institutional Identity & Authorization

**Domain:** The Position/Account/Occupant model, capability resolution,
identity contexts, session lifecycle, audit identity, display labelling.
**Owning service:** `IdentityService`.

---

## RS-IDN-001

**Identity is organizational, not personal: the model is
`Position → Institutional Position Account → Occupant`, never
`Position → User`.**

| Concept | Definition |
|---|---|
| **Position** | The organizational seat: its institution, structural level, `position_type`, and title. |
| **Position Account** | The permanent, position-centric identity. Owns the official institutional mailbox, credential, MFA enrolment state, recovery methods, session-version counter, refresh tokens, resolved permissions and audit identity. Exactly one per Position. |
| **Occupant** | An append-only, time-boxed link between a Position Account and the person currently holding it. Carries no credentials, MFA or session state of its own. |

Cardinality is enforced at the database level: one account per position, at
most one *active* occupant per account, at most one active owning position per
department. A person MAY hold zero, one or more positions; holding none is the
ordinary case, not an error state.

A `Position → User` design has nothing for a credential, session or revocation
to attach to that is not the person's own record, which makes
"occupant changes, account remains" structurally impossible rather than merely
unbuilt.

| | |
|---|---|
| **Owner** | `IdentityService` |
| **Authority** | System invariant |
| **Depends on** | — |
| **Governs** | [RS-IDN-002](RS-IDN-identity.md#rs-idn-002), [RS-IDN-003](RS-IDN-identity.md#rs-idn-003), [RS-IDN-005](RS-IDN-identity.md#rs-idn-005), [RS-IDN-006](RS-IDN-identity.md#rs-idn-006), [RS-IDN-010](RS-IDN-identity.md#rs-idn-010), [RS-IDN-011](RS-IDN-identity.md#rs-idn-011), [RS-STF-004](RS-STF-staff.md#rs-stf-004), [RS-STF-009](RS-STF-staff.md#rs-stf-009) |
| **Lifecycle** | Position, Occupancy |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 0, 2 |
| **Data effect** | Creates; append-only |
| **Implementation** | `positions`, `position_accounts`, `position_occupants`, `position_module_assignments`, `position_department_assignments`, `position_class_assignments` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-021](../30-decisions/adr-register.md#adr-021) |

---

## RS-IDN-002

**Positions and Position Accounts are created once and never deleted;
lifecycle state is expressed by the presence or absence of an active link,
never by removing a row.**

A Position MAY exist with no active occupant; its account and history persist
regardless. "Retiring" a position means it has no active occupant and none is
expected — represented by the absence of an active occupant link, not by a
dedicated status field or a deletion.

Every table in this model carries its own tenant identifier directly, so
tenant-isolation enforcement is a single-column check with no exception and no
join.

| | |
|---|---|
| **Owner** | `IdentityService` |
| **Authority** | System invariant |
| **Depends on** | [RS-TEN-001](RS-TEN-tenancy-security.md#rs-ten-001), [RS-DAT-001](RS-DAT-data-integrity.md#rs-dat-001), [RS-IDN-001](RS-IDN-identity.md#rs-idn-001) |
| **Governs** | [RS-IDN-010](RS-IDN-identity.md#rs-idn-010) |
| **Lifecycle** | Position: `created → occupied ⇄ vacant` (no terminal state) |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 0, 2 |
| **Data effect** | Preserves — append-only ledgers |
| **Implementation** | No `DELETE` path exists in application access |
| **Conformance** | Conformant |
| **Decisions** | [ADR-021](../30-decisions/adr-register.md#adr-021) |

---

## RS-IDN-003

**Position Accounts exist for Levels 1, 2 and 3, and for Level 4 positions
carrying a real `position_type` assignment. Plain Level 4 staff are
person-centric and outside this model entirely.**

| Level | Position row | Provisioning |
|---|---|---|
| 1 | Yes | Automatic and unconditional when a college's Principal invitation is accepted. Standing behaviour, not a rollout flag |
| 2 | Yes, where the institution has an L2 | Created and titled by L1 |
| 3 | Yes | Platform-defined, one per department |
| 4 with `position_type` | Yes | L3-provisioned, own-department-scoped, on first assignment |
| 4 without `position_type` | **No** | No Position, no Position Account |

`position_type` is orthogonal to level: the Class Tutor carve-out is **not a
new level**. The `1–4` level range is unchanged and the value space of
`position_type` is expected to grow (Placement Coordinator, NSS Coordinator,
Library In-charge, Exam Cell) without inventing a level per assignment.

Scope for a plain Level 4 staff member comes from assignment data outside this
model — faculty allocation and timetable linkage — not from position data.

| | |
|---|---|
| **Owner** | `IdentityService` |
| **Authority** | System invariant |
| **Depends on** | [RS-IDN-001](RS-IDN-identity.md#rs-idn-001), [RS-GOV-014](RS-GOV-governance.md#rs-gov-014) |
| **Governs** | [RS-IDN-014](RS-IDN-identity.md#rs-idn-014), [RS-STF-004](RS-STF-staff.md#rs-stf-004), [RS-STF-010](RS-STF-staff.md#rs-stf-010) |
| **Lifecycle** | Position |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 0, 2 |
| **Data effect** | Creates |
| **Implementation** | `positions.level` CHECK `1-4`; `positions.position_type` nullable, no DB enum. **Corrected 2026-07-25**: every position-creation call site for HOD (`ensureHodPositionForInvite`, `staffService.js`'s HOD provisioning path) creates the position with `level: 3` — verified directly against code, no `level: 2` assignment for HOD exists anywhere in the codebase |
| **Conformance** | Conformant — the stored level already matches the business L-number. This was **not** an open question; see [ADL-021](../30-decisions/ledger.md#adl-021) for the correction |
| **Decisions** | [ADR-021](../30-decisions/adr-register.md#adr-021), [ADL-021](../30-decisions/ledger.md#adl-021) (historical — describes a mismatch that does not exist in the current code) |

---

## RS-IDN-004

**No rule, route, permission check or invitation path may require an L2 to
exist in order for an L1, L3 or L4 action to complete.**

L2 is optional and most colleges will not have one. Any mechanism whose
required actor level for an L3 action resolves to 2 makes that action
structurally impossible at every college without an L2. The required actor
level for creating or reassigning a Level 3 seat is **L1**.

Both L2's and L3's occupants are configured strictly and exclusively by L1,
never by each other.

| | |
|---|---|
| **Owner** | `IdentityService` |
| **Authority** | L1 |
| **Depends on** | [RS-GOV-014](RS-GOV-governance.md#rs-gov-014) |
| **Governs** | [RS-WFL-002](RS-WFL-workflow.md#rs-wfl-002), [RS-STF-001](RS-STF-staff.md#rs-stf-001), [RS-STF-002](RS-STF-staff.md#rs-stf-002), [RS-STF-007](RS-STF-staff.md#rs-stf-007) |
| **Lifecycle** | Occupancy |
| **Workflow** | Invitation, recursive by scope |
| **AI** | — |
| **Modules** | 2 |
| **Data effect** | — |
| **Implementation** | Recursive-inviter table in `positionAccountInvitationService.js` |
| **Conformance** | Conformant (fixed 2026-07-25, Stage 2). See [ADL-006](../30-decisions/ledger.md#adl-006) |
| **Decisions** | [ADL-006](../30-decisions/ledger.md#adl-006) |

---

## RS-IDN-005

**Two identity contexts exist and are never merged into one union.**

A person MAY hold both a personal login and, separately, credentials for an
office they occupy — two logins per person, deliberately.

| | Personal Identity Context | Institutional Identity Context |
|---|---|---|
| Represents | The authenticated individual | One Position Account |
| Capability semantics | Union of every position the person currently holds | Exclusively that one account's own scope |
| Purpose | The user's own workspace and personal operations | Acting on behalf of a specific institutional entity |
| Resolver | `resolveCapabilities({ userId, collegeId })` | `resolveCapabilitiesForPosition({ positionAccountId })` |

The two resolvers are siblings: neither calls the other, and neither is layered
on the other. The institutional resolver takes a `positionAccountId` and never
a `userId`, so there is structurally no user identity available to accidentally
union against.

| | |
|---|---|
| **Owner** | `IdentityService` |
| **Authority** | System invariant |
| **Depends on** | [RS-IDN-001](RS-IDN-identity.md#rs-idn-001), [RS-IDN-006](RS-IDN-identity.md#rs-idn-006), [RS-STF-009](RS-STF-staff.md#rs-stf-009) |
| **Governs** | [RS-IDN-008](RS-IDN-identity.md#rs-idn-008), [RS-AIG-010](RS-AIG-ai-governance.md#rs-aig-010), [RS-AIG-011](RS-AIG-ai-governance.md#rs-aig-011) |
| **Lifecycle** | Session |
| **Workflow** | — |
| **AI** | AI consumes whichever context resolved; it MUST NOT branch on which |
| **Modules** | 0, 2, 9 |
| **Data effect** | — |
| **Implementation** | `services/identityService.js`; `middleware/identity.js` branches on token `type` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-022](../30-decisions/adr-register.md#adr-022), [ADR-023](../30-decisions/adr-register.md#adr-023) |

---

## RS-IDN-006

**Capability resolution is a single frozen public façade composed of
independent single-purpose resolvers; nothing bypasses it.**

Routes, AI tools and workflow routing MUST require only the façade — never an
internal resolver module directly — and no resolver module may call another
resolver. Only the façade composes them.

| Concern | Resolver |
|---|---|
| A person's active positions | Position resolution |
| Modules an active position owns | Module resolution |
| Departments an active position owns | Department resolution |
| Classes a `class_tutor` position owns | Class resolution |
| The current occupant of an account | Occupant resolution |
| Visibility scope implied by a position | Visibility resolution |

The façade resolves **facts only** and never decides "is this allowed"; RBAC,
the AI Policy Gate and workflow routing turn facts into decisions. It is
read-only: every mutation belongs to the reassignment lifecycle
([RS-IDN-010](#rs-idn-010)), never to this façade. No caching layer exists;
every call re-reads through the request's own transaction connection.

"No active position" is never an error — it is the ordinary person-centric case
and resolves to `staff` / `self_assigned`.

| | |
|---|---|
| **Owner** | `IdentityService` |
| **Authority** | System invariant |
| **Depends on** | [RS-IDN-001](RS-IDN-identity.md#rs-idn-001) |
| **Governs** | [RS-IDN-005](RS-IDN-identity.md#rs-idn-005), [RS-IDN-007](RS-IDN-identity.md#rs-idn-007), [RS-WFL-005](RS-WFL-workflow.md#rs-wfl-005) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | Binding |
| **Modules** | 0, 2, 9 |
| **Data effect** | — |
| **Implementation** | `services/identityService.js` façade; `services/identity/*Resolver.js` internal |
| **Conformance** | Conformant |
| **Decisions** | [ADR-022](../30-decisions/adr-register.md#adr-022), [ADR-023](../30-decisions/adr-register.md#adr-023) |

---

## RS-IDN-007

**Authorization resolves against the request's live `effectiveRole`, never
against a role claim embedded in a token.**

A token asserts who logged in; it does not get to keep asserting what they may
do. `effectiveRole` is a derived label — never a stored value — computed per
request from live position data, chosen specifically so that authorization
logic compares one label regardless of which resolver produced it.

| Context | Derivation |
|---|---|
| Personal | Active Level 1 → `principal`; else active Level 3 → `hod`; else `staff`. Lower level number wins where both are held |
| Institutional | Purely mechanical from the one position: level 1 → `principal`/`college`; level 2 → `level2`/`department`; level 3 → `hod`/`department`; level 4 with `position_type='class_tutor'` → `class_tutor`/`class` |

The permission table itself remains a static code-level role-to-permission map,
not yet tenant-configurable — a declared gap
([RS-GOV-013](RS-GOV-governance.md#rs-gov-013)) — but its *input* is live.

| | |
|---|---|
| **Owner** | Authorization Resolution |
| **Supporting Components** | `IdentityService`, RBAC middleware |
| **Authority** | System invariant |
| **Depends on** | [RS-IDN-006](RS-IDN-identity.md#rs-idn-006) |
| **Governs** | [RS-IDN-008](RS-IDN-identity.md#rs-idn-008), [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009), [RS-STF-009](RS-STF-staff.md#rs-stf-009), [RS-AIG-010](RS-AIG-ai-governance.md#rs-aig-010) |
| **Lifecycle** | Session |
| **Workflow** | — |
| **AI** | The AI Policy Gate MUST resolve against `effectiveRole` |
| **Modules** | 0, 2, 9 |
| **Data effect** | — |
| **Implementation** | `middleware/rbac.js` `requirePermission`; `PERMISSION_ROLES` includes `level2`, `class_tutor` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-022](../30-decisions/adr-register.md#adr-022), [ADL-021](../30-decisions/ledger.md#adl-021) |

---

## RS-IDN-008

**A Position Account token carries no role claim at all.**

| Token `type` | `sub` | Role claim | Session counter source |
|---|---|---|---|
| `access` | `userId` | Present | `users.token_version` |
| `position_access` | `positionAccountId` | **Absent** | `position_accounts.token_version` |

Role is derived fresh every request from live position state and is never
trusted from a Position Account token.

| | |
|---|---|
| **Owner** | Position Account Session |
| **Supporting Components** | `AuthService`, `IdentityService` |
| **Authority** | System invariant |
| **Depends on** | [RS-IDN-005](RS-IDN-identity.md#rs-idn-005), [RS-IDN-007](RS-IDN-identity.md#rs-idn-007) |
| **Governs** | [RS-IDN-009](RS-IDN-identity.md#rs-idn-009) |
| **Lifecycle** | Session |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 2 |
| **Data effect** | — |
| **Implementation** | `services/positionAccountAuthService.js`; `POST /position-accounts/login`/`/refresh`/`/logout` |
| **Conformance** | Conformant |
| **Decisions** | [ADR-023](../30-decisions/adr-register.md#adr-023) |

---

## RS-IDN-009

**Every authenticated request re-validates the token's session version against
the database, unconditionally.**

The check is not behind a rollout flag and is not cached. It runs after the
token has been decoded and tenant context established, and rejects a token that
is structurally valid but names a stale session version. It does not reject a
missing, invalid or expired token — that is a separate, earlier check.

The session-version counter is incremented, and all of that identity's refresh
tokens revoked, whenever: a password is reset, MFA is reset, or a Position
Account's occupant changes. There is no partial-revocation window.

| | |
|---|---|
| **Owner** | `AuthService` |
| **Authority** | System invariant |
| **Depends on** | [RS-IDN-008](RS-IDN-identity.md#rs-idn-008) |
| **Governs** | [RS-TEN-008](RS-TEN-tenancy-security.md#rs-ten-008), [RS-IDN-010](RS-IDN-identity.md#rs-idn-010) |
| **Lifecycle** | Session: `issued → (valid \| revoked)` |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 0, 2 |
| **Data effect** | — |
| **Implementation** | `middleware/sessionRevocation.js` with `access` and `position_access` branches; append-only refresh-token table |
| **Conformance** | Conformant |
| **Decisions** | [ADR-024](../30-decisions/adr-register.md#adr-024) |

---

## RS-IDN-010

**Occupant reassignment is one atomic, all-or-nothing operation, uniform
across Levels 1, 2, 3 and the Class Tutor assignment.**

The sequence, in order:

1. Revoke all active sessions for the account.
2. Invalidate every outstanding refresh credential.
3. Increment the session-version counter.
4. Reset credentials by issuing a **fresh invite** — never a mailed temporary
   password. The incoming occupant sets their own password and never inherits a
   system-generated one or the outgoing occupant's.
5. Clear MFA enrolment and recovery methods.
6. Close the old occupant link and open the new one.
7. Require password change and MFA re-enrolment on first login.

**Unchanged by the sequence:** the official mailbox, resolved permissions and
audit history. Reassignment resets who can log in, never what the position is
or has done.

The operation runs unconditionally whenever the occupant actually changes,
including filling a previously vacant seat, and is idempotent: reassigning to
the current occupant is a no-op. Even if implemented as a saga across a session
store, mailbox provider and MFA provider, it MUST present as atomic. A partial
handover — password reset but old sessions still live — is a security gap, not
a cosmetic one.

| | |
|---|---|
| **Owner** | `IdentityService` |
| **Authority** | L1 (L2/L3 seats), L3 (Class Tutor seats) |
| **Depends on** | [RS-IDN-001](RS-IDN-identity.md#rs-idn-001), [RS-IDN-002](RS-IDN-identity.md#rs-idn-002), [RS-IDN-009](RS-IDN-identity.md#rs-idn-009) |
| **Governs** | [RS-IDN-014](RS-IDN-identity.md#rs-idn-014), [RS-WFL-005](RS-WFL-workflow.md#rs-wfl-005), [RS-GOV-007](RS-GOV-governance.md#rs-gov-007), [RS-CLS-003](RS-CLS-classroom.md#rs-cls-003), [RS-STF-005](RS-STF-staff.md#rs-stf-005), [RS-STF-007](RS-STF-staff.md#rs-stf-007), [RS-STF-010](RS-STF-staff.md#rs-stf-010), [RS-CLS-011](RS-CLS-classroom.md#rs-cls-011) |
| **Lifecycle** | Occupancy: `invited → active → closed` (append-only) |
| **Workflow** | L3 seat: request to L1, or L1 direct. Class Tutor seat: L3 direct |
| **AI** | Prohibited |
| **Modules** | 2 |
| **Data effect** | Preserves — occupant history accumulates indefinitely |
| **Implementation** | `positionAccountInvitationService.reassignPositionOccupant` — one shared function, not per-type copies |
| **Conformance** | Conformant |
| **Decisions** | [ADR-021](../30-decisions/adr-register.md#adr-021) |

---

## RS-IDN-011

**Audit identity is compound and never collapsed: who acted and in what
capacity are recorded as separate facts.**

Every audit event carries four distinct fields: the **Actor** (the person), the
**Acting Position Account** (null where there is no position context), the
**Position** (recorded independently so history can be queried regardless of
who occupied it when), and **Timestamp / Action / Resource**.

This is what makes *"Approved by: Position — Principal · Acting Person — Dr.
Arun Kumar"* representable without collapsing to one half of the fact. A query
against the Position returns its full approval history across every occupant; a
query against the Actor returns exactly what one person did.

| | |
|---|---|
| **Owner** | Audit Identity |
| **Supporting Components** | `IdentityService`, audit ledger |
| **Authority** | System invariant |
| **Depends on** | [RS-IDN-001](RS-IDN-identity.md#rs-idn-001), [RS-DAT-006](RS-DAT-data-integrity.md#rs-dat-006) |
| **Governs** | — |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | AI actions record the same four fields |
| **Modules** | 0, 2 |
| **Data effect** | Preserves |
| **Implementation** | `audit_log` gained `position_account_id`/`position_id` via `1757500000000_audit-log-identity-columns.js` (both nullable FKs). `auditLogRepository.createAuditLogEntry` populates them by default from ambient request-context capabilities (`resolveCapabilitiesForPosition`, threaded via `AsyncLocalStorage` the same way `collegeId`/`requestId` already are) — an explicit `null` from a caller is respected, only an *omitted* key falls back to the ambient value. **Corrected 2026-07-25 (audit-error correction, not a spec or code fix)**: the prior "columns do not exist" claim was false — verified directly against the migration and repository. |
| **Conformance** | Conformant. **Swept 2026-07-26 (Stage 8c)**: all 115 `createAuditLogEntry` call sites are `await`ed within the same async chain `requestContextMiddleware`/`identityMiddleware` establish (no fire-and-forget/detached-context call found), every authenticated tenant route resolves `req.capabilities` before any business logic runs, and the 3 pre-`identityMiddleware` routes (`invitations`/`positionAccountInvitations`/`staffInvitations` accept endpoints) call `createAuditLogEntry` zero times — no gap found, verification closed. |
| **Decisions** | [ADR-021](../30-decisions/adr-register.md#adr-021) |

---

## RS-IDN-012

**L1–L4 is the authority structure; job titles are per-college display labels
resolved at render time only.**

ARCNAVE's default display names are L1 = Principal, L3 = HOD, L4 = Class Tutor.
L2 has no fixed default label because what it covers varies by institution.
A college MAY relabel any seat — "Director", "Dean", "Coordinator" — and that
custom label is what renders everywhere in ARCNAVE for that college.

**The underlying authority logic never changes; only the rendered label does.**
Internal role keys (`principal`, `hod`, `staff`, `class_tutor`) are unchanged in
every route guard, JWT claim and AI tool `allowedRoles` list. Relabelling is
additive with zero changes to authorization code.

"Faculty" is not a level's display name: it refers to ordinary teaching staff,
who sit outside the L1–L4 numbered accounts entirely unless one of them also
holds an L4 seat.

| | |
|---|---|
| **Owner** | `ConfigurationService` |
| **Authority** | L1 |
| **Depends on** | [RS-GOV-013](RS-GOV-governance.md#rs-gov-013) |
| **Governs** | [RS-GOV-017](RS-GOV-governance.md#rs-gov-017) |
| **Lifecycle** | — |
| **Workflow** | None — L1 direct write, audited |
| **AI** | AI renders the institution's own labels |
| **Modules** | 0 |
| **Data effect** | Supersedes |
| **Implementation** | **Stage 8b (2026-07-25), backend only:** `colleges.level1_position_title`/`level3_position_title`/`level4_position_title` (`collegeProfileRepository.js`), consulted at render time by `aiActorContext`'s Identity Context block. No frontend surface renders `positions.title` (this rule's own per-college label) anywhere yet — deliberately deferred, not a bug, until a real screen needs it. **Still true as of 2026-08-01**, despite a real tenant Profile page now existing (`ProfilePage.jsx`, built the same day as [RS-GOV-017](RS-GOV-governance.md#rs-gov-017)): that page renders `users.designation` — a different, personal profile field seeded from the same wizard input at onboarding but independently editable afterwards (see RS-GOV-017's own cross-reference) — not `positions.title`/`level1_position_title`. The two must not be conflated when this rule is next revisited. |
| **Conformance** | Partial — Conformant on the backend; frontend display deliberately not built |
| **Decisions** | [ADL-004](../30-decisions/ledger.md#adl-004) |

---

## RS-IDN-013

**Students never have a login or a dashboard.**

Students are record subjects, not actors. Attendance, marks, documents and
notices are accessed only by authorized institutional users, and by the student
themselves where a student portal is enabled. Dashboards are role-based and
configurable per institution; AI personalises dashboard content by active role
and current assignments and MUST NOT assume Class Tutor privileges outside an
active assignment.

| | |
|---|---|
| **Owner** | `IdentityService` |
| **Authority** | System invariant |
| **Depends on** | — |
| **Governs** | [RS-STU-012](RS-STU-students.md#rs-stu-012) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | AI never exposes student information outside role-based access control |
| **Modules** | 1 |
| **Data effect** | — |
| **Implementation** | No student authentication path exists |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-IDN-014

**A Class Tutor assignment is a Position Account, not a `users.role` value and
not a foreign key on the class row.**

`users.role` does not gain a `class_tutor` value. "Role" means job title, and a
faculty member's role stays `staff` regardless of whether they currently hold
an L4 assignment. An L4 assignment is a Level 4 Position with
`position_type = 'class_tutor'`, linked to its class through the class
assignment table, following the identical Position/Account/Occupant model L3
uses one level up.

L3's assignment is an **assignment action, not a role grant**, and is enforced
through a dedicated assignment endpoint under an assignment permission,
HOD-only and own-department-scoped — never through a generic role guard, and
never through the general class-update endpoint, which explicitly rejects a
tutor field rather than silently accepting it.

| | |
|---|---|
| **Owner** | Class Tutor Position |
| **Supporting Components** | `IdentityService`, `StaffService` |
| **Authority** | L3, own department only |
| **Depends on** | [RS-IDN-003](RS-IDN-identity.md#rs-idn-003), [RS-IDN-010](RS-IDN-identity.md#rs-idn-010) |
| **Governs** | [RS-CLS-003](RS-CLS-classroom.md#rs-cls-003), [RS-CLS-004](RS-CLS-classroom.md#rs-cls-004) |
| **Lifecycle** | Position, Occupancy |
| **Workflow** | None — direct assignment; credentials issued as an invite |
| **AI** | Prohibited |
| **Modules** | 2, 3 |
| **Data effect** | Creates |
| **Implementation** | `POST`/`PUT /classes/:id/tutor`, permission `classes.assign_tutor`; `position_class_assignments`; `classes.tutor_user_id` fully removed |
| **Conformance** | Conformant |
| **Decisions** | [ADR-021](../30-decisions/adr-register.md#adr-021) |
