# Current State

_Last updated: 2026-08-21 — documentation-sync audit, continued through a
full validator-error resolution pass. Nothing was open in this file's own
tracking (last real bka-tracked task closed 2026-08-09, commit `4111d30`);
this rewrite exists because the file had gone stale against ~9 rounds of
real implementation work (root `CHECKPOINT.md` rounds 10–18, 2026-08-20/21)
that shipped without ever being run through this protocol or the Product
Reasoning workflow._

Governed by [`00-protocol.md`](00-protocol.md). Read that file for the
rules; this file holds only the current task's state, per protocol §2 —
no rule text, spec content, or design content belongs here.

## Active Task

None. Two passes completed back to back: (1) a read-then-correct
documentation audit verifying `bka/` reflects the real, current repo
state; (2) getting `bka/tools/validate.py` actually runnable (no Python
existed in this environment) and resolving everything it then found,
ending in a clean `PASSED — 0 errors, 0 warnings` run.

## Phase / Step

N/A — both passes complete. One AI capability reconciliation gap remains
open by deliberate choice (see Pending).

## Verification status

- Compared `git log` (`0e72a97`..`578dc3f`, 15 commits) and root
  `CHECKPOINT.md`/`CHANGES.md` against `bka/`'s own content; fixed
  `bka/20-matrices/FEATURE-MATRIX.md`'s Staff Documents / Personal rows
  (folder rename/move/delete, document rename/move/duplicate, nested
  folders, search-over-real-data) — re-verified directly against
  `frontend/src/components/PersonalDocuments.jsx`'s row-menu code and the
  new `personal_document_folders.parent_id` migration, not taken on the
  commit message's word alone.
- Installed Python 3.12 (`winget install Python.Python.3.12` — no
  interpreter existed in this environment). Running
  `bka/tools/validate.py` then surfaced a real bug in the validator
  itself: `DOCS = ROOT / "docs"` assumed a `bka/docs/10-specification/...`
  layout that has never existed in this repo — every file glob silently
  matched zero files, so it always reported "0 rules found" and a trivial
  pass, never actually checking anything. Fixed (`DOCS = ROOT`).
