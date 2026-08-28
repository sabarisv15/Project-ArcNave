# Tools To Build — ARCNAVE Confirmed Set

**Reconciled against the real `aiToolRegistry.js` on 2026-08-28.** The
package shipped this as a greenfield checklist; ARCNAVE is not
greenfield, so most of it is already done. Every line below states what
actually exists rather than what a new build would need.

Owner's framing for this set (2026-08-28): the split that matters is
**tools that need an external API** vs. **tools we build ourselves**.
Only `web_search` uses an external API, and it uses **Gemini** — every
other API-dependent tool is dropped.

---

## Search — the one external API

**`web_search` / `web_fetch`** → Gemini search-grounding.

✅ **Built.** `web_search` is registered, and `webSearchService.js` has a
`gemini` provider. **Not live-checked** — needs
`GEMINI_WEB_SEARCH_API_KEY` and a per-college opt-in. Until then it is
verified code, not a verified capability.

---

## Already built — nothing to do

| Package item | ARCNAVE tool |
|---|---|
| `memory_read`, `memory_write`, `memory_append`, `memory_str_replace`, `memory_delete`, `memory_list` | `ai_memory_*` family, incl. `ai_memory_list` |
| `conversation_search`, `recent_chats`, `read_conversation` | `conversation_search` (title-search only — see "Still open" below) |
| `ask_user_input_v0` | `ask_user_choice` |
| `visualize:read_me`, `visualize:show_widget` | `present_diagram` + `describe_diagram_constraints` |
| `chart_display_v0` | `buildChart` section (unicode bar, `markdown.js`) |
| `options_card_display_v0` | `present_options` |
| `step_card_display_v0` | `present_steps` |
| `quiz_display_v0` | `present_quiz` |
| `translation_display_v0` | `present_translation` |
| `itinerary_display_v0` | `buildTimeline` section |
| `tool_search` | The tool catalogue + `describe_tools` (lazy schemas) |
| `bash_tool` | `execute_code` (credential-less sandbox) |

## Dropped — do not build

| Package item | Why |
|---|---|
| `comparison_card_display_v0`, `featured_card_display_v0`, `product_carousel_display_v0`, `places_list_display_v0`, `places_map_display_v0`, `link_preview_display_v0`, `recipe_display_v0`, `message_compose_v1` | Consumer-shopping and travel widgets. The package's own prose says to drop these even while its headline count includes them — so the real number was never 32. |
| `places_search`, `weather_fetch`, `fetch_sports_data` | Each needs its own external API, and the owner's rule is Gemini-for-search only. `weatherService.js` exists in code but is not wired and is not being pursued. |
| The 6 vendor-platform tools (plugin/skill catalogs, app recommendations, autonomous research) | Not applicable outside the vendor's own app. |
| `end_conversation` | A UI-level signal. The backend just stops responding. |
| `view`, `str_replace`, `create_file`, `present_files` | **Conflicts with a standing architecture rule.** `CLAUDE.md` rule 2: `DocumentService` is the sole owner of persistent binary storage and `ArtifactService` owns structured artifacts. A generic file-CRUD tool surface cuts across that boundary. ARCNAVE's narrower equivalent already exists: `execute_code`'s `saveAs`/`expectFormulasIn` → `artifactService.attachGeneratedFile` → `documentService.uploadPersonalDocument`. |

## Still open

- **`recent_chats` / `read_conversation`** — ADL-060 permits self-scoped
  conversation retrieval; only title-search was built. These two are the
  genuine remainder of that decision.
- **`web_search` live check** — key, opt-in, one real grounded call.
