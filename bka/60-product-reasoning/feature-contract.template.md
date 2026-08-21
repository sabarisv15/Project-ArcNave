# Feature Contract — Template

One instance per `CORE` / `REQUIRED SUPPORT` feature. See
[`00-workflow.md`](00-workflow.md) §6–13. Related/adjacent and future items
do **not** get a full feature contract — they get one line in the Feature
Matrix and one line in the parent Approved Spec's OUT OF SCOPE section.

---

## Feature

- **Name:**
- **Scope classification:** CORE / REQUIRED SUPPORT (only these two get a full contract)

## User flow

- **User goal:**
- **Entry point:**
- **Actions:**
- **Result:**
- **Next possible action:**
- **Failure path:**
- **Completion state:**

## Permissions

- **Roles:**
- **Ownership:**
- **Access scope:**
- **Destructive-action gate:** (CLAUDE.md rule 3 — `WorkflowService` sole approval gate — if this feature deletes/overwrites anything)
- **Frontend/backend consistency:**

## Backend / API

- **Existing endpoint(s):**
- **Missing endpoint(s) — required for this feature:**
- **Existing-but-unrelated capability found nearby:** tag `EXISTING CAPABILITY / RELATED / UNWIRED`, record only, do not wire

## Database

- **Existing schema support:**
- **Required changes (report only, do not apply):**

## Edge cases

- Duplicate names / empty state / missing data / invalid input / unauthorized access / concurrent changes / deletion dependencies / large datasets / network-API failure — list only the ones that actually apply.

## 15-point completeness checklist

Classification values: `Existing`, `Required`, `Missing but not required`,
`Future`, `Needs product decision`, `Related-Future`, `Existing
capability-Related-Unwired`. `Needs product decision` is binary, not a
spectrum — no "(non-blocking)" qualifier. If an item doesn't block correct
implementation of what was requested, it isn't `Needs product decision`;
reclassify it as `Future` / `Related-Future` / `Existing
capability-Related-Unwired` instead (see workflow §13, item 13's
mobile-responsiveness sub-rule for the canonical example).

| # | Item | Classification | Notes |
|---|---|---|---|
| 1 | User Goal | | |
| 2 | User Flow | | |
| 3 | UI Components | | |
| 4 | Backend APIs | | |
| 5 | Database Changes | | |
| 6 | Permissions | | |
| 7 | Validation | | |
| 8 | Error Handling | | |
| 9 | Loading States | | |
| 10 | Empty States | | |
| 11 | Edge Cases | | |
| 12 | Future Extensibility | | |
| 13 | Mobile Responsiveness | | |
| 14 | Accessibility | | |
| 15 | Testing Checklist | | |
