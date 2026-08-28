# Tools To Build — ARCNAVE Confirmed Set

Not the full 46-tool general list — this is the filtered set actually
decided on for this build. See `AI_OPERATING_INSTRUCTIONS.md` Section 1
for the full reasoning; this file is the implementation checklist.

---

## Search — not built from scratch

**`web_search` / `web_fetch`** → implemented via **Gemini API's built-in
search-grounding**, not a custom pipeline. One integration, not two tools.

---

## 32 tools to build, grouped by backend surface

### File operations (4) — your own storage layer
- `view` — read a file's content
- `str_replace` — edit an existing file in place
- `create_file` — write a new file
- `present_files` — mark a file as delivered/visible to the requesting user

*Backend need: your own file storage (local disk / S3 / equivalent) +
delivery mechanism to your frontend.*

### Memory (6) — your own database
- `memory_read`, `memory_write`, `memory_append`, `memory_str_replace`,
  `memory_delete`, `memory_list`

*Backend need: a database table keyed by user/tenant, with the read/write/
delete operations above as your own internal API.*

### Past-conversation retrieval (3) — your own conversation log
- `conversation_search`, `recent_chats`, `read_conversation`

*Backend need: a conversation-log table, tenant-scoped, with a search
index if `conversation_search` needs to be fast at scale.*

### UI widgets (14) — your own frontend rendering
- `chart_display_v0`, `comparison_card_display_v0`,
  `featured_card_display_v0`, `product_carousel_display_v0`,
  `itinerary_display_v0`, `places_list_display_v0`,
  `places_map_display_v0`, `link_preview_display_v0`,
  `options_card_display_v0`, `step_card_display_v0`, `quiz_display_v0`,
  `recipe_display_v0`, `translation_display_v0`, `message_compose_v1`

*Backend need: none — these are just structured JSON shapes the model
returns. Your frontend renders them. Most of these (recipe, itinerary,
places, quiz, translation) are almost certainly irrelevant to ARCNAVE's
domain — keep only `chart_display_v0` and maybe a generic
`comparison`/`options`-style card for reports, drop the rest.*

### Visualizer / diagram rendering (2) — your own frontend
- `visualize:read_me` (setup/config step), `visualize:show_widget`
  (renders SVG/HTML)

*Backend need: none — model outputs SVG/HTML, your frontend renders it.*

### Clarification prompt (1) — your own frontend
- `ask_user_input_v0`

*Backend need: none — a structured-choice UI component (buttons/dropdown)
in your own frontend.*

### Session mechanics (2) — your own backend logic
- `tool_search` — only needed if you have enough tools that lazy-loading
  matters; for this build's small confirmed set, likely unnecessary
- `end_conversation` — just stop responding / close the session flag; no
  special tool call needed in your own backend

---

## Explicitly dropped for this build (not included above)

- All 6 vendor-platform-only tools (plugin/skill catalogs, app
  recommendations, autonomous research)
- `places_search`, `weather_fetch`, `fetch_sports_data`, `image_search` —
  each needs a separate external API and none are relevant to a
  college-management domain

## Build priority, if sequencing matters

1. **File operations + Memory** — nothing else works without these
2. **Verification tied to each skill** (Section 3.3 of the instructions
   file) — do this alongside file operations, not after
3. **Past-conversation retrieval** — only once multi-session context
   actually matters for your rollout
4. **UI widgets** — start with just `chart_display_v0`; add others only
   when a real screen needs them
5. **Clarification prompt + session mechanics** — small, low-risk, build
   whenever convenient
