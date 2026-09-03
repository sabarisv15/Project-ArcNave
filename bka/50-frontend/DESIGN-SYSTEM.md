# ARCNAVE Frontend Design System (current)

_Written 2026-09-03, P4 5.11. Source of truth for live values is code —
`frontend/src/index.css`'s `:root` block and `frontend/tailwind.config.js`
— both carry extensive in-code rationale comments; this doc distills them
into a scannable reference, not a replacement. If this doc and the code
ever disagree, the code wins — re-derive this doc from it, don't edit
around a stale table. Supersedes nothing structurally: `design-tokens.md`
in this same directory was already marked superseded on 2026-08-07 and is
kept only as historical record._

## Color tokens

Every color is one CSS custom property in `index.css`, expressed as RGB
channel triples so Tailwind opacity modifiers (`border-line/70`) work, and
wired to a Tailwind color name in `tailwind.config.js`. Components never
write a hex literal or an arbitrary color value — they name the Tailwind
token (`bg-surface`, `text-ink-muted`, `border-line-strong`).

**Ground plane — depth runs outside-in, and the surface being worked in is
the brightest thing on screen:**

| Token | Hex | Job |
|---|---|---|
| `frame` | `#F2F6FB` | outer app ground, behind the island |
| `sidebar` | `#F8FBFD` | the docked rail — paper white, between ground and canvas |
| `paper` | `#FFFFFF` | the workspace island: cards, panels, tables, composer |
| `raised` | `#FFFFFF` | drawers, dialogs, popovers, menus — same white as `paper`, separated by a firmer edge (`line-strong`) and a shadow instead of a tone step, since it can't be whiter than white |

**Tinted fields — each one is a distinct job, not interchangeable shades of
the same grey:**

| Token | Hex | Job |
|---|---|---|
| `surface` / `soft` / `tint` | `#F1F5FA` | inset panels, sticky table heads, composer attachment strip, calendar secondary cells, disabled |
| `tint2` / `hoverline` | `#EEF5FB` | hover / pressed states, neutral inactive chips — a cool step, deliberately never confusable with selection |
| `active` | `#DFEDF5` | selected navigation surface — accent-tinted so the current route reads as *the actionable one* |
| `mist` | `#EDF4FA` | the calm field a *header* sits on — scope lines, panel/monitoring-card header bands. Kept distinct from `tint` on purpose: labelling a section and heading a table are different jobs |

`tint`/`mist`/`active` look similar in isolation but are not
interchangeable — don't collapse them into one "light blue" value when
building a new screen; pick by job (table head vs. section label vs.
selected state), not by eyeballing the closest existing hex.

**Text ramp — deep blue-charcoal, not neutral grey, four steps, each with a
job:**

| Token | Hex | Contrast on white | Job |
|---|---|---|---|
| `ink` | `#0A1D28` | — | headings, card titles, essential values |
| `ink-soft` | `#1F303B` | — | sidebar nav, regular UI text, body default |
| `ink-muted` | `#4A5E6B` | 7.3:1 | secondary labels, support text, inactive nav |
| `ink-faint` | `#647885` | 4.6:1 | placeholders, muted helper copy |
| `ink-ghost` | `#9BAFBD` | — | subdued **icon** tone only, never text |
| `ink-disabled` | `#A7B7C2` | — | the disabled state, not a paler `ink-faint` |

**Accent — one teal carries every actionable meaning, so there is never a
second "text teal" competing with it:**

| Token | Hex | Job |
|---|---|---|
| `accent` | `#06657B` (6.7:1 on white) | primary actions, active nav, links, focus |
| `accent-hover` | `#05586B` | |
| `accent-press` | `#04495A` | |
| `accent-soft` | `#DCEDF4` | selected row, focused chip |
| `accent-soft2` | `#C6E2EC` | one step down — hover on an already-selected surface |
| `accent-line` | `#8FBFCE` | focused-input / selected-chip hairline |

Accent is never a page background, a rail, or a table color — it marks
what can be acted on, nothing else.

**Warm — the one saturated tone in the whole interface:**

| Token | Hex | Job |
|---|---|---|
| `warm` | `#E09038` | avatar fallback only |
| `warm-soft` | quiet amber wash | avatar fallback background |

Never a CTA, never destructive, never a table or navigation color. Under
1% of pixels in the whole interface are this color.

**Lines — three steps, each a different job, not a single "border grey":**

| Token | Hex | Job |
|---|---|---|
| `line-strong` | `#CFDCE8` | floating surfaces only — drawers, dialogs, popovers, menus |
| `line` | `#DEE7F1` | cards, tables, inputs, buttons, panel headers |
| `line-light` / `line-lighter` | `#E9EFF6` | row separators inside an already-bordered surface |
| `divider` | `#DBE5F0` | the app's one structural boundary — rail against workspace |

**Status families — one definition each, so the same meaning renders
identically everywhere it appears (a pending revision in the department
workspace and one in the delegated queue are the same color, not two hex
literals that happen to match today):**

| Family | Text | Soft wash | Meaning |
|---|---|---|---|
| `success` | `#117251` | `#E1F2EA` | approved, confirmed, locked, on track |
| `pending` | `#8A5E11` | `#FAF0D9` | awaiting a decision, in review |
| `warning` | `#A55223` | `#FBE9DD` | conflict, returned, needs attention |
| `info` | `#1A6C96` | `#DFEDF8` | live, current, selected context, monitoring |
| `danger` | `#A83A32` (+ `danger-hover` `#8F2F28`) | `#FAE8E4` | destructive / error |

