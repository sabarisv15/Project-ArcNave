# Page Contract — Template

Copy this into `<page-slug>.md` §1–2 when running the workflow against a
new page. See [`00-workflow.md`](00-workflow.md) §4–5.

---

## Page

- **Name:**
- **Route(s):**
- **Role(s) that see it:**
- **Scope mode:** Full Page / Feature (`--feature "<description>"`) — see [`00-workflow.md`](00-workflow.md) §3 (0b). Feature mode reads an existing page-contract as context instead of filling this section in from scratch.
- **Multi-screen split:** if the supplied visual contained more than one screen/page, note which screen this contract covers, and list the other identified screens (each gets its own page-contract + Approved Spec — see §3 (0a)).

## Visual Design Source (source A)

- **What was supplied:** Figma link / attached screenshot / mockup file / "none — live implementation is the only reference." An attachment plus an "implement this"-style request is itself sufficient — no URL or explicit command required (§2).
- **Enumerated contents, if a design was supplied:** every page/tab/section/menu/button/dialog/table/list/action/state it shows or reasonably implies — this feeds the Layout section below and Step 3's Feature Analyzer.
- **Diff vs. live implementation:** anything the reference shows that the live page doesn't, or vice versa. This disagreement is itself a finding, not silently resolved here — see §15's conflict resolution order.

## Navigation

- **Entry point(s):** where a user gets here from
- **Links out to:** what this page can navigate to
- **Navigation consistency:** does it match existing ARCNAVE nav patterns (source A vs C)? Note any mismatch.
- **Cross-page dependencies:** if this page was split out of a multi-screen design (see "Multi-screen split" above), note the relationships to those other pages here (e.g. "the 'New folder' button on this page's sibling screen opens this page's dialog") rather than folding them into either page's own contract.

## Layout

- **Sections / tabs:**
- **Menus:**
- **Buttons (visible actions):**
- **Dialogs:**
- **Tables / cards / lists:**

## UX consistency notes

Compare against existing ARCNAVE patterns (buttons, dialogs, tables,
menus, notifications, loading/empty/error states, terminology). Note
anything inconsistent — do not silently fix it here, record it for the
Feature Matrix / Product Refinement pass.
