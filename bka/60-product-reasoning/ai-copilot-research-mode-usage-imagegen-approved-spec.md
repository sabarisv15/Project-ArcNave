# Approved Spec — AI Copilot: Research-mode rename, provider-aware history budget, visible token usage, opt-in image generation

**Scope mode:** Feature (existing page — AI Copilot chat; no prior page-contract
exists for this page, so this spec stands in as source C for the four items
below, per `00-workflow.md` §3 0b — the page's real behavior is already
extensively documented across `CHECKPOINT.md` rounds 13–30, treated here as
the existing-product baseline rather than re-derived from scratch).

**Requested by:** user, 2026-08-22, via a compressed Tanglish note, resolved
through 3 rounds of `AskUserQuestion` clarification (see Decision Ledger
[ADL-045](../30-decisions/ledger.md#adl-045)).

---

## Page

AI Copilot chat (`frontend/src/store/WorkspaceProvider.jsx`,
`frontend/src/components/ChatMessage.jsx`, `AIComposer.jsx`,
`ScopeToggle.jsx`). Backend: `backend/src/routes/ai.js`,
`backend/src/services/aiService.js`, `aiToolRegistry.js`.

## Purpose

Bring the AI Copilot chat closer to a Claude-Code-style chat experience on
four specific axes the user named, without regressing anything already
built (attachments stay exactly as-is — explicitly confirmed, not in scope
here).

## Role

All roles with AI Copilot access, unchanged.

## Features

1. **CORE — Rename "General" mode's user-facing label to "Research".**
   Cosmetic only. The wire-level `mode` parameter value stays the literal
   string `'general'` everywhere (routes, service, frontend state) — only
   the label a human reads changes. Resolves automatically (workflow §15
   step 5, cosmetic-only) except for the RS-AIG-023 terminology itself,
   which names the mode in prose and is amended alongside this (see
   [ADL-045](../30-decisions/ledger.md#adl-045)).

2. **CORE — Provider-aware conversation history budget.** Replace the flat
   `HISTORY_LIMIT = 20` message-count cap (`routes/ai.js:40`) with a
   char/token-budget-aware window, mirroring the existing
   `ATTACHMENT_BUDGET_BY_PROVIDER` pattern (`aiService.js` ~574-587,
   established round 27). A large-context provider (e.g. Gemini, 1M-token
   window) keeps substantially more prior conversation than a small-window
   provider. RS-AIG-017 stays intact as a system invariant — "bounded,
   per-conversation, never persistent cross-session" is unchanged; only the
   specific numeric bound becomes provider-derived instead of a flat 20.

3. **CORE — Visible per-message token/usage display.** Today usage is
   captured only for the non-streaming path, into `audit_log` metadata,
   invisible to the frontend (`aiService.js:1308-1318`'s own comment marks
   the streaming gap as deliberately deferred, not an oversight). This
   closes that gap: real per-vendor streaming usage capture
   (OpenAI-compatible `stream_options.include_usage` for
   nim/openai/self_hosted; Claude's `message_delta` usage event; Gemini's
   final-chunk `usageMetadata`), persisted on the assistant `messages` row
   (new nullable `input_tokens`/`output_tokens` columns), rendered as a
   small, unobtrusive line on the message — matching Claude Code's own
   understated usage indicator, never a prominent dollar-cost figure ($
   estimation stays explicitly out of scope, same reasoning `aiService.js`
   already recorded: pricing drifts faster than this codebase should
   hardcode).

4. **CORE — New opt-in image-generation capability.** A new AI tool,
   `generate_image`, classified `L2` (Generate — RS-AIG-001's existing
   ceiling for artifact-producing tools with no external effect), following
   the exact registration shape `generate_document` already uses
   (`aiToolRegistry.js:2764-2794`). Per-college opt-in, mirroring
   `webRetrievalService.js`'s existing `configurationService` pattern
   exactly (new `CONFIG_CATEGORY = 'image_generation'`, reusing the
   existing generic `configurations` table — no new migration for the
   opt-in flag itself), the same established pattern RS-AIG-020 already
   uses for a costly/abusable capability. Provider-limited: only adapters
   with a real image-generation API get a `generateImage` method (OpenAI,
   Gemini at launch); Claude/NIM/self-hosted raise the existing
   `AiProviderCapabilityError` the same way `claude.js` already does for
   `embed()`. Generated binary stored via `documentService.uploadPersonalDocument`
   (same call `generate_document`'s handler already makes indirectly via
   `artifactService.publishArtifact`), never a new storage path — CLAUDE.md
   rule 2 compliance. New `RS-AIG-025` rule +
   [ADL-046](../30-decisions/ledger.md#adl-046) (the domain's own governing
   principle requires this: "If a new AI capability is proposed and it is
   not obviously covered by this domain, it is not built until it is.").

## User flows

- **Research/Curriculum toggle**: unchanged flow, label only differs.
- **Long conversation**: unchanged flow; more prior turns are visible to
  the model on a large-context provider, same UI.
- **Token usage**: appears automatically under each assistant message once
  usage is known (post-stream-completion) — no user action required.
- **Image generation**: user asks for an image in chat (Research or
  Curriculum mode — the tool itself carries no institutional-data access,
  so it is offered in both once the college has opted in) → model proposes
  `generate_image` (L2, no approval gate, same as `generate_document`) →
  image generated → stored as a personal document → rendered inline in the
  chat message with a download affordance, same pattern as
  `DocumentAttachmentCard`.

## UI components

- `ScopeToggle.jsx` — label text only (`LABEL.general`).
- `ChatMessage.jsx` — new small usage line (existing collapsed-line pattern
  `EvidenceTrail`/`VerificationNotice` already establish); new
  `GeneratedImageCard` (inline `<img>` + download, mirrors
  `DocumentAttachmentCard` plus the existing user-attachment `<img>`
  preview pattern at `ChatMessage.jsx:399-405`).

## Permissions

No change to authority levels for existing tools. `generate_image` is `L2`
(no approval required — RS-AIG-001), same-actor-scoped, gated only by the
new per-college opt-in flag (off by default, mirroring RS-AIG-020's
off-by-default posture for a new, costly, potentially-abusable capability).

## API contracts

- No new routes for the rename or history-budget items (internal-only
  changes).
- Token usage: exposed as new fields on the existing message object
  returned by conversation read endpoints (`inputTokens`/`outputTokens`,
  nullable) — no new endpoint.
- Image generation: no new route — reachable only via the existing
  `POST /api/v1/ai/ask`(`/stream`) tool-invocation path, same as every
  other AI tool. College opt-in read/write reuses the existing
  configuration endpoints (`configurationService`), consistent with how
  Trusted Web Retrieval's own allowlist is already administered.

## Data dependencies

- New migration: `messages.input_tokens` / `messages.output_tokens`
  (nullable `integer`), reversible up/down, additive only — mirrors round
  29's `messages.attachments` JSONB precedent.
- No new migration for image-generation opt-in (reuses `configurations`
  table via `configurationService`, same as Trusted Web Retrieval).
- No migration for the rename or history-budget items.

## States

- Token usage: absent (older messages, or a provider/path where usage
  genuinely isn't known) renders nothing — never a fabricated placeholder
  number.
- Image generation: college not opted in → tool absent from the offered
  list (same mechanism Trusted Web Retrieval already uses, not a runtime
  error); provider doesn't support it → `AiProviderCapabilityError` surfaced
  as a plain "this AI provider doesn't support image generation" chat
  message, same shape as any other tool-unavailable case.

## Validation

`generate_image`'s params schema: `prompt` (required, non-empty, capped
length — mirrors `generate_document`'s existing param validation
discipline), no other free-form fields (RS-AIG-002: no business logic
inside the tool wrapper).

## Edge cases

- Streaming interrupted mid-response (client disconnect): usage capture is
  best-effort — if the final usage-bearing chunk never arrives, no usage is
  persisted for that message (falls into the "absent" state above, not an
  error).
- A provider mid-migration between "supports images" and "doesn't" (e.g. a
  future adapter add) — governed structurally by whether `generateImage`
  exists on the adapter object, no hardcoded provider-name branch anywhere
  outside `aiProviders/`.
- College opts out of image generation after some images already exist —
  existing generated images/documents are untouched (opt-in only gates new
  generation, not already-stored documents), consistent with how disabling
  Trusted Web Retrieval doesn't retroactively affect prior fetches.

## Testing requirements

- Unit: history-budget provider-keyed selection (mirrors existing
  attachment-budget test shape); streaming usage parsing per adapter
  (5 adapters); `generate_image` tool registration/handler (mirrors
  `generate_document`'s existing test); per-college opt-in gating
  (mirrors Trusted Web Retrieval's existing test shape).
- Structural: a hostile prompt cannot force `generate_image` to run for a
  college that hasn't opted in (mirrors the existing Trusted Web Retrieval
  structural test).
- Live verification: mode label renders "Research"; a long conversation on
  the Gemini-backed dev sandbox default actually retains more history than
  the old 20-message cap; a real assistant message shows a token count;
  a real `generate_image` call (Gemini, this sandbox's real provider)
  produces a downloadable, inline-previewed image.

## OUT OF SCOPE

| Item | Classification | Notes |
|---|---|---|
| Dollar-cost estimation alongside token counts | `FUTURE` | `aiService.js`'s own existing comment already defers this; pricing tables drift too fast to hardcode now. |
| Image generation on NIM/Claude/self-hosted adapters | `EXISTING CAPABILITY / RELATED / UNWIRED` once a real vendor API exists for them | Not built until a real, configured vendor image API exists for that adapter — no speculative stub. |
| Editing/regenerating an already-generated image (inpainting, variations) | `RELATED / FUTURE` | Directly adjacent to `generate_image` but not requested. |
| Per-message usage exposed via a dedicated `/ai/usage` reporting endpoint or admin dashboard | `FUTURE` | The ask was a chat-message-level display, not a billing dashboard. |
| Streaming usage capture backfilled onto historical messages sent before this change | `FUTURE` | Only new messages after this ships carry usage; no backfill job. |
| Increasing `ATTACHMENT_TOTAL_CHAR_BUDGET` itself | `FUTURE` | Out of scope — this spec only extends the *same pattern* to conversation history, doesn't touch the existing attachment budget values. |
