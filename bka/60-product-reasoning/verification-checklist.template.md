# Visual/Product Verification Checklist — Template

Run after `/build-slice` or `/wire-frontend` finish implementing an
Approved Spec. See [`00-workflow.md`](00-workflow.md) §17 (Step 14) — this
is the pipeline's closing step, not an optional extra.

Compares: **Visual Design ↔ Implemented UI ↔ Approved Spec ↔ Existing
Product Rules**, using the project's existing browser-preview verification
workflow for anything previewable.

---

## Page / feature

- **Approved Spec:**
- **Verified on:** (date)

## Checklist

| # | Check | Pass/Fail | Notes |
|---|---|---|---|
| 1 | Intended visual structure exists | | |
| 2 | Intended interactions exist | | |
| 3 | Approved scope is implemented | | |
| 4 | OUT OF SCOPE items were **not** implemented | | |
| 5 | No unrelated backend/DB changes were introduced | | |
| 6 | Permissions are respected | | |
| 7 | Responsive behavior follows existing patterns | | |
| 8 | Important states (loading/empty/error/success) are covered | | |

## Findings

Any `Fail` row above is a finding, not something to silently patch by
writing more code outside the Approved Spec. For each finding, state
whether the fix is: (a) correct the implementation to match the
already-approved spec, or (b) the spec itself needs to change — which
requires a new, separate Product Reasoning pass, not an in-place scope
expansion.
