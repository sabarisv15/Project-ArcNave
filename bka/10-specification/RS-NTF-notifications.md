# RS-NTF — Notifications

**Domain:** The notification ledger, approval gate, delivery history, the
system-notification carve-out, Send Alert, OTP.
**Owning service:** `NotificationService`.

---

## RS-NTF-001

**Every outbound notification is a ledger row before it is sent:
`draft → approved → dispatched`.**

The approval step records the approving actor. No notification reaches an
external channel — email, SMS or WhatsApp — without first existing as a
persisted draft, with exactly two declared exceptions
([RS-NTF-006](#rs-ntf-006), [RS-NTF-007](#rs-ntf-007)).

| | |
|---|---|
| **Owner** | `NotificationService` |
| **Authority** | Drafting actor; approver per [RS-NTF-003](#rs-ntf-003) |
| **Depends on** | [RS-WFL-001](RS-WFL-workflow.md#rs-wfl-001) |
| **Governs** | [RS-NTF-002](RS-NTF-notifications.md#rs-ntf-002), [RS-NTF-003](RS-NTF-notifications.md#rs-ntf-003), [RS-NTF-004](RS-NTF-notifications.md#rs-ntf-004) |
| **Lifecycle** | **Notification — canonical definition:** `draft → approved → dispatched` |
| **Workflow** | Approval required before dispatch |
| **AI** | L2 generate for drafting; L3 for the send |
| **Modules** | 8 |
| **Data effect** | Creates |
| **Implementation** | `notifications` table (migration `1753100000000_module-8-notification-ledger.js`), RLS-scoped; `notificationService.draftNotification`/`submitForApproval` — **verified against real code, 2026-07-25: this is built, not a gap** |
| **Conformance** | Conformant |
| **Decisions** | [ADL-016](../30-decisions/ledger.md#adl-016) |

---

## RS-NTF-002

**Every delivery attempt is recorded — provider, status, error, timestamps — so
delivery history is never lost, including retries.**

| | |
|---|---|
| **Owner** | `NotificationService` |
| **Authority** | System invariant |
| **Depends on** | [RS-NTF-001](RS-NTF-notifications.md#rs-ntf-001) |
| **Governs** | — |
| **Lifecycle** | Notification delivery attempt |
| **Workflow** | — |
| **AI** | L1 read |
| **Modules** | 8 |
| **Data effect** | **Preserves** — append-only attempt log |
| **Implementation** | `notification_delivery` table, same migration as [RS-NTF-001](#rs-ntf-001) — **verified against real code, 2026-07-25: built, not a gap** |
| **Conformance** | Conformant |
| **Decisions** | [ADL-016](../30-decisions/ledger.md#adl-016) |

---

## RS-NTF-003

**Notifications that leave the system always require human approval before
dispatch, and that approval uses the same shared workflow engine as every other
approval.**

This applies regardless of whether a human or the AI initiated the draft. It is
**not** a separate, bespoke notifications-only mechanism; the approving-actor
field on the notification record is simply where the engine's decision is
recorded for this module
([RS-WFL-001](RS-WFL-workflow.md#rs-wfl-001)).

| | |
|---|---|
| **Business Owner** | Notification Approval |
| **Supporting Components** | `NotificationService`, `WorkflowService` |
| **Authority** | Per the institution's configured chain |
| **Depends on** | [RS-WFL-001](RS-WFL-workflow.md#rs-wfl-001), [RS-NTF-001](RS-NTF-notifications.md#rs-ntf-001), [RS-AIG-004](RS-AIG-ai-governance.md#rs-aig-004) |
| **Governs** | [RS-NTF-005](RS-NTF-notifications.md#rs-ntf-005), [RS-NTF-006](RS-NTF-notifications.md#rs-ntf-006) |
| **Lifecycle** | Notification |
| **Workflow** | `notification`; approval before dispatch |
| **AI** | L3 workflow-submitting for any AI-initiated send |
| **Modules** | 8, 9 |
| **Data effect** | Supersedes notification state |
| **Implementation** | `notificationService.draftNotification` / `submitForApproval`; approve/reject dispatch case in the workflow route |
| **Conformance** | Conformant for the approval path |
| **Decisions** | [ADL-016](../30-decisions/ledger.md#adl-016) |

---

## RS-NTF-004

**There is no automatic notification system for academic and business alerts.**

Attendance, marks, timetable changes and the like generate no automatic
notification. Staff use Send Alert ([RS-NTF-006](#rs-ntf-006)) when
communication is needed.

This restriction is scoped precisely: it applies to academic and business
alerts only, never to the system notifications enumerated at
[RS-NTF-005](#rs-ntf-005). Examination revision alerting
([RS-ASM-007](RS-ASM-assessment-documents.md#rs-asm-007)) is a
meaningful-change-only exception within the same discipline.

| | |
|---|---|
| **Owner** | `NotificationService` |
| **Authority** | Scope boundary |
| **Depends on** | [RS-ASM-007](RS-ASM-assessment-documents.md#rs-asm-007), [RS-NTF-001](RS-NTF-notifications.md#rs-ntf-001) |
| **Governs** | [RS-NTF-005](RS-NTF-notifications.md#rs-ntf-005), [RS-NTF-006](RS-NTF-notifications.md#rs-ntf-006), [RS-NTF-007](RS-NTF-notifications.md#rs-ntf-007) |
| **Lifecycle** | — |
| **Workflow** | — |
| **AI** | — |
| **Modules** | 8 |
| **Data effect** | — |
| **Implementation** | No academic alerting scheduler exists |
| **Conformance** | Conformant |
| **Decisions** | — |

---

## RS-NTF-005

**System notifications are automatic and carry no draft or approve step.**

The complete set:

| System notification | Governing rule | Carries a required action? |
|---|---|---|
| OTP | [RS-NTF-008](#rs-ntf-008) | No — delivery only |
| Login credentials / invitations | [RS-IDN-010](RS-IDN-identity.md#rs-idn-010) | No |
| Password reset | [RS-IDN-009](RS-IDN-identity.md#rs-idn-009) | No |
| Security messages | [RS-TEN-008](RS-TEN-tenancy-security.md#rs-ten-008) | No |
| Substitute request / approval alert to L3 | [RS-CLS-007](RS-CLS-classroom.md#rs-cls-007) | **Yes — approve or reject** |
| Five-consecutive-day absence flag to L3 | [RS-ATT-008](RS-ATT-attendance.md#rs-att-008) | **Yes — review and close** |
| Pending high-severity student-status request to L3 | [RS-STU-007](RS-STU-students.md#rs-stu-007) | **Yes — approve or reject** |

All are fixed, mechanical, system-generated content with nothing discretionary
to review — the same reasoning as OTP. Unlike OTP, the last three carry a
required action and are therefore not delivery-only: they remain outstanding
until acted on.

**Adding a system notification requires amending this rule.** A notification
that is not on this list uses the ordinary draft → approve → dispatch ledger.

| | |
|---|---|
| **Owner** | `NotificationService` |
| **Authority** | System-generated |
| **Depends on** | [RS-STU-007](RS-STU-students.md#rs-stu-007), [RS-NTF-003](RS-NTF-notifications.md#rs-ntf-003), [RS-NTF-004](RS-NTF-notifications.md#rs-ntf-004) |
| **Governs** | [RS-CLS-007](RS-CLS-classroom.md#rs-cls-007), [RS-NTF-008](RS-NTF-notifications.md#rs-ntf-008) |
| **Lifecycle** | Notification (bypasses draft/approve) |
| **Workflow** | **None** — declared carve-out |
| **AI** | — |
| **Modules** | 8 |
| **Data effect** | Creates; closure of action-carrying alerts is logged |
| **Implementation** | **Updated 2026-07-26**: all three action-carrying alerts are now pushed via direct email (`notificationService.sendViaChannel`, same no-draft-no-approve carve-out this rule declares) — the five-consecutive-day absence flag ([RS-ATT-008](RS-ATT-attendance.md#rs-att-008)), the pending high-severity student-status alert ([RS-STU-007](RS-STU-students.md#rs-stu-007)), and now the substitute request/approval alert to L3 ([RS-CLS-007](RS-CLS-classroom.md#rs-cls-007)) |
| **Conformance** | Conformant |
| **Decisions** | [ADL-011](../30-decisions/ledger.md#adl-011) |

---

## RS-NTF-006

**AI may draft the wording of a Send Alert message, but the same tutor MUST
directly review and confirm the final text before it sends.**

The disqualifying condition is not "AI touched it" — it is "nobody reviewed
it". AI assisting with wording does not grant new authority; the tutor already
holds unilateral authority to send this exact category of message, so AI
assistance only saves typing.

**An unreviewed AI auto-dispatch is prohibited.** An AI-*initiated* trigger —
the AI deciding to send on its own, without the tutor reviewing the final text
— is a different capability entirely and MUST go through the ordinary
draft → approve → dispatch path like every other Level 3 send, with no
exception.

| | |
|---|---|
| **Owner** | `NotificationService` |
| **Authority** | The class's own L4 |
| **Depends on** | [RS-STU-012](RS-STU-students.md#rs-stu-012), [RS-NTF-003](RS-NTF-notifications.md#rs-ntf-003), [RS-NTF-004](RS-NTF-notifications.md#rs-ntf-004), [RS-NTF-007](RS-NTF-notifications.md#rs-ntf-007), [RS-AIG-007](RS-AIG-ai-governance.md#rs-aig-007) |
| **Governs** | — |
| **Lifecycle** | Notification (outside the ledger) |
| **Workflow** | **None** — the human review is the gate |
| **AI** | L2 generate — drafting only; dispatch requires the tutor's confirmation |
| **Modules** | 8, 9 |
| **Data effect** | Creates; audited |
| **Implementation** | Send Alert route |
| **Conformance** | Conformant |
| **Decisions** | [ADL-017](../30-decisions/ledger.md#adl-017) |

---

## RS-NTF-007

**Send Alert is a direct, human-triggered dashboard action outside the
notification ledger, and the exception holds only while every one of its
conditions holds.**

Send Alert is any staff member **currently timetable-assigned to a class**
(subject/period assignment — a Class Tutor's own class also qualifies, since
a tutor is definitionally assigned to it) sending a plain-text WhatsApp
message to that class's students and parents. It is the same category of
action as a staff member marking attendance directly — not a draft anyone
else approves. No L3 or `WorkflowService` involvement applies.

**Conditions — all must hold:**

1. The sender is **currently timetable-assigned to that class**
   (subject/period link, verified via `AcademicService` — not
   self-declared), sending to **that class only**, never a class they are
   not assigned to.
2. The content is **plain free text**.
3. Delivery is **per-recipient, best-effort**, with no auto-retry and no
   channel fallback.
4. The sending staff member reviews the final wording before it sends
   ([RS-NTF-006](#rs-ntf-006)).

**Any variant that drops one of these conditions** — a send to a class the
sender isn't assigned to, rich content, or an auto-dispatch with no human
reviewing the final text — is a different feature and MUST use the normal
draft → approve → dispatch ledger.

**Widened 2026-07-30** ([ADL-024](../30-decisions/ledger.md#adl-024)): authority
was originally "Class Tutor, own class" only; widened to any
timetable-assigned staff member. Implementation updated the same day —
`academicService.sendClassAlert` now allows the tutor OR any staff
member with a `faculty_allocation` row for that class.

| | |
|---|---|
| **Business Owner** | Send Alert |
| **Supporting Components** | `NotificationService`, `AcademicService` |
| **Authority** | **Any staff timetable-assigned to the class, unilateral, own assigned class only** |
| **Depends on** | [RS-WFL-004](RS-WFL-workflow.md#rs-wfl-004), [RS-STU-012](RS-STU-students.md#rs-stu-012), [RS-NTF-004](RS-NTF-notifications.md#rs-ntf-004) |
| **Governs** | [RS-NTF-006](RS-NTF-notifications.md#rs-ntf-006) |
| **Lifecycle** | Outside the notification lifecycle |
| **Workflow** | **Exempt by design** ([RS-WFL-004](RS-WFL-workflow.md#rs-wfl-004)) |
| **AI** | L2 drafting only, per [RS-NTF-006](#rs-ntf-006) |
| **Modules** | 3, 8 |
| **Data effect** | Creates; audited |
| **Implementation** | `POST /api/v1/classes/:id/send-alert`; `academicService.sendClassAlert` — tutor-or-assigned-faculty check, per ADL-024 |
| **Conformance** | Conformant |
| **Decisions** | [ADL-017](../30-decisions/ledger.md#adl-017), [ADL-024](../30-decisions/ledger.md#adl-024) |

---

## RS-NTF-008

**Student and parent phone OTP verification is delivered exclusively over
WhatsApp, never SMS.**

A verified OTP guarantees only that the number was reachable on WhatsApp at the
moment of verification. **A later delivery failure to that same number is
expected behaviour, not a contradiction of "verified."**

| | |
|---|---|
| **Owner** | `NotificationService` |
| **Authority** | System-generated |
| **Depends on** | [RS-NTF-005](RS-NTF-notifications.md#rs-ntf-005) |
| **Governs** | — |
| **Lifecycle** | OTP: `issued → verified \| expired` |
| **Workflow** | **None** — system notification carve-out |
| **AI** | Prohibited |
| **Modules** | 8 |
| **Data effect** | Creates |
| **Implementation** | `phoneVerificationService.js` via the WhatsApp Cloud API |
| **Conformance** | Conformant |
| **Decisions** | — |
