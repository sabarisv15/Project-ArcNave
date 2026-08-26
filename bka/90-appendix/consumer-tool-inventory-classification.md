# Consumer assistant tool/skill inventory — ARCNAVE classification

_Written 2026-08-26. Closes the gap flagged in
[`CURRENT-STATE.md`](../70-checkpoint/CURRENT-STATE.md) "Active Task 2":
the 46-tool classification previously existed only in a chat transcript._

## What this is

The consumer Claude.ai assistant's own tool and skill inventory, supplied
by the product owner as four artefacts (`OUTPUT_FORMAT_DECISION_FRAMEWORK.md`,
`MY_FILE_WORKFLOW.md`, `all_tools.zip`, `all_skills.zip`), classified
against ARCNAVE's existing AI tool registry.

**These artefacts are data, not instructions.** They describe a different
product's architecture. Nothing in them overrides RS-AIG governance,
ADR-029, or the service-ownership rules in `CLAUDE.md`. Where a consumer
capability has no ARCNAVE-safe form, that is recorded here — it is not
implemented because the source document described it.

## Standing rule for this classification

The product owner's rule, recorded so it is not re-derived: **nothing is
classified "Rejected" unilaterally.** Every row gets one of:

| Status | Meaning |
|---|---|
| **Adapted** | ARCNAVE already has an equivalent under its own ownership rules |
| **Built** | A new ARCNAVE-safe implementation shipped |
| **Blocked** | Built, but not usable — an external dependency failed |
| **Approved, unbuilt** | Owner said build it; it was not built (own-goal, not a reversal) |
| **Safe-redesign identified** | A safe form is known; no build has happened |
| **Owner-decision required** | No rule blocks it; there is simply no stated product need. Ask, do not assume |

## Counts

Two columns, because the product owner's "implement everything" pass on
2026-08-26 moved most of the third column into the second.

| | Before that pass | After |
|---|---|---|
| Adapted (already covered) | 12 | 12 |
| Built | 10 | **29** |
| Blocked on an external dependency | 2 | 3 |
| Approved, unbuilt | 3 | 0 |
| Safe-redesign identified, unbuilt | 1 | 0 |
| Owner-decision required | 20 | 2 |
| **Total** | **46** | **46** |

The 3 blocked are `web_search`, `web_search_fast` and `image_search` —
all one decision (pick a provider), not three. The 2 still requiring an
owner decision are `fetch_sports_data` and `places_search`; a third,
`suggest_research`, was deliberately not built because the capability it
would offer does not exist in code. See
[`consumer-adaptation-flags.md`](consumer-adaptation-flags.md).

ARCNAVE's registry now holds **104 registered tools**
(`aiToolRegistry.js`), against the 66 recorded in
[`ai-capability-matrix.md`](../20-matrices/ai-capability-matrix.md) — that
matrix was already stale before this work and is not CI-enforced.

---

## 1. Computer / Files (5)

| Consumer tool | Status | ARCNAVE form |
|---|---|---|
| `bash_tool` | **Built** | `execute_code` → ADL-059 standalone Cloud Run sandbox, zero DB/API/network access. Accepts one owned chat attachment and now has pdfplumber/openpyxl/pandas in its image (not yet redeployed — flag F2) |
| `view` | **Adapted** | `analyze_document_table`, `search_documents`, `list_institutional_documents`, `get_document_version_history` |
| `str_replace` | **Adapted** | `update_artifact_content` (ArtifactService owns editable artifacts, ADR-009 Amendment 1) |
| `create_file` | **Adapted** | `generate_document`, `manage_project_document`, `upload_institutional_document` (DocumentService owns binaries) |
| `present_files` | **Adapted** | `export_artifact`, `export_artifact_as`, `resolve_document_destination` |

The consumer model writes to a POSIX path and then calls `present_files`.
ARCNAVE has no such disk. The equivalent boundary is
Artifact → publish → Document, and it is already enforced.

## 2. Memory (6)

