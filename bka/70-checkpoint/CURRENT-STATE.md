# Current State

_Last updated: 2026-08-09 — 4-login authorization commit (`4cb9013`,
"Enforce 4-login authorization: Position Occupancy != Current Login
Identity") independently re-verified read-only against the actual
diff. One real gap found and fixed: `classes.test.js` had only a
negative L4-authority test; the missing genuine positive-path test was
added and the full suite re-verified. Committed: `4111d30`._

Governed by [`00-protocol.md`](00-protocol.md). Read that file for the
rules; this file holds only the current task's state, per protocol §2
— no rule text, spec content, or design content belongs here.

## Active Task

None. The 4-login authorization architecture (`4cb9013`) is verified
and now has genuine positive-path L4 Position Account test coverage
for class reads (`4111d30`). No open follow-up from this task.

## Phase / Step

N/A — nothing in progress.

## Verification status

- Backend Docker suite: 1704/1704 green (full run, post the new test —
  was 1703 at `4cb9013`).
- Frontend Vitest: 49/49 green (full run; unaffected by this
  backend-test-only change).
- Frontend build: clean (`npm run build`, no errors).
- No live browser verification needed — backend integration test only,
  nothing user-facing changed.

## Decisions made

- The new test seeds a dedicated occupant (`l4seatuser`) rather than
  reusing `staffuser`: `staffuser` is already an active Class Tutor of
  a different class from the adjacent negative test, and
  `identityService.resolveActiveClassTutorPosition`'s underlying query
  (`findActiveClassTutorPositionForUser`) has no `ORDER BY` or
  uniqueness guard against one user holding two simultaneously-active
  Class Tutor positions — the schema only enforces "one active occupant
  per class" and "one active occupant per account," not "one active
  Class Tutor position per user." Reusing `staffuser` produced a false
  403 on first attempt (real, pre-existing ambiguity — not introduced,
  not fixed, out of scope per explicit instruction not to touch
  authorization logic).

## Files touched (committed)

`backend/tests/classes.test.js` — one new test
("read is allowed for the genuine L4 Class Tutor Position Account
login") plus the `seedClassTutorPosition` import. Committed as
`4111d30` on `feature/student-flag-subject-faculty`.

## Pending (not this task)

None from this task. Unrelated pre-existing uncommitted changes from
earlier sessions remain in the working tree (`AGENTS.md` and several
`frontend/src/**` files, plus untracked `docs/bka.zip`, `frontend.zip`,
`.claude/agents/`, `.claude/commands/`, `.claude/settings.json`,
`docs/bka/20-matrices/FEATURE-MATRIX.md`, `docs/bka/60-product-reasoning/`,
`SESSION-SUMMARY-2026-08-09-staff-visual-design.md`) — not touched or
evaluated as part of this task.

## Exact next action

None pending for this task. Awaiting the user's next instruction.

## Authoritative sources already identified for this task

- `backend/src/services/visibilityService.js`,
  `backend/src/services/identity/visibilityResolver.js`,
  `backend/src/services/identityService.js`,
  `backend/src/services/aiToolRegistry.js`,
  `backend/src/middleware/permissions.js`,
  `backend/src/middleware/identity.js`, `backend/src/security.js` —
  the 4-login authorization architecture's actual implementation.
- `backend/tests/students.test.js` (`loginTutor()` helper) and
  `backend/tests/helpers/positionFixtures.js`
  (`seedClassTutorPosition`) — the proven genuine-L4-login test
  pattern this task's new test follows.
