# RS-PRF — Personal Workspace

**Domain:** Capabilities private to one account, with no institutional
visibility and no approval workflow — the opposite of every other domain in
this specification, each of which governs a shared or institutional record.
Added 2026-07-26 from the frontend discovery pass (UAT Priority 1 #3 and
Priority 2 #5/#6/#7) to close a real gap: none of Personal Notes, Activity
Timeline, or User Preferences had any governing rule before this domain
existed, the same "shipped with no governing rule" gap RS-ANL and RS-ADM each
closed on 2026-07-25.
**Owning services:** `personalNoteService`, `activityTimelineService`,
`userPreferenceService`.

> **Scope note.** Nothing in this domain is institutional data. RLS's
> tenant-isolation policy still scopes every table here by college, but
> visibility within a tenant is always exactly one user, never derived from
> position, department, or ownership the way [RS-CLS-009](RS-CLS-classroom.md#rs-cls-009)
> governs every other domain's write authority. A Principal has no
> visibility into a staff member's personal notes, preferences, or activity
> timeline, and vice versa — there is no "L1 sees everything" carve-out here.

> **AI parity note (2026-07-26).** ArcNave AI may perform anything the
> currently authenticated account could perform through the GUI — nothing
> more, nothing less — invoked only by an explicit user prompt, never
> automatically ([RS-AIG-007](RS-AIG-ai-governance.md#rs-aig-007)'s
> same-actor carve-out generalized as a product principle). Every direct
> write in this domain the AI may perform is one the acting user could
> already make unassisted, as themselves, with no approval step — the AI
> path and the human path share the same service call and the same scope
> check.

---

## RS-PRF-001

**A personal note is private to its creator. No other account, at any level,
may read, edit, or delete it.**

Distinct from [RS-GOV](RS-GOV-governance.md)'s Academic Calendar, whose own
rule is explicitly "one shared institutional calendar, not a personal task
list" — a personal note is the deliberate opposite: never shared, never a
institutional record, never subject to any approval or workflow. A reminder
timestamp exists so the frontend can sort/highlight upcoming items; it is not
wired to any notification-dispatch mechanism.

**Corrected 2026-07-26.** This rule's `AI` field previously read "Prohibited
... including the note's own owner acting through AI," on the premise that AI
touching personal notes was inherently a privacy risk. It is not: the AI acts
as the same user who already owns the note, never on anyone else's behalf —
`personalNoteService` enforces creator-only access identically regardless of
whether the caller is the human dashboard or the AI tool. Corrected to same-
actor allowed, per the AI parity note above.

**Widened 2026-08-04** ([ADL-030](../30-decisions/ledger.md#adl-030)): a note
now optionally carries a `noteDate` (any past, present, or future calendar
date, distinct from `reminderAt`'s time-of-day) so the frontend can render
notes on a real calendar grid instead of only a flat reminder-sorted list —
the flat list is retired in favor of the grid, not kept as a second surface.
This is a presentation change only, not a data-model merge with the
institutional Academic Calendar: the "distinct from RS-GOV's Academic
Calendar" framing above still holds exactly as written — a personal note
still lives in its own creator-only table, and the grid simply queries both
`personal_notes` (creator-scoped) and `academic_calendar_events`
(institution-scoped, already readable by every role) for the same visible
date range and renders them together. Nothing about either table's own
authority rule changes; only one screen now shows both.

| | |
|---|---|
| **Business Owner** | Personal Notes |
| **Supporting Components** | — |
| **Authority** | Creator only |
| **Depends on** | [RS-TEN-001](RS-TEN-tenancy-security.md#rs-ten-001) |
| **Governs** | — |
| **Lifecycle** | Note: created → (edited/deleted/marked done by creator only) |
| **Workflow** | None |
| **AI** | L1 direct-write, same-actor only — `personal_notes_list`, `personal_notes_create` |
| **Modules** | 9 |
| **Data effect** | Creates; creator may supersede or remove their own note |
| **Implementation** | `personalNoteService`, `personal_notes` table (`note_date` column added [ADL-030](../30-decisions/ledger.md#adl-030)) |
| **Conformance** | Conformant |
| **Decisions** | [ADL-030](../30-decisions/ledger.md#adl-030) |

---

## RS-PRF-002

**Every account may view its own activity timeline — every audited action it
has taken, across every domain, in one place. No account may view another
account's timeline.**

Reads directly off the existing `audit_log` table every domain in this
specification already writes to on a mutating action — this rule governs
access to that data for a new self-service purpose, not a new record of
activity. Deliberately self-only: an HOD or Principal management view into
their staff's own timelines is a distinct, unscoped capability this rule does
not grant.

| | |
|---|---|
| **Business Owner** | Activity Timeline |
| **Supporting Components** | — |
| **Authority** | Self only |
| **Depends on** | [RS-DAT-006](RS-DAT-data-integrity.md#rs-dat-006) |
| **Governs** | — |
| **Lifecycle** | — |
| **Workflow** | None — direct read |
| **AI** | L1 read, self-only — `activity_timeline_read` |
| **Modules** | 9 |
| **Data effect** | None — read-only |
| **Implementation** | `activityTimelineService.getOwnActivity`, `GET /activity-timeline` |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-PRF-003

**Every account may store and retrieve arbitrary named preference values for
itself. The platform imposes no fixed schema of preference keys.**

A single generic key/value store backs Saved Filters, Dashboard Layout, and
Notification Channel preferences alike — each a differently-named key on the
same table, not three separate features. The backend does not validate or
interpret a preference's contents; the frontend defines what keys exist and
what shape their values take, the same "backend stores, frontend defines the
shape" split [RS-GOV](RS-GOV-governance.md)'s Institution Settings categories
already draw for configuration. Storing a notification-channel preference
does not, by itself, change what channels `NotificationService` actually
dispatches through — enforcing a stored preference at send time is a distinct,
not-yet-built capability of `NotificationService`, not part of this rule.

| | |
|---|---|
| **Business Owner** | User Preferences |
| **Supporting Components** | — |
| **Authority** | Self only |
| **Depends on** | [RS-TEN-001](RS-TEN-tenancy-security.md#rs-ten-001) |
| **Governs** | — |
| **Lifecycle** | Preference: set → (overwritten/removed by its owner only) |
| **Workflow** | None |
| **AI** | L1 direct-write, same-actor only — `user_preferences_list`, `user_preferences_set` |
| **Modules** | 9 |
| **Data effect** | Creates/supersedes per key; no history retained across overwrites |
| **Implementation** | `userPreferenceService`, `user_preferences` table |
| **Conformance** | Conformant |
| **Decisions** | — |