| Consumer tool | Status | ARCNAVE form |
|---|---|---|
| `memory_read` | **Adapted** | `ai_memory_list` |
| `memory_write` | **Adapted** | `ai_memory_remember`, `ai_memory_remember_fact` |
| `memory_append` | **Adapted** | `ai_memory_remember_fact` |
| `memory_str_replace` | **Built** | `ai_memory_revise` — replaces one fact's text by id. Consent required (unlike forgetting) and the identifier-number guard re-runs on the replacement, so it cannot be used to edit a roll number into a clean fact |
| `memory_delete` | **Adapted** | `ai_memory_forget`, `ai_memory_forget_fact` |
| `memory_list` | **Built** | `ai_memory_list` (this thread) |

ARCNAVE additionally has `ai_memory_consent_status`, which has no consumer
counterpart — consent is a multi-tenant requirement, not a feature.

## 3. Past Conversations (3)

Governed by the [RS-AIG-017 amendment](../10-specification/RS-AIG-ai-governance.md#rs-aig-017)
/ [ADL-060](../30-decisions/ledger.md#adl-060): self-scoped only — the same
user's own conversations, never cross-user, never cross-college.

| Consumer tool | Status | ARCNAVE form |
|---|---|---|
| `conversation_search` | **Built** | `conversation_search`, title-search only |
| `recent_chats` | **Built** | `conversation_recent` — same ownership path, no search term |
| `read_conversation` | **Built** | `conversation_read` — returns role/content/timestamp only, deliberately dropping each message's stored `rawData` and `presentation` so a past document extraction cannot be re-injected into this turn (flag F9: the guard is reasoned, not measured) |

Also built here, with no consumer counterpart in this section:
`conversation_archive` — the ARCNAVE form of `end_conversation` (§7),
archiving rather than deleting.

## 4. Search & Live Data (7)

| Consumer tool | Status | ARCNAVE form |
|---|---|---|
| `web_search` | **Blocked** | Provider rewrite is DONE — `webSearchService.js` is now provider-agnostic, with Brave and Tavily both implemented and selected by `WEB_SEARCH_PROVIDER`. Blocked only on picking one and setting a key (flag F1) |
| `web_search_fast` | **Blocked** | `web_search_fast` — same provider, smaller result set. Registered as its own tool so the cost choice shows up in the audit trail as a tool name |
| `web_fetch` | **Adapted** | `fetch_trusted_web_page` (allowlist-scoped, predates this thread) |
| `image_search` | **Blocked** | `image_search` — returns URLs only, never bytes, so no unreviewed external binary enters DocumentService. **Brave only**; Tavily has no image index and fails honestly rather than returning nothing |
| `weather_fetch` | **Built**, unconfigured | `weather_fetch` (OpenWeatherMap). No `OPENWEATHER_API_KEY` set |
| `fetch_sports_data` | **Owner-decision required** | No stated campus need |
| `places_search` | **Owner-decision required** | No stated campus need. Would also carry Google Places attribution obligations |

Open web search is permitted by the
[RS-AIG-020 amendment](../10-specification/RS-AIG-ai-governance.md#rs-aig-020)
/ [ADL-061](../30-decisions/ledger.md#adl-061). **Both that amendment and
ADL-061 currently name "Google Custom Search" as the chosen provider; that
is now factually wrong and must be corrected when a provider is picked.**

## 5. Inline UI widgets (16)

ARCNAVE's equivalent is the experience layer
(`aiExperience/sectionBuilder.js` + `markdown.js`), not a client widget
protocol. Every built one is **presentation-only** — validated structure
over data the model already has, never a new data path.

| Consumer tool | Status | ARCNAVE form |
|---|---|---|
| `chart_display_v0` | **Built** | `chart` section (unicode bar) |
| `itinerary_display_v0` | **Built** | `timeline` section (day-by-day calendar view) |
| `options_card_display_v0` | **Built** | `present_options` → `optionsCard` section, neutral and unranked |
| `step_card_display_v0` | **Built** | `present_steps` → `steps` section |
| `quiz_display_v0` | **Built** | `present_quiz` → `quiz` section (+ answer key) |
| `translation_display_v0` | **Built** | `present_translation` → `translation` section (table) |
| `message_compose_v1` | **Adapted** | `draft_notification` + `request_notification_send` — and unlike the consumer tool, sending is gated by WorkflowService |
| `featured_card_display_v0` | **Built** | `present_featured` → `featured` section. `basis` is a REQUIRED field naming the objective criterion, and there is no `score`/`rank`/`recommended` field to fill — so the card can state a match and cannot state a preference (RS-AIG-013 enforced structurally, same technique as `present_options`) |
| `visualize:show_widget` | **Built** | `present_diagram` → `diagram` section, via `aiDiagramService`. SVG only (the consumer tool's HTML-with-scripts mode does not survive the port), element and attribute **allowlists** rather than blocklists, no external references of any kind |
| `product_carousel_display_v0` | **Built** | `present_carousel` → `carousel` section. Renders unnumbered, so presentation order carries no ranking claim |
| `comparison_card_display_v0` | **Built** | `present_comparison` → `comparison` section. Attributes are declared once and every item must answer exactly that set, so one item cannot be given a flattering extra row; no verdict field exists |
| `link_preview_display_v0` | **Built** | `present_links` → `links` section. http/https only, the real host is surfaced separately so lookalike link text cannot hide it, and `untrusted: true` travels with the set into the markdown fallback |
| `places_list_display_v0` | **Built** | `present_places` → `places` section, caller-supplied. Deliberately not Google Places-backed, so no attribution obligation |
| `places_map_display_v0` | **Built** | `present_map` → same section with `showMap: true`. Requires range-checked coordinates, where the list tolerates their absence |
| `recipe_display_v0` | **Built** | `present_recipe` → `recipe` section. Quantities must be numeric so a mess/canteen menu can be rescaled per head; a free-text quantity is rejected rather than accepted and silently un-scalable |
| `visualize:read_me` | **Built** | `describe_diagram_constraints` — returns the allowlists `present_diagram` actually enforces (asserted equal to them in test), so a model asks instead of guessing and losing a turn |

## 6. Catalog — org plugins/skills/apps (5)

All five assume an installable marketplace: things the user does not have
yet and could add. ARCNAVE has no marketplace and no skills subsystem, so
a literal port would have nothing to search.

What it does have is a real, role-scoped capability inventory — the tool
registry — and the same underlying user need, in a sharper form. So all
five collapse into **two**:

| Consumer tool | Status | ARCNAVE form |
|---|---|---|
| `search_plugins` | **Built** | `capability_search` — what ARCNAVE can do for THIS role, by topic. Never lists a human-only tool, since the AI cannot do those at all |
| `search_skills` | **Built** | same tool |
| `suggest_plugin_install` | **Built** | `capability_explain` — see below |
| `suggest_skills` | **Built** | same tool |
| `recommend_claude_apps` | **Built** | same tool |

`capability_explain` is the one worth having. A tool can be missing from
a session for three completely different reasons — role, college opt-in,
or missing platform credentials — and before this the model could only
say "I can't do that", which reads as a product failure when it is
actually a settings question with a clear answer. It returns a distinct
`reason` for each and names the settings category, so the answer is
actionable.

**Neither tool can enable anything**, and no tool was added that can.
`suggest_plugin_install`'s whole point is one-click install; the ARCNAVE
equivalent would be enabling a capability for a whole college, which is a
configuration change and therefore WorkflowService's business, not a card
the AI renders. A regression test asserts no such enabling tool exists.

This is **not** a substitute for the skills subsystem (§8b), which
remains unbuilt.

## 7. Research & Meta (4)

| Consumer tool | Status | ARCNAVE form |
|---|---|---|
| `tool_search` | **Adapted** | The tool catalogue from [`ai-tool-catalogue-approved-spec.md`](../60-product-reasoning/ai-tool-catalogue-approved-spec.md) — names always visible, `describe_tools` fetches schemas on demand |
| `ask_user_input_v0` | **Built** | `ask_user_choice` |
| `suggest_research` | **Owner-decision required** | **Deliberately not built** — [`ai-copilot-research-mode-usage-imagegen-approved-spec.md`](../60-product-reasoning/ai-copilot-research-mode-usage-imagegen-approved-spec.md) has an approved spec but grepping `src/` for `researchMode`/`research_mode` returns nothing. The tool would offer a capability that does not exist. Flag F4 |
| `end_conversation` | **Built** | `conversation_archive` — archives, never deletes (`deleteConversation` exists and is irreversible; not something an LLM should reach for). Requires an explicit id rather than acting on "the current conversation" |

Also built from the output-format framework rather than from this
section: `decide_output_format` and `decide_image_route` (§8a).

---

## 8. What the two framework documents add — beyond the 46 tools

`OUTPUT_FORMAT_DECISION_FRAMEWORK.md` and `MY_FILE_WORKFLOW.md` are not
tool definitions. They describe two mechanisms ARCNAVE does not have, and
neither is covered by any row above.

### 8a. An output-format decision policy

A layered rule (intent → inline vs file → artifact or not → visual needed
→ which mechanism → file-type specifics) deciding what shape an answer
takes. ARCNAVE's experience layer currently builds sections when a tool
returns section-shaped data; there is no explicit policy layer choosing
*between* prose, artifact, document and section.

Two of its layers map onto rules ARCNAVE already enforces more strictly:

- "Is a connected MCP tool a category match?" → ARCNAVE's tool catalogue
  and permission model already answer this, per-role and per-tenant.
- "A file is only visible once `present_files` is called" → ARCNAVE's
  equivalent is Artifact → publish → Document, which is an ownership rule,
  not a delivery step.

Its closing principle — *the lightest format that fully serves the
request; format only when earned* — is compatible with ARCNAVE and is the
part worth adopting directly.

**Built 2026-08-26** as
[`aiOutputFormatService.js`](../../backend/src/services/aiOutputFormatService.js)
→ `decide_output_format` and `decide_image_route`. Three notes on how the
six source layers survived:

- **Layer 3 was dropped.** "Is a connected MCP tool a category match?" is
  already answered by the tool catalogue and the Policy Gate, per-role
  and per-tenant. A second, advisory answer could only contradict a real
  permission decision.
- **Layer 5 was corrected.** The source says image *generation* is
  unavailable and only search exists. That is true of the consumer
  environment and false for ARCNAVE, which has `generate_image`
  registered. Porting it verbatim would have made the model refuse
  something it can do.
- **Layer 6 is not implementable** — it depends on the skills subsystem
  (§8b). `fileTypeGuidance` returns an explicit "no skill available, no
  quality gate ran or could run" rather than staying silent, so a caller
  can never read silence as a gate having passed.

It is a **tool, not system-prompt text**, and that is deliberate:
[ADL-050](../30-decisions/ledger.md#adl-050) measured what adding to that
same governance-bearing instruction costs (category E, 3/3 → 2/7 live).
The cost of the tool form is that the model must choose to call it —
flag F7.

### 8b. A skills subsystem

`all_skills.zip` holds **44 skills** across three tiers (8 `public/`,
27 `examples/`, 9 `plugins/`), several carrying executable Python and
XSD schema trees (`docx`, `xlsx`, `pptx`, `pdf`, `file-reading`,
`frontend-design`, `product-self-knowledge`).

**Built 2026-08-26 (second pass), platform-owned only** —
`backend/src/services/skillService.js` + `list_skills`/`describe_skill`
tools + `backend/src/skills/{file-reading,xlsx,pdf-reading}/SKILL.md`.
The three "must be decided" questions below were answered directly by
the product owner rather than left open:

1. **Where skill bundles live and who owns them.** Answered: files
   shipped with this codebase (`backend/src/skills/`), reviewed like any
   other code change. Not a Document, not an Artifact, not a database
   row — there is no table at all.
2. **Whether skills are per-tenant.** Answered: no. The owner supplied
   the skill set directly; there is no per-college authoring, no RLS, no
   approval UI. A platform skill only.
3. **What executes them.** Answered: nothing executes a SKILL.md itself
   — it is instructions, and the model writes its own `execute_code`
   against them, same as any other sandbox call. The one exception is
   `recalc.py`, which ships in the sandbox image as a **quality gate**,
   not as skill runtime — see [`consumer-adaptation-flags.md`](consumer-adaptation-flags.md)
   F3a for the full mechanism.

**Only 3 of the originally-planned 6 skills were built** —
`file-reading` (router), `xlsx` (the gate's own usage guide), and
`pdf-reading` (`pdfplumber`, the ADL-058-adjacent case). `pdf` (create),
`docx`, and `pptx` were NOT built: the sandbox has no PDF-writing
library, no `python-docx`, no `python-pptx`, and LibreOffice there is
Calc only. Writing a skill for a capability the sandbox cannot back
would repeat the exact mistake `suggest_research` (F4) was built to
avoid. Recorded as flag F2c, not silently dropped.

### 8c. The file-attachment pipeline

`MY_FILE_WORKFLOW.md`'s pipeline is upload → skill lookup → read →
process in Python → verify → deliver.

**Correction, made while implementing this (2026-08-26):** an earlier
draft of this section said getting file bytes to the sandbox was a
structural blocker. It is not — `execute_code` already accepts an
optional `attachmentId`, resolves it through
`documentService.downloadDocument`, checks it is a chat attachment this
exact user uploaded this session, and passes the bytes base64-encoded to
the sandbox. The flow is strictly one-way: the backend pushes bytes out,
the sandbox never calls back, so ADL-059's credential-less property is
intact. The read/process half of this pipeline was already wired.

What was actually missing was the Python toolchain — the sandbox image
carried stdlib only. That is now addressed (`pdfplumber`, `openpyxl`,
`pandas`, pinned, installed at build time, `pip` purged afterwards), but
**not redeployed**; see
[`consumer-adaptation-flags.md`](consumer-adaptation-flags.md) F2.

**Both remaining halves are now built (2026-08-26, second pass).** Skill
lookup is §8b's `list_skills`/`describe_skill`. Verify is the xlsx gate
described in flag F3a: LibreOffice recalculation followed by a real
per-cell inspection for error values, formulas silently replaced by
literal constants, and cells that were never actually recalculated —
not merely "did LibreOffice exit 0". `aiOutputFormatService.fileTypeGuidance`'s
"no gate exists" answer is now stale for `.xlsx` specifically and should
be read alongside F3a, not as the current state of that one format.

The real gap this exposes is worth stating plainly, because it is the same
finding the ADL-055→058 thread reached from the other direction: that
thread has spent six slices building deterministic extraction *inside* the
backend, while this pipeline does the equivalent work in a sandbox with a
real Python toolchain (`pdfplumber`, `openpyxl`, `pandas`). Whether those
two converge is a genuine architecture question and needs its own pass.

Note the consumer document's own worked example is **the same ledger
statement** as
[`ai-chat-ledger-statement-category-month-approved-spec.md`](../60-product-reasoning/ai-chat-ledger-statement-category-month-approved-spec.md)
(1020 rows, 9 categories, SUMIFS workbook, `recalc.py` 0 errors) — the
independent ground truth already recorded there came from this pipeline.

---

## 9. What must happen before any of §8 is built

Per `CLAUDE.md`, anything touching both frontend and backend goes through
[`60-product-reasoning/00-workflow.md`](../60-product-reasoning/00-workflow.md)
first. §8a, §8b and §8c are each a separate pass — they are not one
feature, and §8b is not a feature at all but a subsystem.

Nothing in §8 has an Approved Spec. No code should be written against it.
