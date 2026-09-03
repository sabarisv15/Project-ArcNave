# Page Contract — Notification bell (sidebar)

## Page

- **Name:** Notification bell
- **Route(s):** none — a persistent sidebar affordance, not a routed page
- **Role(s) that see it:** `principal`, `hod` (`notifications.read` — `frontend/src/lib/permissions.js`)
- **Scope mode:** Full Page (no prior page-contract for this)
- **Multi-screen split:** n/a, single screen/affordance

## Visual Design Source (source A)

- **What was supplied:** none. No mockup exists for this — `FRONTEND-
  REDESIGN-HANDOFF.md` explicitly lists the Settings/Notifications tab as
  "not designed at all yet," and the pre-redesign `TopBar.jsx` (which once
  carried a notifications affordance per the handoff doc's own §1 note)
  was removed entirely during the redesign; no notifications UI exists in
  current code.
- **Enumerated contents:** n/a — none supplied.
- **Diff vs. live implementation:** live implementation has zero
  notification UI (confirmed by grep — no frontend file references
  `/notifications`). This page contract derives placement from the
  owner's own answer (sidebar bell, popover) rather than a design source.

## Navigation

- **Entry point(s):** `Sidebar.jsx`'s fixed top region, beside
  `SidebarUtilityCluster` — always visible when the sidebar is visible and
  the signed-in role can read notifications.
- **Links out to:** nothing (no full-page notifications view exists;
  see Approved Spec OUT OF SCOPE).
- **Navigation consistency:** no existing ARCNAVE pattern for a persistent
  header-level affordance, since the redesign deliberately removed the
  top header bar. Closest precedent: `SourcesTrigger` in
  `features/chat/components/SourcesPopover.jsx` (icon/text trigger +
  Radix Popover list, same token classes) — followed here for visual
  consistency instead of inventing a new interaction shape.
- **Cross-page dependencies:** none.

## Layout

- **Sections / tabs:** none — a single popover.
- **Menus:** the popover itself (Radix `Popover`).
- **Buttons (visible actions):** bell trigger (with unread-since-last-open
  badge); no in-popover actions (read-only view — see Approved Spec).
- **Dialogs:** none.
- **Tables / cards / lists:** one list of recent notifications
  (subject/body preview, status, relative time), newest first, capped at
  20.

## UX consistency notes

- Reuses `components/ui/IconButton.jsx` for the trigger and the same
  Radix `Popover` + token-class conventions `SourcesPopover.jsx` already
  established (`bg-raised`, `border-line-strong`, `shadow-pop`,
  `rounded-[15px]`) rather than inventing new popover chrome.
- Reuses `hooks/useRelativeTime.js` for timestamps (same "1 hr ago"
  convention already used in chat).
- No existing badge/pill component matches a numeric unread count exactly
  ([`DESIGN-SYSTEM.md`](../50-frontend/DESIGN-SYSTEM.md) lists 4
  feature-specific badge components, none generic) — a small inline count
  chip is built locally for this trigger, following `info`/`accent` token
  usage, not a new shared primitive (too small a surface to justify one).
