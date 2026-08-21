# ARCNAVE — UAT Feedback Capture Template

Fill one entry per task, immediately after attempting it — friction is most
accurate in the moment, not reconstructed later. "No friction" is a valid
and useful entry; do not skip tasks that went fine.

Copy the block below per task.

```
Tester role:            (Principal / HOD / Class Tutor / Staff)
Task ID:                (e.g. P-3, CT-2)
Task name:
Date/time:

What did you try to do?


What actually happened?


Did you get stuck? Where, and for how long?


Confusing workflow (steps in the wrong order, unclear next action, etc.):


Missing feature (something you expected to be able to do but couldn't):


UI friction (hard to find, too many clicks, unclear button, bad layout):


Terminology issue (a label/word that didn't match how you'd say it):


Anything else worth noting:


Severity (tester's own judgment):  [ ] Blocked me entirely
                                    [ ] Annoying but I worked around it
                                    [ ] Minor / cosmetic
                                    [ ] No issue — this worked well
```

## Consolidation (for the observer / product owner, after each round)

Merge all entries into one findings log with these columns:

| # | Role | Task ID | Category (workflow / missing feature / UI friction / terminology) | Summary | Severity | Suggested owner action |
|---|---|---|---|---|---|---|

Triage each row into one of:

- **Terminology fix** — cheap, no logic change, just a label
- **UI friction fix** — cheap–medium, layout/flow change, no new capability
- **Missing feature** — needs scoping before it can be built
- **Workflow redesign** — needs a product decision, not just a fix

This log is the primary output of UAT — see [Master Test Plan](00-uat-master-test-plan.md) §9.
