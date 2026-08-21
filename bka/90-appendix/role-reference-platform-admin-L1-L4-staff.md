# Role Reference — Platform Admin, L1, L2, L3, L4, Staff

Consolidated reference across all six actor types in ARCNAVE's institutional
model. Compiled from `docs/bka/00-foundation/actor-model.md`,
`docs/bka/10-specification/RS-GOV-governance.md`,
`docs/bka/10-specification/RS-IDN-identity.md`,
`docs/bka/10-specification/RS-TEN-tenancy-security.md`,
`docs/bka/10-specification/RS-STF-staff.md`,
`docs/bka/20-matrices/ROLE-COVERAGE.md`,
`docs/bka/30-decisions/ledger.md`, `docs/bka/30-decisions/adr-register.md`,
`docs/bka/90-appendix/glossary.md`. Every claim below is cited to its
source file/section; items with no `docs/bka` backing are explicitly
flagged as **spec-silent** (implementation-only, not documented in the
spec estate).

Login/role mental model (see project memory), corrected 2026-08-16 across
two precision passes: **4 human accounts** exist — L1, L3, L4, and
staff-personal — but a person may hold **two distinct sessions/contexts**
simultaneously: their personal Staff context (`access` token) and an
institutional Position Account context (`position_access` token) if they
currently occupy L1/L2/L3/L4. **Class Tutor (L4) is not merely a "visual
badge"** — it is a real, separate institutional Position Account session
with its own `position_access` token and its own active-class scope,
held *alongside* the person's personal Staff login, not folded into it
(RS-IDN-003, RS-IDN-005, RS-IDN-014). "Badge" undersells it: authority
for L4 actions comes from the resolved active Position Account context,
never from a UI label. **L2 is the same** — a real Position Account with
its own `position_access` session when it exists, not a delegated
capability inside personal Staff login (RS-IDN-003, RS-IDN-007,
[ADL-034](../30-decisions/ledger.md#adl-034)) — see §3. Every level's
session comes from the resolved active Position Account context, never
from a title or UI label; this is the core rule and it applies uniformly
to L1/L2/L3/L4, with no exception at L2. Platform Admin is a separate
platform-side login outside this set entirely.

---

## 1. Platform Admin

**Purpose/Scope.** The single ARCNAVE-employee (not institution-employee)
role. Onboards colleges and executes a fixed, enumerated set of
structural changes. Never touches operational/academic content.

**Hierarchy Position.** None — "not a seat in any tenant's role model"
(`actor-model.md` §2). Entirely outside the L1–L4 institutional
hierarchy, on the platform side.

**Optionality.** N/A in the L1–L4 sense — the one and only platform-side
role, always present (`actor-model.md` §2, RS-GOV-001).

**Hard boundaries.**
- Never has a tenant `users` row; never executes inside the RLS-scoped
  tenant path (RS-TEN-004).
- Authority is bounded by *kind of change, not frequency*: owns the
  college's structural/legal identity; the college owns its own
  operational policy (RS-GOV-002).
- No ongoing role in day-to-day operation/policy after onboarding: no
  workflow config, no Academic Year changes, no profile maintenance, no
  staffing (RS-GOV-002, RS-GOV-004).
- Exactly **five** post-onboarding structural actions, each gated behind
  a single-use, L1-issued authorization key: (1) L2 configuration
  existence/scope, (2) affiliation changes, (3) new campus, (4)
  merge/rename department (incl. intake/duration), (5) accreditation
  changes (RS-GOV-005). Cannot act on its own initiative or a general
  support request.
- Cannot refuse to act on a valid key for discretionary reasons
  (RS-GOV-006).
- Never substitutes for L1's authority; a vacant L1 seat has no
  Platform-Admin fallback (RS-GOV-007).
- No AI path at all — "no path into the tenant AI Workspace exists"
  (RS-GOV-001, RS-TEN-004); `ROLE-COVERAGE.md` §5 confirms it's audited
  separately, AI-first rule does not apply.

**Onboarding responsibilities.**
- Exclusively creates the college, its departments (name, approved
  intake, course duration), and initial configuration (RS-GOV-003).
  Decides at onboarding whether the college has an L2 level and what it
  covers (RS-GOV-014).
- Onboarding-time department creation feeds the Readiness gate
  (`ready → active` requires every onboarding department to have ≥1
  enrolled student — RS-GOV-011).
- Invites the Principal (L1); Principal Invitation is its own lifecycle
  (`created → resent/revoked → accepted`), owned by Platform Admin,
  separate from college creation (RS-GOV-016).
- Captures the incoming L1's personal-profile fields (name, designation,
  phone, address) live during onboarding — these auto-populate the real
  Principal `users` row at accept time, reversing the usual
  self-fill-on-invite pattern (RS-GOV-017).
- Sets license (Trial/Full) at creation, defaulting from a platform-wide
  setting; Trial carries a fixed 30-day expiry (RS-GOV-015).
- Manages `provisioning_status` lifecycle:
  `provisioning → ready → active ⇄ suspended → archived`, plus
  `cancelled` (RS-GOV-010). Reactivation/archival are direct Platform
  Admin actions, never key-gated (RS-GOV-012).

**Login/Account model.** Separate Platform API with its own auth;
`admin.arcnave.com` vs `<college>.arcnave.com`. Never a tenant login
(RS-TEN-004, `actor-model.md` §2).

**Related ADRs/rules.** RS-GOV-001–017; RS-TEN-004; ADR-010 (platform
layer as separate app); ADL-001 (platform-side actor consolidation,
retired "Super Admin"/`college_admin`); ADL-025 (license/trial window);
ADL-026 (invitation resend/revive); ADL-027 (wizard profile
auto-population).

**Notable history/gotchas.**
- "Super Admin" and `college_admin` are **retired naming** — neither is
  valid in the spec (`actor-model.md` §2, glossary). `college_admin` has
  **no successor**; its ownership moved to L1.
- `ROLE-COVERAGE.md` flags 3 open gaps: structural-key redemption UI,
  provisioning-lifecycle-action UI, dashboard-summary widgets — all "not
  in current shipped nav," acknowledged, unresolved.
- RS-GOV-012: terms-based automatic reactivation is **not built** — no
  terms-acceptance flow exists in the codebase; every reactivation today
  uses the "any other reason" direct Platform Admin path.

---

## 2. L1 (Principal)

**Purpose/Scope.** Top of the institutional hierarchy — college-wide
scope. Default display label "Principal," relabelable per college.

**Hierarchy Position.** Level 1. Chain: `L1 → L2 (if present) → L3 → L4`,
or `L1 → L3 → L4` without L2 (`actor-model.md` §3).

**Optionality.** **Not optional** — provisioned automatically and
unconditionally when a college's Principal invitation is accepted;
"standing behaviour, not a rollout flag" (RS-IDN-003, `actor-model.md`
§3 table).

**Fixed vs configurable.**
- Job title is a per-college display label
  (`colleges.level1_position_title`), resolved at render time only — the
  underlying L1–L4 authority logic never changes (RS-IDN-012).
- Whether the college has an L2 is decided by Platform Admin at
  onboarding, changeable afterward only via the key process; once L2
  exists, **L1** configures its scope, chain position, and occupancy
  (RS-GOV-014).
- L1 generates/cancels structural authorization keys; only L1 can
  (RS-GOV-005, RS-GOV-006).
- After onboarding, essentially every operational configuration is
  freely L1-editable at any time — workflow chains, security policy,
  assessment/examination config, calendar, Academic Year, AI config,
  import/export, alerts, Organization Name, position titles, storage
  backend — with no Platform Admin re-involvement (RS-GOV-004,
  RS-GOV-013). Structural exceptions remain the five key-gated actions
  (RS-GOV-005).

**Authority (`actor-model.md` §8).** May initiate: Academic Year
lifecycle, department addition, all operational configuration,
structural authorization keys, L2/L3 occupancy. May approve: final
approver for timetable; any chain step configured to it. Never may: skip
a mandatory approval floor.

**Role in staff/HOD process.** Approves staff registration as the
(possibly final) step in the L3→L2-or-L1 approval chain (RS-STF-002). An
L3 seat's occupant changes on L1's approval of an L3-initiated request,
or by L1 directly (RS-STF-007). Staff profile administrative edits are
L1-scoped, not L3-scoped (RS-STF-011).

**Login/Account model.** Position Account (`Position → Position Account
→ Occupant`, RS-IDN-001), college scope. Provisioned via
`principal_invitations` → accept flow, same atomic occupant-reassignment
mechanics as other Position Accounts (RS-IDN-010) — fresh invite, never
a mailed temp password. Token type `position_access` when acting
institutionally; carries no role claim, role derived fresh per request
(RS-IDN-008). A person may also separately hold a personal login
(RS-IDN-005).

**Related ADRs/rules.** RS-GOV-002–017; RS-IDN-003, RS-IDN-004 (L2
optionality — L1 is the required actor level for creating/reassigning
L3, not L2), RS-IDN-012; RS-STF-002, RS-STF-007, RS-STF-011; ADL-006
(fixed a live defect: L3-invitation actor level corrected from L2→L1);
ADR-021 (Position Account model).

**Notable history/gotchas.**
- ADL-006: the shipped system once required actor level 2 to invite a
  new L3, "structurally impossible" wherever L2 doesn't exist — corrected
  to L1.
- A vacant L1 seat has no fallback in the key mechanism; every L1-only
  action (including generating a key) simply waits (RS-GOV-007).
- RS-GOV-017: the wizard's single "Designation" field seeds BOTH
  `colleges.level1_position_title` (the seat's per-college label) AND the
  sitting Principal's own personal `users.designation` — they start
  equal but diverge over time and are **not** kept in sync afterward.

---

## 3. L2 (optional intermediate authority)

**Purpose/Scope.** Optional intermediate institutional-authority level
between L1 (Principal) and L3 (HOD). No fixed default display label
("varies by institution" — Vice Principal, Dean, etc.). Duties and
module scope are entirely configured by L1 (`actor-model.md` §3, lines
21/68–78; glossary L1–L4 entry).

**Hierarchy Position.** Default chain (no L2): `L4 → L3 → L1`. With L2
inserted: `L1 → L2 → L3 → L4`. Whether L2 is inserted above L3 is an L1
decision (`actor-model.md` §3; RS-GOV-014; `RS-WFL-workflow.md`, chains
route through L2 only where inserted).

**"L2 Duty Module" (Attendance/Examinations/Assessments/Calendar).**
**Spec-silent.** The spec only speaks generically of L1 deciding "what
L2's duties and module scope cover" (RS-GOV-014) — no rule enumerates
specific duty-module capabilities. The wizard's "L2 Duty Module" concept
is frontend/implementation-only, not in `docs/bka`.

**Optionality.** Fully optional — "most colleges will not have one." A
normative invariant: **no rule/route/permission/invitation path may
require an L2 to exist** — RS-IDN-004, restated as "the L2 optionality
invariant" in `actor-model.md` §3.1, called "the single most frequently
violated constraint in the estate."

**Position row and login/session — resolved 2026-08-16, see
[ADL-034](../30-decisions/ledger.md#adl-034).** This point was a genuine
textual contradiction in the spec estate, not a paraphrase error, and it
has now been checked against shipped code rather than settled by re-reading
prose:
- `RS-GOV-014` (before correction) stated *"Whether L2 has its own login —
  Never — L2's duties surface inside the existing login of whoever holds
  them."*
- `RS-IDN-003` and `RS-IDN-007` (both marked Conformant, unchanged by
  ADL-034) list L2 alongside L1/L3 as getting a real Position Account, and
  mechanically derive `effectiveRole: 'level2'` from a `position_access`
  token — which only exists for a Position Account session.
- Checked against `backend/src/services/positionAccountAuthService.js`'s
  `assertLevelAllowsPositionLogin`: **L2 login is real, shipped, wired
  code** — levels 1–3 are eligible for Position Account login, with a
  full stack behind it (`positionAccountInvitationService.js`,
  `routes/positionAccounts.js`, `position_accounts`/
  `position_account_refresh_tokens` tables). This is not aspirational or
  unreachable — it is already built and already Conformant.
- ADL-034 resolved the contradiction by correcting `RS-GOV-014` and
  `actor-model.md`'s wording to match the already-shipped behavior
  (lower-risk than reversing built code), rather than removing L2's login
  capability from the backend.

**The exact, verified sentence to use going forward:**
> L2 **is** a real Position Account with its own `position_access`
> session, identical in kind to L1/L3 — created and titled by L1, per
> `RS-IDN-003`/`RS-IDN-007`, and eligible for Position Account login per
> `positionAccountAuthService.js`. It is not a delegated capability
> surfaced inside the holder's personal Staff login. The L2 optionality
> invariant (`RS-IDN-004`) is untouched by this — L2 still may not exist
> at a given college, and no rule/route/permission/invitation path may
> require it; this sentence only concerns the session mechanics *when*
> L2 does exist.

**Onboarding-time decisions.** Whether L2 exists is decided by Platform
Admin at onboarding (changeable afterward only via the key process); L1
later configures what L2 covers and whether it's inserted into the chain
(RS-GOV-014; RS-GOV-governance.md onboarding initial-configuration item
#1). The wizard's exact field labels ("L2 Node Required," "L3 Reports
via L2," "L2 Title," "L2 Duty Module") do **not** appear verbatim in
`docs/bka` — **spec-silent**, frontend-only terms.

**Related ADRs/rules.** ADR-021 (Position Account model — applies to L2
per RS-IDN-003, though the ADR text itself doesn't enumerate levels);
RS-IDN-001, RS-IDN-003 (L2 gets a Position Account), RS-IDN-004 (L2
optionality invariant, unaffected by ADL-034), RS-IDN-007
(`effectiveRole: 'level2'` derivation), RS-GOV-014 (existence/scope
authority, login wording corrected by ADL-034), related RS-WFL chain
rules.

**Notable history/gotchas.**
- ADL-034 (2026-08-16): `RS-GOV-014` and `actor-model.md` previously said
  L2 "never" has its own login, directly contradicting `RS-IDN-003`/
  `RS-IDN-007` (both Conformant) and the shipped
  `positionAccountAuthService.js` login gate. Resolved in favor of the
  code — L2 login is real. If you find older notes/exports (including an
  earlier draft of this file, or an intermediate pass that said "L2 has
  no Position Account, no `position_access` token") they predate this
  correction and are superseded.
- `ledger.md` records a real historical bug: a hardcoded requirement of
  an L2 to invite L3 violated the optionality invariant, fixed
  2026-07-25 with a regression test proving L1 can invite L3 with no L2
  present.
- `ledger.md` also flags `workflowChainService`'s L2-or-L1 configurable
  chain resolver as not fully reachable in practice — a still-open
  **implementation** gap, not a spec gap.

---

## 4. L3 (HOD-equivalent)

**Purpose/Scope.** Department-level authority. Default display label
"HOD." Scope: owned department(s).

**Hierarchy Position.** Level 3. `L4 → L3 → L1` (default) or
`L4 → L3 → L2 → L1` if L2 is inserted (`actor-model.md` §3).

**Optionality.** **Not optional** ("No" in `actor-model.md` §3 table) —
Position Account created platform-defined, one per department
(RS-IDN-003).

**Duties/scope (`actor-model.md` §8 + RS-STF/RS-IDN).**
- May initiate: staff invitation, faculty deactivation, L4 assignment,
  substitute approval, department-scoped correction approval. May
  approve: fee-status corrections; student lifecycle transitions
  (mandatory floor); substitute requests; staff registration (first
  step). Never may: act outside their own department.
- Initiates staff registration by invite (email only, no draft request)
  — new staff's department auto-set to L3's own (RS-STF-001).
- First approval step in the staff-registration chain, then L2-or-L1
  finalizes (RS-STF-002).
- Deactivates faculty in their own department, no approval chain needed
  — deliberately lower friction than granting access (RS-STF-005).
- On an outgoing L4 (Class Tutor) seat holder: reassigns via standard
  Position Account reassignment, L3-initiated (RS-STF-006, RS-IDN-014).
- Own seat's occupant change: L1-approved (L3-initiated) or L1-direct —
  L3's login offers "deactivate current occupant" or "appoint Temporary
  In-Charge" (RS-STF-007).
- L4/Class-Tutor assignment is an L3, own-department-only action,
  enforced through a dedicated assignment endpoint/permission
  (`classes.assign_tutor`), never a generic role guard (RS-IDN-014).

**Onboarding-time decisions.** None directly — L3 positions are
platform-defined structurally (one per department); occupancy set by L1
post-onboarding.

**Login/Account model.** Position Account, same Position→Account→Occupant
model as L1 (RS-IDN-001, RS-IDN-003). `effectiveRole` derives to `hod`
institutionally when acting via the position, or personally (`Active L1
→ principal; else active L3 → hod; else staff`, RS-IDN-007).
Reassignment follows the same atomic sequence (revoke sessions,
invalidate refresh tokens, fresh invite, clear MFA — RS-IDN-010),
authority held by L1 (or L1-approved L3 request).

**Related ADRs/rules.** RS-IDN-003, RS-IDN-004, RS-IDN-007, RS-IDN-010,
RS-IDN-014; RS-STF-001, RS-STF-002, RS-STF-005, RS-STF-006, RS-STF-007;
ADL-006 (L1, not L2, required actor level to invite/reassign L3);
ADL-021 (position-level integer vs business L-number — verified no
divergence); ADR-021.

**Notable history/gotchas.**
- ADL-021 is historical: it *describes* a mismatch between stored
  `positions.level` and the business L-number for HOD that was verified
  **not to exist** in current code — every HOD-creation call site
  correctly uses `level: 3`.
- HOD-in-Charge appointment (acting HOD) is a **Principal** action naming
  a person, not HOD's own self-service (`ROLE-COVERAGE.md` §3).

---

## 5. L4

**Purpose/Scope.** Represents a class-scoped position, specifically
`position_type = 'class_tutor'` — default label "Class Tutor". Distinct
from a plain Level-4 staff member.

**Hierarchy Position.** Level 4, below L3. `L3 → L4` (`actor-model.md`
§3).

**Mandatory-ness — a carve-out, not automatic.**
- L4 *with* a real `position_type` assignment: gets a Position/Position
  Account, L3-provisioned, own-department-scoped, created on first
  assignment. Optional/"Per class" (`actor-model.md` §3 table;
  RS-IDN-003).
- L4 *without* `position_type`: **no Position, no Position Account** —
  a plain staff member, entirely outside the Position model
  (RS-IDN-003).
- `position_type` is explicitly orthogonal to level — "the Class Tutor
  carve-out is not a new level"; the value space is expected to grow
  beyond Class Tutor (Placement Coordinator, NSS Coordinator, Library
  In-charge, Exam Cell) (RS-IDN-003).
- Class Tutor assignment is a Position Account, **not** a `users.role`
  value and not an FK on the class row — `users.role` stays `staff`
  regardless (RS-IDN-014).

**Duties (`actor-model.md` §8).** May initiate: student creation and
profile edit, first-time fee marking, attendance/mark correction
approval, Send Alert, examination publication, scholarship eligibility.
May approve: attendance corrections, mark corrections (own class). Never
may: mark attendance they do not own; act outside their own class.

**Onboarding-time decisions.** None — L4 positions arise post-onboarding,
on first assignment by L3.

**Login/Account model.** Position Account when `position_type` assigned
— identical Position/Account/Occupant model as L1/L3 (RS-IDN-003,
RS-IDN-014). Assignment is L3-only, own-department-scoped, via a
dedicated endpoint/permission (`classes.assign_tutor`), never the
generic class-update endpoint (which explicitly rejects a tutor field).
Reassignment follows the standard atomic sequence, authority held by L3
(RS-IDN-010, RS-IDN-014). Without `position_type`, a Level-4 staff
member's scope comes entirely from assignment data outside the position
model — faculty allocation, timetable linkage (RS-IDN-003).

`ROLE-COVERAGE.md` §2 documents its practical capability surface:
superset of Staff capabilities, plus create/edit own-class students,
first-entry fee status, approve attendance/marks corrections, timetable
generation/revision, substitute-assignment initiation, Send Alert,
student flag/clear, Class Monitoring dashboard — cross-checked
GUI/AI/backend, with one flagged-but-unresolved note on fee-correction
submission (Class Tutor isn't meant to file a fee-correction request at
all — corrections happen via re-entry, HOD is the approver).

**Related ADRs/rules.** RS-IDN-003, RS-IDN-010, RS-IDN-014; RS-STF-006;
ADR-021; `ROLE-COVERAGE.md` §2.

**Notable history/gotchas.**
- `ROLE-COVERAGE.md` §2: a real, now-fixed bug from the 2026-07-26 audit
  — a genuine seat-login L4 (as opposed to a personal-staff-member who
  also holds tutor) previously could not create/edit own-class students
  — fixed same session (`class_tutor` added to `students.create/
  update/delete` + `assertCanModifyStudent`).
- Fee correction: `finance_submit_fee_correction` lists only
  `principal`/`hod`, not `class_tutor` — flagged as consistent with the
  documented business rule (L4 enters, L3 approves), not a bug.

---

## 6. Staff (personal login)

**Purpose/Scope.** A person employed by the institution who holds no
Position — person-centric, not seat-centric. The base/default account
type; every human with institutional access who is not (or not
currently) occupying an L1/L2/L3/L4 position is a plain Staff account.

**Hierarchy Position.** Outside the L1–L4 hierarchy entirely
(`actor-model.md` §4). The `actor-model.md` §1 diagram draws
`L4 -.- STAFF` as a dotted (non-hierarchical) association, distinct from
the solid `L1→L2→L3→L4` chain.

**Relationship to L3/Class Tutor/HOD.**
- `users.role` remains `'staff'` regardless of any Position a person
  also holds — "role means job title, not authority" (`actor-model.md`
  §4, RS-IDN-014). A staff member who also holds an L4 Class Tutor
  Position Account is still `users.role = 'staff'`; Class Tutor status
  is a separate Position/Position Account layered on top, never a
  `role` value.
- Class Tutor is a Position Account, distinguishable via the
  Institutional Identity Context (token type `position_access`), not a
  "5th role" — it coexists with the person's own Personal Identity
  Context login as ordinary Staff. A person may hold both logins
  simultaneously, never merged (RS-IDN-005).
- A staff member MAY hold multiple positions/duties simultaneously
  (RS-STF-009); where a single "primary" position is needed, the lower
  level number wins (RS-IDN-007).

**Self-service scope (RS-STF-013, widened by ADL-030 2026-08-04).**
- **Self-service (staff-editable directly, no L1 mediation):**
  first/last name (synced to `full_name`), contact email, mobile
  (OTP-verified, RS-STF-014), date of birth, gender, designation (fixed
  dropdown, not free text), appointment type, structured education
  (doctorate/UG/PG), work experience.
- **Administrative half (L1-scoped only, RS-STF-011):** staff code
  (view-only to the staff member), department assignment (never
  staff-editable, auto-set from inviting L3), date of joining, payroll
  fields (bank account, IFSC, PF number). Principal retains full
  override write access to every field, including self-service ones —
  self-service is additive, not a transfer of authority.
- Religion deliberately excluded — no institutional reporting need
  identified.
- Profile photo stored as a `DocumentService`-owned document reference,
  never a second storage path.

**Other self-service capabilities (RS-STF-012–015, ADL-030).**
- Per-hour teaching log (Class Log) against any class they may view —
  creator-only edit/delete, no correction workflow (RS-STF-012).
- Mobile-number self-report requires WhatsApp OTP verification before
  trust; changing the number resets `phone_verified` to false
  (RS-STF-014).
- Staff Directory: any staff member may view a limited directory (name,
  designation, department, phone) of every colleague — reversing the
  prior "staff sees only own profile" default; HOD/Principal continue to
  get the full profile within their existing scope (RS-STF-015).

**Credential bootstrap.** A plain staff hire keeps its own credential
bootstrap mechanism (`authService.activateUser`), deliberately outside
the Position Account invite-only reassignment rule (RS-STF-010) — "MUST
NOT be corrected to match" the Position Account pattern, because a plain
staff hire is not a Position Account.

**Login/Account model.** Personal Identity Context: subject is
`users.id`, token `type = 'access'`, resolved via
`resolveCapabilities({userId, collegeId})`, capability semantics = union
of every position the person currently holds (RS-IDN-005). No Position
Account, no Position row for plain staff (RS-IDN-001, `actor-model.md`
§4). Registration is invite-first from L3 (no self-initiated request
step), followed by an L3→L2-or-L1 approval chain before the account goes
live (RS-STF-001, RS-STF-002). Deactivated (never deleted) by L3 within
their own department (RS-STF-005, RS-STF-008).

**Related ADRs/rules.** RS-IDN-001, RS-IDN-003, RS-IDN-005, RS-IDN-007,
RS-IDN-014; RS-STF-001–015 (whole staff lifecycle chapter); ADL-007
(staff registration invite-first, retiring the old bare-`POST /staff`
as-user path); ADL-030 (self-service/directory/phone-OTP/
assessment-authoring/calendar widening batch); ADL-029 (student
flag/clear widened to subject faculty, not just tutor).

**Notable history/gotchas.**
- ADL-030 explicitly frames the change as "a staff member may now
  self-edit..." — a deliberate widening decided in one product
  conversation, not incremental drift; five sub-changes shipped together
  (profile self-service, phone OTP, directory reversal, assessment-type
  authoring widened from Principal-only, personal-calendar date-grid).
- `ROLE-COVERAGE.md` §1: Staff capability surface is 100%
  GUI/AI/backend-matched, with three originally-found gaps
  (finance-record-payment over-widening AI, timetable slot-grid-
  generation over-widening GUI, RS-TTB-001 missing AI tool) all resolved
  in commits `1dbfb8e`/`428d817`.

---

## Spec-silent / implementation-only items (flagged during this lookup)

- **L2 Duty Module** (Attendance/Examinations/Assessments/Calendar) —
  wizard-only concept, not in `docs/bka`.
- **Onboarding wizard field labels** ("L2 Node Required," "L3 Reports
  via L2," "L2 Title") — not spec vocabulary.
- **Structural-key redemption UI, provisioning-lifecycle-action UI,
  Platform Admin dashboard widgets** — acknowledged as not built in
  `ROLE-COVERAGE.md` §5.
- **Role management (permission table) is a static code table**, not
  tenant-configurable — declared as an open gap in RS-GOV-013.
- **Terms-acceptance flow for automatic reactivation** — RS-GOV-012
  states no such flow exists anywhere in the codebase.
- **`positions.title` (per-college L1/L3/L4 label) has no frontend
  surface** — RS-IDN-012 states this is backend-only, "deliberately
  deferred until a real screen needs it" — not to be confused with the
  unrelated `users.designation` field a real Profile page does render.
- The "exactly 4 logins" / "Class Tutor is a badge, not a separate
  account" framing is a correct derived summary of RS-IDN-005/
  RS-IDN-014, but does not appear verbatim anywhere in `docs/bka`.
