# Canonical Rule Specification

**Status:** Normative — this layer is authoritative.

---

This layer holds the complete, deduplicated rule set. Each rule is stated once,
in one domain, and cross-referenced from everywhere else. The rule text is
written to be **timeless**: it states what is true, not what changed or when.
Change history, superseded positions and conflict resolutions live exclusively
in the [Decision Ledger](../30-decisions/ledger.md).

## Domains

| Domain | Rules | Subject |
|---|---|---|
| [RS-GOV](RS-GOV-governance.md) | 14 | Platform Admin authority, onboarding, structural authorization keys, organization lifecycle, institution settings |
| [RS-TEN](RS-TEN-tenancy-security.md) | 8 | Row-Level Security, platform isolation, layering invariants, authentication and MFA |
| [RS-IDN](RS-IDN-identity.md) | 14 | Position Accounts, occupancy, capability resolution, identity contexts, session revocation, display labels |
| [RS-STF](RS-STF-staff.md) | 13 | Staff registration, lifecycle, deactivation, position reassignment, teaching journal, self-service profile |
| [RS-CLS](RS-CLS-classroom.md) | 13 | Class slots, L4 authority, per-hour ownership, substitutes, substitute duty visibility and acknowledgement, ownership-based AI access |
| [RS-ACA](RS-ACA-academic.md) | 11 | Academic Year, curriculum versioning, timetable approval and locking |
| [RS-ATT](RS-ATT-attendance.md) | 9 | Attendance marking, windows, corrections, absence monitoring |
| [RS-STU](RS-STU-students.md) | 13 | Student identity, Aadhaar exclusion, transfer, lifecycle, progression, documents, manual flag |
| [RS-FIN](RS-FIN-finance.md) | 6 | Fee status flag, entry vs. correction, scholarship eligibility |
| [RS-ASM](RS-ASM-assessment-documents.md) | 10 | Marks entry vs. correction, examination section, document and report generation |
| [RS-WFL](RS-WFL-workflow.md) | 8 | The single approval engine, configurable chains, mandatory floors, delegation |
| [RS-NTF](RS-NTF-notifications.md) | 8 | Notification ledger, approval gate, system-notification carve-out, Send Alert |
| [RS-AIG](RS-AIG-ai-governance.md) | 16 | Authority levels, injection protection, data classification, carve-outs, tool registry discipline |
| [RS-DAT](RS-DAT-data-integrity.md) | 9 | Correction-not-immutability, retention, archival, audit log, backup |
| [RS-ANL](RS-ANL-analytics-governance.md) | 4 | Analytics access boundary, AI read-only scope, inherited data-quality limitations, no predictive capability — **added 2026-07-25** to close a real gap: `AnalyticsService` shipped with no governing rule anywhere |
| [RS-ADM](RS-ADM-admission-wizard.md) | 4 | Admission draft ownership, AI extraction scope, completion into a real student, draft document storage — **added 2026-07-25** to close a real gap: the full admission wizard feature shipped with no governing rule anywhere |
| [RS-PRF](RS-PRF-personal-workspace.md) | 3 | Personal notes, self-only activity timeline, generic user preferences — **added 2026-07-26** to close a real gap: none of the three had any governing rule when they shipped |

**Total: 163 rules.**

## Structural rule patterns

Four patterns recur across domains. Recognising them removes most of the
apparent complexity of the rule set.

### P1 — Entry versus correction

A first-time write of a value is a **direct write** by its owner. Any later
write to a value that already exists is a **correction**, requiring approval
one level above the owner. The original value is retained; the approved
correction becomes the new *effective* value, and dependent calculations
recompute from it.

| Datum | First entry (direct) | Correction approver | Rule |
|---|---|---|---|
| Attendance | Assigned/substitute faculty | L4 | [RS-ATT-004](RS-ATT-attendance.md#rs-att-004) |
| Marks | Assigned Subject Faculty | L4 | [RS-ASM-003](RS-ASM-assessment-documents.md#rs-asm-003) |
| Fee status | Class's L4 | L3 | [RS-FIN-003](RS-FIN-finance.md#rs-fin-003) |

Canonical statement of the pattern: [RS-DAT-002](RS-DAT-data-integrity.md#rs-dat-002).

### P2 — Mandatory approval floor

An institution configures its own approval chain per module, but certain
modules hard-code a minimum approval level no configuration may remove. The
institution configures the *path* to and beyond the floor, never whether the
floor is skipped.

| Subject | Floor | Rule |
|---|---|---|
| Timetable approval | L1 (final approver) | [RS-ACA-004](RS-ACA-academic.md#rs-aca-004) |
| High-severity student status transitions | L3 | [RS-STU-007](RS-STU-students.md#rs-stu-007) |

Canonical statement of the pattern: [RS-WFL-003](RS-WFL-workflow.md#rs-wfl-003).

### P3 — Ownership, not title

Write authority derives from ownership of the specific datum, never from
holding an L1–L4 title. Approving a correction is a distinct faculty from
owning the entry. Canonical statement: [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009).

### P4 — Same-actor direct-action carve-out

An AI tool may skip the workflow gate only when it acts as the same actor,
within the same scope, performing an action already direct for that actor on
the dashboard, and never a delete. Canonical statement:
[RS-AIG-007](RS-AIG-ai-governance.md#rs-aig-007).
