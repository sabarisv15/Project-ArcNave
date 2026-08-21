# Glossary

**Status:** Informative. Definitions are normative only where a rule is cited.

---

## Actors and identity

**Platform Admin** — an ARCNAVE employee, holding no seat in any institution's
hierarchy and no row in any tenant's user table. The one and only platform-side
role. [RS-GOV-001](../10-specification/RS-GOV-governance.md#rs-gov-001)

**L1 / L2 / L3 / L4** — the fixed institutional authority levels. Default
display labels are L1 = Principal, L3 = HOD, L4 = Class Tutor; L2 has none.
[RS-IDN-012](../10-specification/RS-IDN-identity.md#rs-idn-012)

**Position** — an organizational seat: institution, structural level,
assignment type, title. Created once, never deleted.
[RS-IDN-001](../10-specification/RS-IDN-identity.md#rs-idn-001)

**Position Account** — the permanent, position-centric identity owning the
official mailbox, credential, MFA state, session-version counter and audit
identity. Exactly one per Position.
[RS-IDN-001](../10-specification/RS-IDN-identity.md#rs-idn-001)

**Occupant** — an append-only, time-boxed link between a Position Account and
the person currently holding it. Carries no credentials of its own.

**Personal Identity Context** — capabilities resolved as the **union** of every
position a person holds. For the individual's own workspace.
[RS-IDN-005](../10-specification/RS-IDN-identity.md#rs-idn-005)

**Institutional Identity Context** — capabilities resolved **exclusively** for
one Position Account, never merged with anything else its occupant holds. For
acting on behalf of a specific office.

**Effective Role** — a derived label computed per request from live position
data, never a stored value and never read from a token.
[RS-IDN-007](../10-specification/RS-IDN-identity.md#rs-idn-007)

**Capability** — a resolved fact about what a person is currently entitled to,
computed at read time from current occupancy and assignment state.

**Staff** — a person holding no Position. Person-centric; no Position Account.
A staff member's job-title field stays `staff` regardless of any assignment.

## Structure

**Class slot** — a class, keyed by (department, semester number). Permanent for
the life of the course; occupants rotate annually.
[RS-CLS-002](../10-specification/RS-CLS-classroom.md#rs-cls-002)

**Section** — a subdivision of a year within a department. Exists in practice
only once L3 assigns an L4 to it.

**Academic Year** — the container every dated domain record belongs to. Exactly
one Active per institution.
[RS-ACA-002](../10-specification/RS-ACA-academic.md#rs-aca-002)

**Regulation** — a curriculum version, owning its own subject list, credits,
contact hours and examination scheme. Fixed at admission for a student;
historical versions never change.
[RS-ACA-009](../10-specification/RS-ACA-academic.md#rs-aca-009)

**Tenant** — one college. Isolated by Row-Level Security keyed on a
human-readable college code, never the internal identifier.

## Identity keys

**Permanent Student ID** — a student's identity for life, across every transfer
and enrolment.
[RS-STU-005](../10-specification/RS-STU-students.md#rs-stu-005)

**Permanent Internal Staff ID** — a staff member's identity for their whole
institutional lifecycle. Distinct from the institution-issued Staff ID or
Employee Code, which may change on reappointment.
[RS-STF-004](../10-specification/RS-STF-staff.md#rs-stf-004)

**Business identity** — Register Number, EMIS Number or Admission Number. Used
for dedup and import matching. **Never Aadhaar.**
[RS-STU-004](../10-specification/RS-STU-students.md#rs-stu-004)

## Authority and process

**Ownership** — actual accountability for a specific datum, from which write
authority derives. Never conferred by holding a title.
[RS-CLS-009](../10-specification/RS-CLS-classroom.md#rs-cls-009)

**Entry** — the first write of a value. A direct write by its owner.

**Correction** — any later write to a value that already exists. Requires
approval one level above the owner; the original value is preserved.
[RS-DAT-002](../10-specification/RS-DAT-data-integrity.md#rs-dat-002)

**Effective value** — the current authoritative value after any approved
correction. All dependent calculations recompute from it.

**Mandatory approval floor** — a minimum approval level hard-coded per module
that no institution configuration may remove. The institution configures the
path to and beyond it, never whether it is skipped.
[RS-WFL-003](../10-specification/RS-WFL-workflow.md#rs-wfl-003)

**Discretionary escalation** — an approver's own choice to route a specific
case further up the chain. Never a system-enforced severity classification.

**Configured chain** — an institution's own per-module approval route.
[RS-WFL-002](../10-specification/RS-WFL-workflow.md#rs-wfl-002)

**Structural authorization key** — a single-use, L1-generated, 7-day credential
authorizing Platform Admin to make exactly one named structural change.
[RS-GOV-006](../10-specification/RS-GOV-governance.md#rs-gov-006)

**Readiness gate** — the one-time check that every onboarding-created
department has at least one enrolled student, gating `ready → active`.
[RS-GOV-011](../10-specification/RS-GOV-governance.md#rs-gov-011)

**Same-actor direct-action carve-out** — the three-condition test permitting an
AI tool to skip the workflow gate.
[RS-AIG-007](../10-specification/RS-AIG-ai-governance.md#rs-aig-007)

**Lock** (attendance) — the event after which an attendance edit becomes a
correction. Marks have no equivalent: they use first-write-versus-any-write.

## AI

**Authority level (L1 / L2 / L3)** — Inform, Generate, Act. Note that these are
**AI authority levels and are unrelated to the L1–L4 institutional
hierarchy**; the collision is historical.
[RS-AIG-001](../10-specification/RS-AIG-ai-governance.md#rs-aig-001)

**Policy Gate** — the registry's own invocation path, applying the independent
level, tenant, role, classification and scope checks.

**Data classification** — Internal, Confidential or Restricted. Checked
independently of whether a role may invoke a tool at all.
[RS-AIG-006](../10-specification/RS-AIG-ai-governance.md#rs-aig-006)

**Context Builder** — the stage wrapping every tool result as untrusted data.

**Prompt Safety Layer** — the stage applying an explicit untrusted-data
boundary and safety preamble, with escaping so a hostile value cannot forge a
boundary.
[RS-AIG-003](../10-specification/RS-AIG-ai-governance.md#rs-aig-003)

**AI Experience Layer** — a pure post-processing stage producing presentation
output from an already-final, already-authorized response. Calls nothing,
influences nothing.

**RAG** — retrieval-augmented generation over embedded document chunks.
Retrieved content is untrusted data, never instructions.

## Data integrity

**Archival** — a record-keeping treatment applied *on top of* a lifecycle,
never a state within one. Read-only unless restoration is authorized.
[RS-DAT-003](../10-specification/RS-DAT-data-integrity.md#rs-dat-003)

**Soft delete** — a flag or timestamp. The only form of deletion available, and
the only one AI may ever cause.

**Append-only ledger** — a table on which the application role holds no update
or delete grant. *A ledger the application can rewrite is not a ledger.*

**Compound audit identity** — Actor, Acting Position Account and Position
recorded as three separate fields, never collapsed.
[RS-IDN-011](../10-specification/RS-IDN-identity.md#rs-idn-011)

## Specification terms

**Rule** — a single normative statement with a permanent identifier, stated in
exactly one place.

**Canonical rule** — for a structural pattern, the rule stating the pattern
itself. Its instances reference it and never restate it.

**Conformance state** — `Conformant`, `Divergent`, `Not built` or `Undecided`.
A property of the implementation or the decision, never of the rule.
[Conventions §6](../00-foundation/scope-and-conventions.md#6-conformance-states)

**Decision Ledger entry (`ADL-*`)** — a record of a resolved conflict or open
decision, with rationale, affected artefacts, migration impact and
implementation notes.

**Architecture Decision Record (`ADR-*`)** — a technical decision with a status
and, where relevant, a revisit trigger.

## Retired terminology

These terms appear in prior source material and are **not valid** in this
specification.

| Retired term | Replacement |
|---|---|
| Super Admin | Platform Admin |
| `college_admin` | No successor — the role was retired; ownership moved to L1 |
| Class Tutor as a concept distinct from L4 | L4; "Class Tutor" is a display label |
| `Closed` (Academic Year status) | `Completed` |
| `Archived` (Academic Year or student status) | No successor — archival is orthogonal to lifecycle |
| Fee structure | No successor — the concept is removed entirely |
| `classes.tutor_user_id` | A Level 4 Position with a class-tutor assignment type |
