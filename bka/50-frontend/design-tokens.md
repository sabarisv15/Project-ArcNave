# ARCNAVE Visual Design Tokens (final)

> **Superseded 2026-08-07.** Everything below this notice — the
> `--bg-base`/`--header-bg`/`--accent` warm-cream+navy palette, Manrope/
> Space Grotesk fonts, the 14–28px radius convention — was replaced by a
> paper/cream + warm-charcoal palette cloned from Claude/Perplexity/
> Comet's own flat, restrained shell, decided across a full menu-by-menu
> mockup walkthrough (sidebar, Home/Curriculum toggle, every Curriculum
> tab, Projects/Artifacts, Settings/Profile). That walkthrough explicitly
> rejected both this doc's palette and an earlier "AI Workspace" Phase
> 1-4 vision doc before landing on the current direction. The live
> values now live in `frontend/src/index.css`'s `:root` block (see its
> own lineage comment for the full supersession chain) and
> `frontend/tailwind.config.js`; this file is kept for historical
> record only, not as a source of truth. Same "AI and GUI are one
> surface" shell as before (sidebar-driven, prompt-first) — only the
> visual skin changed, not the architecture.
>
> Key differences from below: background is `oklch(0.985 0.006 75)`
> (not the old `--bg-base`), primary/buttons are a muted warm-charcoal
> `oklch(0.35 0.03 60)` (deliberately not Anthropic's clay/orange, for
> brand ownership), an indigo `oklch(0.46 0.15 275)` is reserved for
> links/focus/info tags only, fonts are Inter (chrome) + Source Serif 4
> (AI-voice content, via `--font-voice`), and there is no separate
> `--header-bg` — full pages are sidebar + content only, no top header
> bar, page titles sit directly at the top in the serif voice font.

Source: `D:\arcnave\frontend design base\Pages\` mock set (Students List
mock reviewed 2026-07-30). Shared across all 37 page mocks — extract
once here, reuse per page instead of re-deriving from each mock.

## Fonts
- Body: **Manrope**
- Display (logo, page titles, modal names): **Space Grotesk**
- Both via Google Fonts.

## Color tokens (OKLCH)
| Token | Value | Use |
|---|---|---|
| `--bg-base` | `oklch(0.93 0.006 60)` | page background, warm light gray |
| `--bg-surface` | `oklch(0.98 0.003 80)` | card/table surface |
| `--header-bg` | `#030F33` | top header bar |
| `--accent` | `oklch(0.38 0.07 250)` | links, primary buttons, active-filter chips; 8% alpha for tinted backgrounds |
| `--text-primary` | `oklch(0.24 0.02 60)` | |
| `--text-muted` | `oklch(0.55 0.015 60)` | |
| `--pill-bg` | `oklch(0.94 0.006 60)` | fee/status pill background |
| `--status-amber` | `oklch(0.62 0.13 75)` | due / results-pending |
| `--status-green` | `oklch(0.5 0.1 155)` | paid / good attendance / good CGPA |
| `--status-red` | `oklch(0.5 0.16 25)` | overdue / suspended / low attendance / backlogs |
| `--text-gray-500` | `oklch(0.45 0.02 60)` | plain-text status (Active) |

Fee/status pills: fully rounded (20px radius), padding `3px 9px`, font
11px/600. Plain-text statuses (Active/Suspended, Academic Status) carry
no pill — color + weight only, 12px/700 for academic status.

Attendance mini-bar: track `oklch(0.89 0.008 60)`; fill red below ~70%,
green at/above; trend arrow (↑↓↔) colored independently of the bar.

## Radius convention
- Buttons/inputs: 14px
- Cards/popovers/chips: 16–20px
- Badges/pills: fully rounded (20px)
- Modals: 28px

## Shadows
- Card: `0 2px 14px oklch(0.2 0.02 60 / 0.07)`
- Modal: `0 30px 70px oklch(0.2 0.02 60 / 0.35)`

## Layout conventions
- Sticky header: 3-col grid (logo | scroll-fade title | user block), `padding: 14px 32px`, full-bleed `--header-bg`.
- Content column: `max-width: 1520px`, `padding: 32px 40px 24px`.
- Page title row: title (Space Grotesk 30px/800) + primary action pill button, space-between.

## Status quo per this rule set
- **Design tokens above are final** — do not re-derive per page.
- **Architecture rules in `CLAUDE.md` still win over any visual/UX choice** — a token or layout never justifies bypassing Business Services, WorkflowService approval gates, or any other non-negotiable rule.
- Per-page structural decisions (filters, row actions, modals vs. navigation, pagination, avatars) are decided per page against real backend data — not assumed from this token doc.
