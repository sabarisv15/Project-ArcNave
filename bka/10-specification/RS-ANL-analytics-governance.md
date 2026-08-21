# RS-ANL — Analytics Governance

**Domain:** Access and authority over derived/aggregated analytics data
(rates, percentages, summaries computed from underlying records) — the
governance layer, not the analytics calculations themselves. Added
2026-07-25 to close a real specification gap: `AnalyticsService` (Module 10)
shipped with no governing rule anywhere in this specification.
**Owning service:** `AnalyticsService`.

> **Scope note.** This domain does not redesign or specify what Analytics
> calculates — that is existing, already-decided product behavior owned by
> `AnalyticsService` and its repository. This domain governs **who may see
> a given analytics number and what AI may do with it**, the same way
> [RS-AIG](RS-AIG-ai-governance.md) governs AI without redesigning the
> domains it touches.

---

## RS-ANL-001

**Analytics data carries no separate access model — it inherits the
ownership boundary of the underlying data it summarizes.**

A tutor sees analytics for their own class; an HOD sees their own
department; a Principal sees the whole college. Being aggregated into a
percentage does not loosen this — a summary of data you couldn't see
individually is not made visible by being averaged.

*Instance of structural pattern P3 (ownership-based authority) — see
[RS-CLS-009](RS-CLS-classroom.md#rs-cls-009).*

| | |
|---|---|
| **Business Owner** | Analytics Access |
| **Supporting Components** | `AnalyticsService`, `visibilityService` |
| **Authority** | Ownership-derived, same as the underlying data |
| **Depends on** | [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009) |
| **Governs** | [RS-ANL-002](#rs-anl-002) |
| **Lifecycle** | — |
| **Workflow** | None — direct read |
| **AI** | L1 read, scoped identically to a human actor's own visibility |
| **Modules** | 10 |
| **Data effect** | — |
| **Implementation** | `analyticsService.getAttendanceRateForActor` calls `visibilityService.getVisibleClassIds` — the ownership scoping this rule requires. **Corrected 2026-07-26** (Class Tutor IA discovery): the human-facing route (`GET /analytics/attendance-rate`) had never actually called this function for a tutor — it was gated to Principal/HOD only at the route layer, so a tutor's "own class" access this rule always described was real for the AI path but not the dashboard, a real conformance gap against this rule's own text, not a documentation lag. Fixed: the route now calls `getAttendanceRateForActor` for a resolved `staff` role; Principal/HOD's existing behavior is unchanged. |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ANL-002

**AI may read and summarize analytics data but never acts on a number by
itself — any resulting action (an alert, a status change) must go through
its own already-governed rule, never a shortcut invented because the
number looked concerning.**

Example: AI may say "this class is at 62% attendance this month." AI may
**not** independently decide to notify the HOD because of that number —
if that notification should happen, it happens through the actual absence
or alert rule that already governs it
([RS-ATT-008](RS-ATT-attendance.md#rs-att-008)), not a new path invented at
the analytics layer.

| | |
|---|---|
| **Business Owner** | Analytics Access |
| **Supporting Components** | `AnalyticsService`, AI Tool Registry |
| **Authority** | System invariant |
| **Depends on** | [RS-ANL-001](#rs-anl-001), [RS-AIG-001](RS-AIG-ai-governance.md#rs-aig-001) |
| **Governs** | — |
| **Lifecycle** | — |
| **Workflow** | None — read-only, no action capability exists at this layer |
| **AI** | L1 read only. No L2/L3 analytics tool exists or is anticipated — an analytics number is never itself a trigger |
| **Modules** | 9, 10 |
| **Data effect** | — |
| **Implementation** | **Built 2026-07-26** — two registry tools are genuinely `AnalyticsService`-backed (`attendance_summary`/`students_low_attendance`, both calling `analyticsService.getAttendanceRateForActor`), tagged `analyticsSourced: true`. `aiToolRegistry.registerTool` asserts any `analyticsSourced` tool must be level L1 — a checked runtime invariant, not a fact merely true by observation; a future L2/L3 analytics tool fails loudly at module load (`AiToolAnalyticsLevelViolationError`), never ships silently |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ANL-003

**Analytics inherits every declared data-quality limitation of the data it
summarizes — a percentage is not more trustworthy than the records it was
computed from.**

Example: if "final year" is only a soft text match
([RS-ATT-009](RS-ATT-attendance.md#rs-att-009)), any analytics filtered by
"final year" inherits that same imprecision — it does not become a
guaranteed structured result just because it now renders as a chart.

| | |
|---|---|
| **Business Owner** | Analytics Access |
| **Supporting Components** | `AnalyticsService` |
| **Authority** | System invariant |
| **Depends on** | [RS-DAT-009](RS-DAT-data-integrity.md#rs-dat-009) |
| **Governs** | — |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | Binding — AI MUST NOT present an analytics figure as more precise than the declared limitation of its source data |
| **Modules** | 10 |
| **Data effect** | — |
| **Implementation** | No independent accuracy claim exists in `analyticsService` beyond the source data's own guarantees |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-ANL-004

**Analytics is deterministic aggregation only — no predictive or
forecasting capability exists or is implied by this domain.**

This is the Analytics-specific restatement of the platform-wide rule that
ARCNAVE contains no trained predictive model
([RS-AIG-014](RS-AIG-ai-governance.md#rs-aig-014)). A rate or percentage is
arithmetic over already-recorded facts, never a prediction about the
future.

| | |
|---|---|
| **Business Owner** | Analytics Access |
| **Supporting Components** | `AnalyticsService` |
| **Authority** | Scope boundary |
| **Depends on** | [RS-AIG-014](RS-AIG-ai-governance.md#rs-aig-014) |
| **Governs** | — |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | Prohibited from forecasting; may only report computed-to-date figures |
| **Modules** | 9, 10 |
| **Data effect** | — |
| **Implementation** | `attendanceRatePercent` and equivalent fields are plain division/rounding over recorded rows, per `analyticsService.js`'s own header comment |
| **Conformance** | Conformant |
| **Decisions** | — |
