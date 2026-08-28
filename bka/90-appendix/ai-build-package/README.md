# ARCNAVE AI Build Package

## What's in this package

```
AI_OPERATING_INSTRUCTIONS.md   ← Start here. The full reference: tool/skill
                                  selection, output-format rules, file
                                  pipeline, safety rules, this build's
                                  confirmed config, and why skills matter.

skills/                        ← The 6 confirmed skill folders, copied in
  pdf/                            full (SKILL.md + any scripts/references
  pdf-reading/                    each one ships with) — not just the
  xlsx/                           instructions file, the actual working
  docx/                           folders.
  file-reading/
  pptx/

tools/
  TOOLS_TO_BUILD.md            ← The 32-tool implementation checklist,
                                  filtered to this build's confirmed set,
                                  grouped by backend surface, with a
                                  suggested build order.
```

## How to use this

1. Read `AI_OPERATING_INSTRUCTIONS.md` in full once — it's the source of
   truth every other file in here refers back to.
2. Adapt each `skills/*/SKILL.md` into your own skill-loading system —
   the format (frontmatter + procedure + gotchas + verification) is
   described in Section 4 of the instructions file.
3. Work through `tools/TOOLS_TO_BUILD.md` in the suggested build order —
   file operations and memory first, everything else after.
4. `web_search` / `web_fetch`: wire up Gemini API's search-grounding
   directly — no separate tool needed for these two.

## What's deliberately not in this package

The other 40+ example/vendor skills and 14 non-relevant tools (consumer
widgets, places/weather/sports data, plugin catalogs) were evaluated and
dropped for this domain — see Section 1 of the instructions file for the
full reasoning if you want to revisit any of those calls later.
