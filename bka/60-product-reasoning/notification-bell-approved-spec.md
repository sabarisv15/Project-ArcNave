# Approved Spec — Notification bell (sidebar)

Written 2026-09-03, P4 5.4. See page contract:
[`notification-bell.md`](notification-bell.md). Owner decisions this pass
(both via `AskUserQuestion`, logged as
[ADL-082](../30-decisions/ledger.md#adl-082)):

1. Scope narrowed to notifications only — background-job-progress SSE
   stays backend capability, unwired, since nothing in the frontend
   creates a background job today (no consumer to attach progress UI to).
2. Placement: a bell icon in the sidebar's fixed top region, opening a
   popover — not a dedicated nav page.

---

## Page

Notification bell (sidebar affordance, not a routed page).

## Purpose

A live view of the college's outbound-notification ledger
(`notifications` table — email announcements drafted by
principal/HOD, approved, dispatched) for the two roles that manage it,
replacing what would otherwise be manual polling with the existing
`GET /notifications/stream` SSE route (P4 5.4 backend half, already
shipped — commits `0fc6cda`/`899c738`).

## Role

`principal`, `hod` only (`notifications.read`). Renders nothing for any
other role — not hidden via CSS, not mounted at all.

## Navigation

None — persistent sidebar chrome, not a route.

## Tabs

None.

## Features

- **CORE — Live notification feed.** Initial `GET /notifications?limit=20`
  on first open (or on mount, cheap enough not to gate), then
  `GET /notifications/stream` deltas merged in live while the app is
  open. Newest first.
- **CORE — Unread-since-last-open badge.** A count on the trigger of
  notifications with `updated_at` newer than a session-local
  "last opened" timestamp (per user, `localStorage`, key
  `arcnave.notifications.lastSeen.<userId>`). Clears (timestamp
  advances to now) when the popover opens. This is a client-side
  affordance, not a claim about server-tracked read state — the schema
  has no `read_at`/per-recipient row (verified in
  `backend/migrations/1753100000000_module-8-notification-ledger.js`'s
  own file-level comment), so nothing here pretends otherwise.

## User flows

1. Signed-in principal/HOD sees the bell in the sidebar top row, with a
   badge if anything changed since they last opened it.
2. Click → popover opens, showing up to 20 recent notifications
   (subject or a body preview if no subject, status pill, relative
   time). Badge clears.
3. While the popover is open (or the app is open at all — the stream
   itself isn't gated on the popover being open), a `notification` SSE
   event received. If it is the app's own dispatch of a new draft,
   or a status change, it's an idempotent upsert-by-id: existing rows
   update in place, unfamiliar ids are prepended, and the list is
   truncated back to 20.
4. Popover closes on outside click, Escape, or the close button
   (Radix-native).

## Permissions

`useAuth().can('notifications.read')` gates whether `NotificationBell`
renders at all in `Sidebar.jsx` — same pattern every other
permission-gated UI element in this app already uses. No destructive
action exists in this feature (read-only), so CLAUDE.md rule 3
(`WorkflowService` as sole approval gate) is not implicated.

## API contracts

- `GET /api/v1/notifications?limit=20` — existing route
  (`backend/src/routes/notifications.js`), `requirePermission
  ('notifications.read')`. Returns an array of `notifications` rows
  (`id`, `channel`, `to_address`, `subject`, `body`, `status`, `origin`,
  `drafted_by_user_id`, `workflow_request_id`, `created_at`,
  `updated_at`).
- `GET /api/v1/notifications/stream` — existing SSE route, same
  permission. Emits `event: notification` (a changed/new row, same
  shape as the list endpoint) and `event: stream_end` (client should
  reconnect — browser `EventSource` would do this natively, but this
  route requires a Bearer `Authorization` header for tenant/RBAC
  resolution, which `EventSource` cannot set, so the client is a
  `fetch`-based reader, not `EventSource` — same convention
  `frontend/src/api/ai.js`'s `streamRequest` already established for
  POST streaming; this is the first GET-based use of that shape).

No new/changed backend routes, services, or migrations in this slice.

## Data dependencies

`notifications` table, existing, unchanged.

## States

- **Loading:** initial list fetch — trigger renders without a badge
  until the first response; no visible spinner (fast, low-stakes read).
- **Empty:** "No notifications yet" row inside the popover, plain text,
  no illustration (matches `SourcesPopover`'s own restraint — small
  surfaces don't get empty-state art).
- **Error:** initial list fetch failing shows a quiet inline retry
  affordance in the popover (no toast — a background feed failing isn't
  an action the user took). A stream error/disconnect is silent and
  reconnects automatically (the existing route's own `stream_end` +
  reconnect convention); no error surfaced to the user for a transient
  stream drop.
- **Success:** list renders, badge reflects unseen count.

## Validation

None — read-only feature, no user input.

## Edge cases

- Stream hits its 10-minute safety-net cap server-side (`MAX_STREAM_MS`
  in the existing route) → client reconnects on `stream_end`.
- Tab backgrounded/foregrounded: stream is a plain `fetch` reader tied
  to the component's mount lifecycle, not paused/resumed on visibility
  — acceptable for a low-frequency feed (same posture the existing
  routes' own 500ms–1s poll ticks already assume, no new complexity
  added here).
- Popover open with zero notifications ever drafted: empty state, not
  an error.
- Long `subject`/`body`: truncated with `truncate` + `title` tooltip,
  same convention `SourceRow` in `SourcesPopover.jsx` already uses.
- Role loses `notifications.read` mid-session (e.g. role reassignment)
  is not specifically handled — same as every other permission-gated UI
  element in this app; a stale client re-syncs on next full reload,
  consistent with existing behavior elsewhere, not a new gap introduced
  here.

## Testing requirements

- Renders nothing for a role without `notifications.read`.
- Renders the trigger for `principal`/`hod`.
- Initial list renders fetched notifications.
- A `notification` SSE event upserts into the list (new id prepended;
  existing id's fields update in place).
- Badge count reflects items newer than last-seen; opening the popover
  clears it.
- Empty state renders when the list is empty.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| Background-job progress UI | EXISTING CAPABILITY / RELATED / UNWIRED | `GET /background-jobs/:id/stream` already exists and works, but no frontend feature creates a background job today — nothing to attach progress UI to yet. Owner explicitly deferred this (see decision log above). |
| Draft/compose-notification UI (a human manually drafting an announcement) | EXISTING CAPABILITY / RELATED / UNWIRED | `POST /notifications` and `/notifications/:id/submit` already work and are used by AI tools (`draft_notification`/`request_notification_send`); no UI form exists to draft one by hand. Not requested. |
| Settings dialog's Notifications preferences tab | FUTURE | Explicitly named "not designed at all yet" in `FRONTEND-REDESIGN-HANDOFF.md` §2. |
| Mark-as-read / server-tracked per-user read state | FUTURE | No schema support today (`notifications` has no `read_at` or per-recipient row); would need its own migration and its own product decision (per-college broadcast vs. per-user tracking) — not assumed here. |
| Dedicated full-page notification history/search view | RELATED / FUTURE | The bell popover only ever shows the most recent 20; a searchable full history is a natural adjacent feature but was not requested and has no design. |
