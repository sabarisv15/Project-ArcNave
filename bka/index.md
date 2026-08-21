# ARCNAVE Business Knowledge Architecture

**Document class:** Enterprise Architecture Specification
**Edition:** 1.0
**Status:** Baselined
**Baseline date:** 2026-07-25

---

## 1. Purpose

This repository is the **single authoritative expression of ARCNAVE's business
knowledge**: the rules that govern the platform, the relationships between
those rules, the lifecycles they operate over, the AI authority they permit,
the historical-data guarantees they impose, and the implementation surface they
bind.

It is a **connected specification**, not a linear document. Every rule carries
explicit dependency, governance, lifecycle, ownership, workflow, AI, module and
implementation references. Any statement appears in exactly one place; every
other occurrence is a cross-reference to that place.

## 2. What this specification replaces

This architecture supersedes the previous documentation estate — an accreted
set of business-rule files, phase plans, session records and review notes in
which the same fact was stated in two to four places, at differing ages, with
no mechanism to keep them aligned.

The retirement mapping from every prior source document to its canonical
destination is recorded in [Traceability](90-appendix/traceability.md).

## 3. Structure

| Layer | Directory | Content | Normative? |
|---|---|---|---|
| Foundation | [`00-foundation/`](00-foundation/scope-and-conventions.md) | Conventions, actor model, domain model | Yes |
| Specification | [`10-specification/`](10-specification/index.md) | The canonical rule set, `RS-*` | **Yes — authoritative** |
| Matrices | [`20-matrices/`](20-matrices/dependency-graph.md) | Derived views over the rule set | Derived (non-normative) |
| Decisions | [`30-decisions/`](30-decisions/index.md) | Architecture Decision Ledger, ADR register | Historical record |
| Appendix | [`90-appendix/`](90-appendix/glossary.md) | Glossary, traceability | Informative |
| UAT | [`40-uat/`](40-uat/00-uat-master-test-plan.md) | User Acceptance Testing plan, task scripts, feedback template, seeder spec | Operational (post-baseline) |
| Product Reasoning | [`60-product-reasoning/`](60-product-reasoning/00-workflow.md) | Page/feature analysis workflow, contract templates, per-page worked reasoning, Approved Specs | Operational (pre-implementation) |
| Checkpoint | [`70-checkpoint/`](70-checkpoint/00-protocol.md) | Session state/checkpoint protocol and the single current-task state file | Operational (session continuity) — never restates content from other layers |

## 4. Reading order

| If you are… | Start at |
|---|---|
| New to ARCNAVE | [Actor Model](00-foundation/actor-model.md) → [Domain Model](00-foundation/domain-model.md) |
| Implementing a change | [Implementation Impact Matrix](20-matrices/implementation-impact-matrix.md) |
| Reviewing an AI capability | [AI Capability Matrix](20-matrices/ai-capability-matrix.md) → [`RS-AIG`](10-specification/RS-AIG-ai-governance.md) |
| Assessing regression risk | [Dependency Graph](20-matrices/dependency-graph.md) |
| Asking "why is it like this?" | [Decision Ledger](30-decisions/ledger.md) |
| Auditing record history | [Historical Data Integrity](20-matrices/historical-data-integrity.md) |

## 5. Precedence

Where two artefacts appear to disagree, the following order of precedence
applies without exception:

1. The **Specification layer** (`10-specification/`, `RS-*` rules).
2. The **Foundation layer** (`00-foundation/`).
3. The **Decision Ledger** (`30-decisions/ledger.md`) — binding for *rationale*
   and *migration obligation*, never for current-state rule text.
4. Everything else is derived or informative and is, by construction, wrong if
   it disagrees with the above.

Implementation code is **never** the arbiter of a rule. Where code diverges
from a rule, the divergence is recorded as a conformance defect in the
[Implementation Impact Matrix](20-matrices/implementation-impact-matrix.md) and
the code is corrected — not the rule.

## 6. Amendment procedure

See [Scope & Conventions §7](00-foundation/scope-and-conventions.md#7-amendment-procedure).
In summary: a rule change requires a Decision Ledger entry, an edit to exactly
one `RS-*` rule, regeneration of affected matrices, and a passing
`tools/validate.py` run. Adding a rule statement to a second location is a
specification defect.
