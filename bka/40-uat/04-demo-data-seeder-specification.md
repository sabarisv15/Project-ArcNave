# ARCNAVE — Demo Data Seeder Specification

**Status:** describes the existing seeder at
[`backend/db/seed-test-data.sql`](../../../backend/db/seed-test-data.sql),
which already satisfies UAT's data needs. No new seeder is required for
the UAT round described in this document set — this is a reference
specification of what it produces and why, so it can be reviewed,
extended, or reproduced without reverse-engineering the SQL.

## 1. Invocation

```bash
docker exec -i arcnave-blueprint-db-1 psql -U arcnave_admin -d arcnave < backend/db/seed-test-data.sql
```

Must run after migrations (`node scripts/migrate.js up`). Idempotent: the
script deletes and recreates only the `demo` tenant (college_id `demo`),
in FK-safe order, so re-running it never touches any other tenant and
always returns `demo` to the exact same state.

## 2. Tenant

One college: `demo` / "ARCNAVE Demo College", subdomain `demo`,
subscription status `trial`.

## 3. Users and identity

Five personal-login users, password `Test@1234` for all:

| Username | `users.role` | Position (Level) | Scope |
|---|---|---|---|
| `principal` | `principal` | L1 | College-wide |
| `hod.cse` | `hod` | L3 | CSE department |
| `tutor.cse3a` | `staff` | L4 (`class_tutor`) | Class CSE-3A |
| `tutor.cse3b` | `staff` | L4 (`class_tutor`) | Class CSE-3B |
| `staff.ece` | `staff` | none | ECE department, no position |

Every Position/Account/Occupant row (ADR-021) is seeded alongside the
`users` row, matching what each real provisioning flow
(`authService.provisionLevel1PositionForNewPrincipal`,
`staffService.ensureHodPosition`,
`classTutorService.assignClassTutor`) creates in production — RBAC checks
resolve through these rows, not `users.role` directly, so a login without
its matching Position row would silently behave as plain staff.

Position Accounts (`xxx@demo.positions.internal`) exist in the data for
completeness but are **not usable for UAT** — no frontend page can log
into a Position Account.

## 4. Departments, classes, staffing

- Departments: CSE, ECE
- Classes:
  - `3rd Sem · CSE-A` — timetable **Approved**, has a tutor (`tutor.cse3a`),
    a populated timetable grid, and faculty allocations — the only class
    where attendance marking is unlocked
  - `3rd Sem · CSE-B` — timetable **Pending HOD**, has a tutor
    (`tutor.cse3b`) — deliberately left un-approved so UAT can observe the
    attendance lock (task CT2-1)
  - `5th Sem · ECE-A` — timetable **No Tutor** — deliberately left
    untutored
- Faculty allocations link `tutor.cse3a` and `tutor.cse3b` to specific
  periods/subjects on CSE-3A/CSE-3B, so attendance-marking authorization
  checks (`attendanceService.assertCanMark`) have something real to
  resolve against.

## 5. Students

Six students (five CSE, one ECE), mixing `Regular` and `Lateral Entry`
entry types, with realistic Indian names/addresses/marks — deliberately
varied so admission-wizard and student-detail UAT tasks aren't looking at
uniform placeholder data.

## 6. Attendance

Two sessions seeded, both against CSE-3A only (today and yesterday) — the
one Approved class. One session has an absent student, the other has
none, so attendance-related screens have both states to display.

## 7. Fee payments

Four students with manually mixed `paid`/`not_paid` status, all marked by
`principal` — gives the Finance tab both states to show without every
tester needing to create fresh data first.

## 8. Documents

Seven default document categories (Curriculum, Circulars, Academic
Calendar, Examination, Policies, Forms, Notices) — the same defaults a
real principal-invitation acceptance seeds. No sample document rows yet;
testers uploading a document in P-7/H-8/S-6 will be creating the first
real rows against this tenant.

## 9. Deliberately not seeded

- Any generated reports (P-9 exercises the generation path fresh)
- Any AI Workspace conversation history (P-10/CT-6/S-8 exercise it fresh)
- A Level 2 position or an "Office/Admin" role — the system has neither by
  design (see [Master Test Plan](00-uat-master-test-plan.md) §5); do not
  add one to accommodate a UAT persona
- Usable Position Account credentials — the login screen for them doesn't
  exist yet, so seeding usable credentials would be seeding dead data

## 10. Resetting between UAT rounds

Re-running the same script restores this exact state. If a testing round
needs to preserve tester-created data between sessions (e.g. multi-day
UAT with the same tester), do not re-run the seed between those sessions —
only re-run it when starting a fresh round or handing to a new tester.

## 11. Extending this seeder

If a future UAT round needs a scenario not covered here (e.g. a second
department's HOD, a Level 2 position, more attendance history), extend
`seed-test-data.sql` directly rather than writing a parallel seeder —
keeping one source of demo data avoids two scripts drifting out of sync
with schema changes.