`overlay` (`rgb(0 0 0)`) is the one neutral scrim behind every modal or
drawer — never tinted.

## Typography

Two font families, each with exactly one job — see `tailwind.config.js`
`fontFamily`:

- **`sans` (Inter)** — the interface default. Every non-chat surface
  inherits it automatically via `body`'s `font-family` in `index.css`; no
  component has to opt in. Chosen for small, dense, data-bearing UI: tall
  x-height, true tabular figures.
- **`font-chat` (DM Sans)** — opt-in only, applied at exactly four
  boundaries: chat transcript, chat composer, chat title, Sources. Never
  leaks into the rest of the interface; a non-chat component never mixes
  the two.

Body defaults: weight 400, line-height 1.45, letter-spacing -0.002em.
Hierarchy is carried by weight (500/600), size, and muted color — never by
making everything semibold.

## Shadows

Defined once in `tailwind.config.js` `boxShadow`, each named for where it's
used (`composer`, `island`, `pop`, `dialog`, `card`, `chip`, `toast`, …).
All are strictly neutral black at a 4–14% band — shadows only soften an
edge; on the floating tier (drawers/dialogs/popovers) it's `line-strong`
that signals "this is raised," not the shadow.

## Component primitives

`frontend/src/components/ui/` contains exactly **3 files** — this is the
real, current inventory, not a conventional design-system catalogue's
assumed shape. There is no shared `Button`/`Badge` primitive.

### `CopyButton.jsx`
- `useCopyState({ getText, holdMs = 1600 })` — hook for callers that own
  their own button markup and just need copy behavior (writes to
  clipboard, tracks `copied`/`failed`, auto-resets).
- `CopyButton({ getText, label = 'Copy', size = 14, className, holdMs })`
  — icon-only button (lucide `Copy`/`Check`), swaps icon on success (no
  cross-fade — a straight swap, deliberately, since a dissolve between two
  14px line glyphs reads as a smudge), holds 1.6s, reverts. No success
  toast (the change is already visible under the cursor); failure is a
  polite `sr-only` `aria-live` line, never a toast or modal.
- `CopyFailureNote({ failed, className })` — the failure line on its own,
  for callers using the hook directly.

### `Drawer.jsx`
- `DrawerShell({ open, onOpenChange, title, contextLine, description, width = 'sm:w-[540px]', children })`
  — the app's one right-side drawer chrome, built on Radix `Dialog`. Fixed
  to the right edge, `bg-raised` + `border-line-strong` + `shadow-dialog`,
  compact single-line header (title + optional muted `contextLine`, never
  a title block plus a paragraph), close button top-right. Closes on the
  close button, backdrop click, and Escape (Radix-native).
- `DrawerRail({ children, meta })` — sticky bottom action rail, the
  drawer's only place for commit actions; `meta` renders left of the
  action buttons.
- `PRIMARY_BTN`, `GHOST_BTN` — exported class-string constants for the
  drawer's own buttons (accent-filled / line-bordered ghost). Originally
  lived inside `AttendanceActionDrawer.jsx` before ~25 unrelated drawers
  across the app were importing them from there; moved here as a pure
  relocation, no markup or class-string changes (design is locked).

### `IconButton.jsx`
- `IconButton({ label, tooltip, className, children, ...props })` —
  icon-only control used app-wide. Always sets `aria-label={label}`. If
  `tooltip` is passed, wraps the button in a Radix `Tooltip`
  (`sideOffset={6}`, dark `bg-ink` content, 6ms fade-in via
  `animate-fadeUp`, respects `motion-reduce`); otherwise renders the plain
  button.

No `Badge` primitive exists. Four separate feature-specific badge
components stand in for it: `components/SeatStateBadge.jsx`,
`components/StaffNavCountBadge.jsx`,
`components/StudentNavCountBadge.jsx`,
`components/StudentOriginBadge.jsx`. `class-variance-authority` (`cva`) is
an installed dependency but is used nowhere in the codebase (`grep -rn
"cva(" frontend/src` returns zero matches as of this writing).

## Known gap — not fixed in this doc's slice

A `FIELD`/`MENU_ITEM`/`TOOL_BTN`-shaped local style-constant pattern
(module-level class-string constants for form fields, menu items, toolbar
buttons) is duplicated, not shared, across at least these 14 files:
`components/AdmissionWizard.jsx`, `components/ClassLogSection.jsx`,
`components/DecisionDrawer.jsx`, `components/ScholarshipDecisionPanel.jsx`,
`components/StudentsFilters.jsx`, `components/SubstituteRequestDrawer.jsx`,
`features/artifacts/routes/ArtifactEditor.jsx`,
`features/assessments/components/AssessmentCreateDrawer.jsx`,
`features/attendance/components/AttendanceActionDrawer.jsx`,
`features/calendar/components/DateNoteDrawer.jsx`,
`features/chat/components/ChatHeader.jsx`,
`features/documents/components/PersonalDocuments.jsx`,
`features/documents/components/RenameNodeDialog.jsx`,
`features/projects/routes/ProjectDetail.jsx`. Each file defines its own
copy of these constants rather than importing a shared one. Consolidating
them is a real, separate multi-file refactor (verify the strings are
actually identical across all 14 sites before merging any of them, not
assumed) — out of scope for this documentation pass.
