# Phase 4 Frontend Contract vs. Backend — Capability Mapping

Source docs: `source/` (Phase 1-4 vision/architecture docs + Cross-Phase Audit
Resolutions). Verified 2026-07-28 against `aiToolRegistry.js`, `workflowService`,
`notificationService`, `studentService`/`attendanceService`, `identityService`,
`aiProviders/`, `docs/bka`.

## 1. Component → backend mapping

| Frontend piece | Backend capability | Status |
|---|---|---|
| ResolutionStage pipeline | aiProviders adapter → aiToolRegistry (~60 tools) | Exists, no canonical envelope (see §3) |
| InformationBlock (L1) | any `level:'L1'` tool, e.g. `mark_attendance_nl` | Exists |
| ArtifactViewer (L2) | L2 tools (draft_notification, upload_institutional_document, etc.) | Exists |
| ProposalCard → L3ConfirmDialog → WaitingTray | L3 tools + `withWorkflowRequestId()` + `AiToolL3BypassError` | Exists |
| Multi-step chain indicator | `workflow_requests.approver_chain`, `resolveApproverChain` | Exists |
| Delegated approver line | `workflow_delegations` table + routes | Exists |
| WaitingTray "Approvals" feed | `workflow_pending_summary` tool → `listPendingForApprover` | Exists as AI tool; no dedicated REST route confirmed |
| WaitingTray "Flags" feed | student flag routes + `assertCanModifyStudent`; absence-flag close (ownership check, not WorkflowService) | Exists |
| Notifications (ambient+waiting) | `notifications`/`notification_delivery` ledger | Ledger exists; ambient/waiting split does not |
| /me/* notes | personal_note repo/service/routes | Exists |
| /me/* timeline | `activityTimelineService.getOwnActivity` | Exists |
| /me/* preferences | user_preference repo/service/routes | Exists |
| EntityRegistry | — | No server equivalent; frontend-only is fine |
| Context Indicator / multi-position union tray | `resolveCapabilities`/`resolveCapabilitiesForPosition`, ADR-022 | Union happens implicitly, not an explicit contract |
| QuickOpenOverlay | — | Missing (matches Phase 4 Roadmap D) |

## 2. Missing backend capability

1. Ambient vs waiting notification split — no field/rule exists yet.
2. Global QuickOpen search endpoint — genuinely absent.
3. No documented guarantee for "union of pending items across positions" — works today as a side effect, not a pinned contract.

## 3. API adjustment needed

No canonical `{entityType, id, tier, data}` response envelope on AI tool results.
Two options: normalize in `aiToolRegistry.js` (backend change) or map per-tool in
`features/ai` on the frontend (no backend change). Decide before Roadmap Phase C.

## 4. Unused backend capability

- `workflow_pending_summary` only reachable as an AI tool, no confirmed plain REST route.
- `workflow_delegations` CRUD exists, unconsumed by any current frontend code (expected — new territory).

## 5.5 Decided solutions

1. Notification split — add one field on notifications marking each as
   `ambient` or `waiting`. Small backend change.
2. QuickOpen search — build a new backend search endpoint covering
   students/staff/classes/etc. Required new backend work.
3. Response envelope — handled on the frontend (`features/ai` maps each
   tool result to its entity type for display). No backend change.

## 5. Can frontend proceed without backend changes?

Mostly yes. Real exceptions: QuickOpen search (new endpoint, already scoped as
Roadmap D) and the ambient/waiting notification split. The response-envelope
question is a decision, not a gap — resolve before building L1/L2/L3 renderers.
Everything else (Roadmap A, B, most of C/D) can proceed against the backend as-is.