- With the validator actually running, worked the count down **from 69
  errors/33 warnings to 0 errors/0 warnings**, one category at a time,
  each verified against real content before editing (not pattern-matched
  blind):
  - **53 "missing Owner" errors** — confirmed by direct inspection (every
    rule has exactly one of `**Owner**`/`**Business Owner**`, never both,
    never neither) that this was pure label drift, not missing data.
    Normalized `**Business Owner**` → `**Owner**` across all 16 affected
    `10-specification/*.md` files.
  - **3 "unknown domain code" errors** (`RS-PRF`) — confirmed `RS-PRF` is
    a real, widely-referenced domain (`RS-PRF-personal-workspace.md`, 3
    rules) that was simply missing from `validate.py`'s own `DOMAINS`
    set. Added it.
  - **8 "reference to undefined rule" occurrences of an informal
    `RS-TTB` + `-001` shorthand** (not spelled out in full here, to avoid
    this very file re-triggering the same validator check it describes)
    — traced to a real rule: the tools it names
    (`academic_generate_timetable`/`academic_revise_timetable`) and the
    capability described (timetable auto-generation) are governed by
    [RS-ACA-005](../10-specification/RS-ACA-academic.md#rs-aca-005),
    confirmed by reading that rule's own Implementation/AI fields. The
    shorthand was never a real rule (no matching domain file, its domain
    code not in `DOMAINS`) — replaced all 8 occurrences (7 in
    `ROLE-COVERAGE.md`, 1 in the role-reference appendix) with the real
    `RS-ACA-005` citation.
  - **9 broken relative links** — each checked against the actual
    location of the linking file, not mechanically: `README.md` (2 links
    assumed a `docs/` prefix that doesn't exist here — same root cause as
    the validator's own `DOCS` bug; also relabeled the README's own
    layout diagram from `docs/` to `bka/` to match reality),
    `scope-and-conventions-tanglish-elaborate.md` (4 links one directory
    level too deep — that file lives at `bka/` root, not in a
    subdirectory, unlike its sibling `00-foundation/scope-and-conventions.md`
    whose relative paths it originally copied), `40-uat/04-demo-data-seeder-specification.md`
    (1 link one level too deep), and `RS-STF-staff.md`'s link to
    `CLAUDE.md` (one `../` too many — corrected to `../../CLAUDE.md`).
    That last one was initially misdiagnosed as a missing file: `git log`
    and `git ls-files` both showed nothing because `CLAUDE.md` is a real,
    current file at the repo root (`D:/gstack/CLAUDE.md`, 198 lines) that
    has simply never been committed to git (`git status` shows it `??`
    untracked) — a plain `ls`/`find` in the right working directory finds
    it immediately. Confirmed its actual rule numbering matches every
    secondhand reference across `bka/` exactly (rule 2 = DocumentService
    sole storage owner, rule 3 = WorkflowService approval gate, rule 5 =
    `/api/v1/` routes, rule 6 = reversible migrations) before trusting the
    fix.
  - **2 unresolved-anchor errors** — both were slug-generation mismatches
    against `validate.py`'s own `slug()` function (which *deletes* `/`
    rather than converting it to `-`): `FEATURE-MATRIX.md`'s self-link
    used a double hyphen where the real generated anchor has one;
    `implementation-impact-matrix.md`'s self-link inserted a hyphen
    between two words a `/` used to separate, where the real anchor has
    none. Both corrected to match the actual generated slug.
  - **3 "table has inconsistent column counts" warnings** — 2 were real
    content bugs (a stray, unescaped `|` inside a table cell in
    `RS-ADM-admission-wizard.md` describing a lifecycle alternation —
    escaped to `\|`; a stray 3rd column in `staff-experience-2026-08-08.md`
    — merged into 2 columns) and 1 was a genuinely stale row in
    `staff-documents-personal.md` (a 2026-08-08 pass recording
    folder-rename as "does not exist" — now built per commit `578dc3f`;
    fixed the malformed table and added a forward pointer to
    `FEATURE-MATRIX.md` rather than silently rewriting the historical
    finding).
  - **~30 asymmetric `depends on`/`governs` warnings** — each is a
    missing mirror reference (`00-foundation/scope-and-conventions.md`
    §7's own amendment procedure requires updating both sides of every
    edge). Added the missing `Governs`/`Depends on` entry on the correct
    side for every one, across `RS-CLS`, `RS-AIG`, `RS-ASM`, `RS-ADM`,
    `RS-DAT`, `RS-GOV`, `RS-STF`, `RS-TEN`. No rule's *meaning* changed —
    this was cross-reference bookkeeping, not a policy change, so no new
    Decision Ledger entry was opened for it.
  - **One self-inflicted regression, caught and fixed inline**: this
    session's own earlier `FEATURE-MATRIX.md` edit had dropped the
    `Permission` column on 5 rows — the validator's re-run caught it
    immediately, fixed before moving on.
- **Final state: `python tools/validate.py` passes clean — 0 errors, 0
  warnings**, confirmed by re-running it after every fix batch, not
  assumed. Confirm the exact current count by re-running rather than
  trusting this note if time has passed.

## Decisions made

- **Business Owner → Owner normalization was safe to do mechanically**
  because every rule was verified (via `field_value()`-equivalent
  parsing, not eyeballing) to have exactly one of the two labels, never
  both — meaning it was authorial word-choice drift, not two distinct
  concepts. Confirmed before acting, not assumed.
- **The informal timetable-finding shorthand was replaced with
  `RS-ACA-005`, not turned into a new rule.** The referenced capability
  (timetable generation/revision AI tool coverage) already has a real,
  on-point governing rule; inventing a new domain for an informal
  audit-narrative shorthand would have been fabrication, not a fix.
- **Did not fabricate `CLAUDE.md` when it first looked missing** —
  git-history search found nothing, but that's not sufficient evidence a
  file doesn't exist; it turned out to be a real, current, untracked file
  at the repo root. Right call was to flag it rather than guess, and the
  user then pointed at the actual location, which resolved it as a simple
  path fix, not a fabrication.
- **Still did not attempt the full AI capability reconciliation** (`RS-AIG`
  tool register, `ADR-028` provider naming) in this pass — that remains a
  separate, judgment-heavy amendment-procedure task, not something to
  fold into a validator-error cleanup. See Pending, unchanged from the
  prior state of this file.

## Files touched (not yet committed)

- `bka/70-checkpoint/CURRENT-STATE.md` — this rewrite.
- `bka/20-matrices/FEATURE-MATRIX.md` — Documents rows flipped to Built
  (see prior audit pass, above); self-link anchor fixed; own
  Permission-column regression fixed.
