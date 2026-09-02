import { create } from 'zustand';

// ⚠ SCAFFOLDING — BUILT BUT NOT WIRED. WorkspaceProvider still owns all of
// this state in its own useState calls; nothing imports this file yet.
// Wiring it is the next session's job. Read the "what went wrong on the
// first attempt" note at the bottom before doing so — it is the whole
// reason this is unwired rather than shipped.
//
// (Same posture 1.13 and D3 already used in this modernization effort:
// build the mechanism standalone, wire it in its own verified pass.)
//
// P3 5.9 — the third slice, and the one where the split 5.9 asks for is
// clearest.
//
// WorkspaceProvider is 972 lines and holds two completely different kinds
// of state that had no reason to be together:
//
//   * SERVER state — chats, projects, artifacts, contextFiles, threads.
//     Already on React Query, and staying there. Nothing to migrate.
//
//   * VIEW state — which sidebar menu is open, which seat is being
//     previewed, the search box in Recents, the sort in Projects, whether
//     the schedule panel is open, ... Fourteen `useState` calls, every one
//     of them bundled into the single context value.
//
// That bundling is the actual cost. `useWorkspace()` hands back one object,
// so typing a character into the Recents search box re-renders all 27
// consumers of the context — including every drawer and table that has
// nothing to do with Recents. Context has no way to subscribe to part of a
// value; a store does.
//
// The migration is deliberately non-breaking: WorkspaceProvider still
// composes these fields into the same context value, so all 27 consumers
// keep working untouched. A component that only reads view state can now
// switch to `useWorkspaceUi((s) => s.recentQuery)` and stop re-rendering on
// unrelated changes — one component at a time, verifiable each time, rather
// than one sweeping rewrite of every consumer.
//
// Not moved here, on purpose:
//   * `chatFiles` — message/upload metadata keyed by conversation, closer
//     to server data than view state; it belongs with whatever owns
//     attachments, not in a UI store.
//   * anything React Query already owns.

const initialUi = {
  /**
   * Which sidebar menu is showing. Deliberately its own state, never
   * inferred from the pathname: switching context swaps the menu only, so
   * whatever workspace is open stays open until the user picks an item.
   */
  activeWorkspaceMode: 'home',
  /**
   * `pinned`  — docked; occupies real layout width and never overlaps content.
   * `overlay` — floating above the workspace, temporary.
   * `hidden`  — no width reserved; only the left edge trigger remains.
   */
  sidebarMode: 'pinned',
  /**
   * Which institutional seat the prototype is being viewed as.
   *
   * This is a **review affordance for a design prototype**, not an
   * authorization mechanism — it only decides which experience renders. In
   * the real product the active seat is resolved server-side from the
   * signed-in Position Account and a switcher like this does not exist.
   *
   * Explicit state, never derived from the pathname, for the same reason
   * activeWorkspaceMode isn't: a mode that re-derives itself on every
   * remount fights the user.
   */
  activeRole: 'teaching_staff',

  recentQuery: '',
  recentFilter: 'All conversations',
  projectQuery: '',
  projectSort: 'Last updated',
  artifactQuery: '',
  artifactFilter: 'All artifacts',

  scheduleOpen: false,
  profileDrawerOpen: false,
  instructions: '',

  // projectId -> conversationId, artifactId -> conversationId.
  projConv: {},
  artConv: {},
};

export const useWorkspaceUi = create((set) => ({
  ...initialUi,

  setActiveWorkspaceMode: (value) => set({ activeWorkspaceMode: value }),
  setSidebarMode: (value) => set({ sidebarMode: value }),
  setActiveRole: (value) => set({ activeRole: value }),
  setRecentQuery: (value) => set({ recentQuery: value }),
  setRecentFilter: (value) => set({ recentFilter: value }),
  setProjectQuery: (value) => set({ projectQuery: value }),
  setProjectSort: (value) => set({ projectSort: value }),
  setArtifactQuery: (value) => set({ artifactQuery: value }),
  setArtifactFilter: (value) => set({ artifactFilter: value }),
  setScheduleOpen: (value) => set({ scheduleOpen: value }),
  setProfileDrawerOpen: (value) => set({ profileDrawerOpen: value }),
  setInstructions: (value) => set({ instructions: value }),

  // Each accepts either a value or an updater, matching the useState
  // setters they replace — several call sites pass `(prev) => ...`.
  setProjConv: (next) => set((s) => ({ projConv: typeof next === 'function' ? next(s.projConv) : next })),
  setArtConv: (next) => set((s) => ({ artConv: typeof next === 'function' ? next(s.artConv) : next })),

  /**
   * Seeds artifact -> conversation links that came back from the server.
   *
   * Additive only, and that matters: `artConv` otherwise gains an entry
   * only when a revision message is sent live in THIS browser session, so
   * reopening an artifact that already had a conversation_id from a
   * previous session found nothing here and silently rendered no revision
   * chat at all. This never overwrites a fresher session-created mapping
   * for the same id.
   */
  seedArtifactConversations: (artifacts) =>
    set((s) => {
      let changed = false;
      const next = { ...s.artConv };
      for (const a of artifacts) {
        if (a.conversationId && next[a.id] === undefined) {
          next[a.id] = a.conversationId;
          changed = true;
        }
      }
      return changed ? { artConv: next } : {};
    }),

  resetWorkspaceUi: () => set({ ...initialUi }),
}));

// ---------------------------------------------------------------------
// What went wrong on the first wiring attempt — read before retrying
// ---------------------------------------------------------------------
//
// Wiring this into WorkspaceProvider (replacing the fourteen useState
// calls, keeping the context value's shape identical) compiled, linted at
// 0 errors, and took the frontend suite from 552/552 to **446/552 —
// 106 failures**. The migration was reverted rather than patched.
//
// The cause is not a bug in this store. It is that a Zustand store is
// MODULE-GLOBAL while `useState` inside a provider is per-mount. Every
// full-app test renders the app fresh, and many of them switch
// `activeRole` to preview a different seat (the `usePrincipalView` /
// `useView` helpers click through the profile drawer to do exactly that).
// With provider-owned state each test started at `teaching_staff`; with a
// module-global store, whatever the previous test switched to leaks into
// the next one, so tests fail depending on what ran before them.
//
// This is the SAME hazard the attendance slice hit, and it is worth
// noticing that the two need different answers:
//   * attendance — the provider was mounted per-route, so resetting on
//     section entry (useAttendanceLifecycle) was both the faithful
//     behaviour AND the isolation fix, in one move.
//   * workspace — the provider is app-lifetime. Resetting on mount would
//     be faithful (a fresh app start does begin at these defaults) but
//     needs care: WorkspaceProvider mounts once per app render, so a reset
//     there is fine for tests and a no-op in production.
//
// So the likely fix is a mount-time reset in WorkspaceProvider using the
// same lazy-useState-initializer trick useAttendanceLifecycle uses (during
// first render, not in an effect, or the first paint shows the previous
// state). Whatever is chosen, re-run the FULL frontend suite — this
// failure mode is invisible to a single test file, which is precisely why
// it was not caught until the whole suite ran.
//
// Also flagged from that attempt: because the setters come from the store
// rather than useState, they are no longer stable-by-construction from
// React's point of view, and `react-hooks/exhaustive-deps` produced 4 new
// warnings in WorkspaceProvider (useCallback/useMemo dependency arrays
// that now technically reference them). Zustand setters ARE stable, so
// these are safe to leave or to satisfy explicitly — but decide
// deliberately rather than silently adding them to the arrays, since one
// of those arrays guards the whole context value's identity.
