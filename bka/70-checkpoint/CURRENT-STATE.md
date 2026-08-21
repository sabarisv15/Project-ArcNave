# Current State

_Last updated: 2026-08-21 — bka/ sync of round 22's P2/P3 fixes (root
`CHECKPOINT.md` round 23). Closes the gap round 22 (the P2/P3 code fix
pass itself) left open: `bka/` had no record of any of those 8 fixes._

Governed by [`00-protocol.md`](00-protocol.md). Read that file for the
rules; this file holds only the current task's state, per protocol §2 —
no rule text, spec content, or design content belongs here.

## Active Task

None. Sync complete: 4 new rules added — `RS-ATT-010` (attendance
re-mark version check, reusing `RS-GOV-009`'s existing optimistic-
concurrency pattern), `RS-ASM-013` (`marksObtained` non-negative +
bounded by `max_marks` when set), `RS-ASM-014` (DocumentService upload
compensating cleanup on immediate and deferred/rollback failure, sibling
to `RS-DAT-005`), `RS-AIG-024` (AI tool invocation audit trail
completeness — handler failures now audited, `provider`/`model`/
`workflowRequestId` now captured). 4 new Decision Ledger entries
(`ADL-041`–`044`). `python tools/validate.py` passes clean (0 errors, 0
warnings) with the new content included.

## Phase / Step

N/A — complete.

## Verification status

- Ground truth was the real current backend code (`attendanceService.js`,
  `attendanceRepository.js`, `assessmentService.js`, `documentService.js`,
  `db/tenantTransaction.js`, `aiToolRegistry.js`, `aiService.js`) and the
  actual migrations added by round 22, not round 22's own `CHECKPOINT.md`
  narrative taken at face value — cross-checked before citing any
  file:line.
- Real precedent reused rather than invented: `RS-ATT-010` explicitly
  reuses `RS-GOV-009`'s already-documented `version`-column pattern
  (checked that rule's own text first); `RS-ASM-014` is stated as a
  sibling to `RS-DAT-005`'s existing "storage-path rows and bytes on disk
  must agree" invariant, not a competing new one.
- `python tools/validate.py` re-run after the first full edit batch:
  caught one real asymmetric-edge warning (`RS-ATT-010`'s `Depends on`
  edge on `RS-ATT-001` had no mirrored `Governs` back) — fixed, re-run,
  **0 errors, 0 warnings, PASSED**.
- One genuine pre-existing documentation gap found while writing
  `RS-ASM-013` and deliberately **not** papered over: the assessment mark
  batch draft/lock/submit lifecycle (`assessmentSubmissionRepository`,
  `lockAssessmentSubmission`/`unlockAssessmentSubmission`/
  `submitAssessmentSubmission`, `updateMark`'s own draft-only direct-edit
  path) has **no dedicated `RS-ASM` rule at all** — grepped for "batch"/
  "draft"/"locked"/"submitted" across the whole file first to confirm
  this wasn't a citation miss before writing the honest gap note into
  `RS-ASM-013`'s own text instead of inventing a cross-reference to a
  rule that doesn't actually cover it.

## Decisions made

- **4 new rules, not amendments to existing ones** — each governs a
  genuinely new guarantee (a concurrency check, a value bound, a
  transactional cleanup, an audit-completeness requirement), not a
  restatement of something already covered elsewhere.
- **Deliberately no rule for `DB_POOL_MAX`, the 3 FK indexes, or the 2 new
  regression tests** — pure ops/performance/test-coverage concerns with
  no business-rule content and no `RS-*` domain they'd naturally belong
  to, consistent with `bka/index.md`'s own framing of the Specification
  layer (business rules, not implementation detail).
- **The `updateMark`/batch-lifecycle documentation gap is flagged, not
  closed** — writing a full `RS-ASM` rule for the entire draft/lock/
  submit mechanism is a materially larger task than this sync (a genuine
  new rule set, not a cross-reference fix) and wasn't requested; recorded
  as Pending below instead of taken on unilaterally.

## Files touched (not yet committed)

- `bka/10-specification/RS-ATT-attendance.md` — new `RS-ATT-010`;
  `Governs` updated on `RS-ATT-001`.
- `bka/10-specification/RS-ASM-assessment-documents.md` — new
  `RS-ASM-013`, `RS-ASM-014`; `Governs` updated on `RS-ASM-002`,
  `RS-ASM-012`, `RS-ASM-005`.
- `bka/10-specification/RS-AIG-ai-governance.md` — new `RS-AIG-024`;
  `Governs` updated on `RS-AIG-001`, `RS-AIG-022`.
- `bka/10-specification/RS-GOV-governance.md` — `Governs` updated on
  `RS-GOV-009` (mirrors `RS-ATT-010`'s `Depends on`).
- `bka/30-decisions/ledger.md` — 4 new entries, `ADL-041`–`044`.

None of the above are committed — this task did not decide to commit on
the user's behalf.

## Pending (not this task)

- **The assessment mark batch draft/lock/submit lifecycle has no
  dedicated `RS-ASM` rule** (see Verification status / Decisions made) —
  a real, separately-scoped documentation task, not something this sync
  was asked to close.
- Everything round 20's own `CURRENT-STATE.md` snapshot had listed as
  pending (the `academic_generate_timetable`/`RS-ACA-005` L1-vs-L2
  conformance finding, `CLAUDE.md` git-tracking status) — not
  re-verified as part of this task; check root `CHECKPOINT.md` rounds
  20–23 directly rather than trusting this note's own age.

## Exact next action

None pending for *this* task. If the user wants the assessment
batch-lifecycle documentation gap closed, or the round-20 pending items
above followed up, those are new, separately-scoped tasks.

## Authoritative sources already identified for this task

- `backend/src/services/attendanceService.js`,
  `backend/src/repositories/attendanceRepository.js`,
  `backend/src/services/assessmentService.js`,
  `backend/src/services/documentService.js`,
  `backend/src/db/tenantTransaction.js`,
  `backend/src/services/aiToolRegistry.js`,
  `backend/src/services/aiService.js` — the real implementation every
  new rule cites by file:line.
- `bka/10-specification/RS-GOV-governance.md#rs-gov-009`,
  `bka/10-specification/RS-DAT-data-integrity.md#rs-dat-005` — the
  existing patterns `RS-ATT-010`/`RS-ASM-014` reuse rather than
  reinvent.
- `bka/tools/validate.py` — re-run it (`python tools/validate.py` from
  `bka/`) rather than trusting this file's snapshot.
