# Capability Parity

**Status:** Normative
**Purpose:** Defines the fixed ordering between backend authorization, GUI
exposure, and AI Workspace exposure. No route, permission entry, or AI tool
may be added or changed in a way that breaks this ordering.

---

## 1. The rule

```
Backend
    ≥
GUI
    =
AI
```

Read as two separate inequalities:

- **GUI is never more powerful than backend.** Every capability the GUI
  exposes must already be authorized at the backend (route/service) layer.
  The GUI cannot grant an action the backend would reject.
- **AI is never more powerful than GUI, and never falls permanently short of
  it either — the two stay equal.** Every capability reachable through the AI
  Workspace must also be reachable through the GUI for that same actor, and
  every GUI-reachable capability should eventually have an AI tool, unless
  explicitly and permanently excluded (see §4).

Backend may sit strictly above GUI (it can, and does, contain internal
services, scheduled jobs, and platform-level operations no tenant-facing
screen ever surfaces). GUI and AI, by contrast, are meant to converge: the AI
Workspace is a second interface onto the same set of user-facing actions the
GUI already offers, not a separate authority.

## 2. Why the three layers can drift independently

- **Backend** is the set of routes and Business Service methods, each gated
  by `middleware/permissions.js` (`PERMISSION_ROLES`) and, where an action is
  scoped to a specific class/department/record rather than a role, by a
  service-layer ownership check (e.g. `academicService.assertCanGenerateForClass`,
  `studentService.assertCanModifyStudent`). This is the only place real
  authorization happens.
- **GUI** represents the human-facing workflows a role's dashboard/nav
  exposes. A route being backend-reachable does not mean it has a GUI entry
  point yet — an IA gap (missing nav slot) is not itself an authorization
  defect, but it does mean the GUI is *under*-exposing a capability the
  backend already grants that role.
- **AI** is `aiToolRegistry.js`'s tool set — one tool per Business Service
  call, each with its own `allowedRoles`/`dataClassification`/`level`. A tool
  never contains business logic of its own (AI-Governance §2): it is a thin
  wrapper that calls the same service function, and is re-validated by the
  Policy Gate on every invocation, exactly as if a human had called the route
  directly.

Because these three gates are edited independently — a permissions.js entry,
a nav config, and an `aiToolRegistry.js` tool are three separate files with no
shared source of truth enforcing agreement — they drift. The Capability
Coverage Audit (`../20-matrices/ROLE-COVERAGE.md`) exists specifically to
catch that drift; this document states the rule the audit checks against.

## 3. AI never bypasses a GUI restriction

If the GUI intentionally hides a capability from a role (e.g. plain `staff`
has no fee-payment-recording screen, because RS-FIN-002 names the Class Tutor
only), the AI tool for that capability must apply the identical restriction.
An AI tool's `allowedRoles` widening beyond what the GUI grants that role is
always a defect, never a feature — "the AI is smarter/faster than the GUI
screen" is not a justification, because the AI Workspace's own charter
(RS-AIG-ai-governance.md) is to mirror the account's authority, not to extend
it. The classification override mechanism (`classificationOverrideRoles`) is
the one structural exception: a single, explicitly-named per-tool carve-out
for a role that already has the underlying ownership right (e.g. `class_tutor`
for `finance_record_payment`, RS-FIN-006) — never a general widening.

## 4. Explicit exclusions

- **Platform Admin** has no AI Workspace surface at all today (by design — see
  `ROLE-COVERAGE.md` §5) and is excluded from the "AI = GUI" half of this
  rule entirely, not merely deferred.
- A capability may be **temporarily** GUI-only or backend-only without being
  a defect, provided it is recorded as such (an open finding in
  `ROLE-COVERAGE.md`, or an entry under "Intentionally Deferred" there) —
  the rule is violated by an *unrecorded*, silent mismatch, not by a tracked,
  acknowledged gap awaiting a scheduled fix.

## 5. Enforcement

This document states the rule; it does not enforce it mechanically (no
automated linter cross-checks `permissions.js` against `aiToolRegistry.js`
today — a real, acknowledged gap, not a false claim of tooling that doesn't
exist). Enforcement today is the Capability Coverage Audit
(`../20-matrices/ROLE-COVERAGE.md`), run manually against the three source
files named in its own header, and this rule is what every finding in that
audit is checked against.