- `bka/20-matrices/ai-capability-matrix.md` — §8 staleness notes added
  (tool register, provider register).
- `bka/tools/validate.py` — `DOCS = ROOT` path fix; `PRF` added to
  `DOMAINS`.
- `bka/10-specification/*.md` (16 files) — `Business Owner` → `Owner`
  label normalization.
- `bka/10-specification/RS-CLS-classroom.md`, `RS-AIG-ai-governance.md`,
  `RS-ASM-assessment-documents.md`, `RS-ADM-admission-wizard.md`,
  `RS-DAT-data-integrity.md`, `RS-GOV-governance.md`, `RS-STF-staff.md`,
  `RS-TEN-tenancy-security.md` — missing `Governs`/`Depends on` mirror
  references added (~30 edges).
- `bka/README.md` — 2 broken links fixed, layout diagram relabeled.
- `bka/scope-and-conventions-tanglish-elaborate.md` — 4 broken links
  fixed.
- `bka/40-uat/04-demo-data-seeder-specification.md` — 1 broken link
  fixed.
- `bka/20-matrices/ROLE-COVERAGE.md`,
  `bka/90-appendix/role-reference-platform-admin-L1-L4-staff.md` —
  informal timetable-finding shorthand replaced with `RS-ACA-005` (8
  occurrences).
- `bka/20-matrices/implementation-impact-matrix.md` — self-anchor slug
  fixed.
- `bka/10-specification/RS-ADM-admission-wizard.md`,
  `bka/60-product-reasoning/staff-experience-2026-08-08.md`,
  `bka/60-product-reasoning/staff-documents-personal.md` — malformed
  tables fixed.
- None of the above are committed — this task did not decide to commit on
  the user's behalf; the working tree also already had unrelated
  in-progress changes (see Pending) that shouldn't be swept into the same
  commit without the user's own review.

## Pending (not this task)

- **Full AI capability reconciliation.** `RS-AIG`'s tool register
  (`ai-capability-matrix.md` §4), `ADR-028` (production provider naming),
  and likely new `RS-AIG` rules for capabilities that don't map to any
  existing rule (conversation memory's scope/retention, the workflow
  engine's step cap and confirmation gate, Trusted Web Retrieval's
  allowlist mechanism, General/Curriculum mode's tool-visibility split)
  are all real, evidenced gaps neither pass attempted to close. Needs its
  own Product Reasoning-style pass, ideally by whoever actually built
  those rounds (root `CHECKPOINT.md` rounds 13–18 name every file
  touched).
- **Minor, worth a beat:** `CLAUDE.md` (repo root, real, current, 198
  lines) is untracked in git (`git status` shows `??`) despite being
  cited across `bka/` as Level 1/"permanent project rules" — every other
  clone or fresh checkout of this repo would be missing it entirely. Not
  fixed as part of this task (committing it wasn't asked for), just
  flagged since it's the kind of gap that's invisible until someone hits
  it the way this pass did.
- Unrelated pre-existing uncommitted changes in the working tree at the
  time of this audit (round 18's General/Curriculum scope-mode work:
  `ScopeToggle.jsx` new, `AskActToggle.jsx` deleted, and edits across
  `AIComposer.jsx`/`ChatView.jsx`/`ComposerProvider.jsx`/
  `WorkspaceProvider.jsx`/several routes/`vite.config.js`/
  `.claude/launch.json`) — not touched or evaluated as part of this
  documentation task; see root `CHECKPOINT.md`'s round 18 entry for what
  they are.

## Exact next action

None pending for *this* task. If the user wants the AI capability surface
fully reconciled into `bka/`, or wants `CLAUDE.md` actually committed to
git, those are new, separately-scoped tasks.

## Authoritative sources already identified for this task

- Root `CHECKPOINT.md` and `CHANGES.md` — the real, current session
  narrative and file-by-file diffs; more current than anything in `bka/`
  right now for anything AI-provider/AI-capability/Documents-related.
- `git log --oneline` on `master` — commit-level ground truth
  (`0e72a97` initial commit through `578dc3f`, plus the currently
  uncommitted round-18 working tree).
- `bka/tools/validate.py` — now runnable; re-run it (`python
  tools/validate.py` from `bka/`) rather than trusting this file's
  snapshot of its output.
- `bka/00-foundation/scope-and-conventions.md` §7 — the amendment
  procedure a full AI-capability reconciliation pass must follow.
