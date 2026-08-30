---
name: pptx
description: "Use this skill any time a .pptx or .potx file is involved in any way — as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from any .pptx or .potx file (even if the extracted content will be used elsewhere, like in an email or summary); editing, modifying, or updating existing presentations; combining or splitting slide files; working with templates (.potx), layouts, speaker notes, or comments. Trigger whenever the user mentions \"deck,\" \"slides,\" \"presentation,\" or references a .pptx or .potx filename, regardless of what they plan to do with the content afterward. If a .pptx or .potx file needs to be opened, created, or touched, use this skill."
license: Proprietary. LICENSE.txt has complete terms
---

## ARCNAVE sandbox note — read this before any `soffice` call

Verified live on the deployed sandbox, 2026-08-28.

`soffice` **exits 77 and converts nothing** unless you give it a
writable profile directory. The container runs as a non-root user with
no writable HOME, so LibreOffice cannot create its default profile. It
does not fail loudly — it exits non-zero having written no output, and
if a file of the target name already exists from an earlier step you
will conclude it worked.

Always pass `-env:UserInstallation`:

```python
prof = os.path.join(os.getcwd(), "lo-profile")
subprocess.run([
    "soffice", "--headless", "--norestore", "--invisible",
    f"-env:UserInstallation=file://{prof}",
    "--convert-to", "pdf", "--outdir", "out", src,
], capture_output=True, timeout=180)
```

Then **check the output file exists** — never trust the exit code alone.
`scripts/office/soffice.py`'s `run_soffice()` already does this (it
generates its own profile dir when you don't pass one) — prefer
importing it over reimplementing the subprocess call above by hand.

## This sandbox's real toolset — read before following any other pptx guide

This is a Python-only sandbox (`execute_code`) — no `npm`/Node, no
`pandoc`, no `markitdown`, no network access to install anything at
request time. **`python-pptx` is the only library for `.pptx` here.**
If you have seen pptx guidance elsewhere (including generic examples
built around the `pptxgenjs` npm package, `pandoc`, or `markitdown`) —
none of that runs in this sandbox. Everything below uses only what
`sandbox-service/Dockerfile` actually installs: `python-pptx`, plus
LibreOffice (`soffice`, Impress included) for rendering/verification.

Of this skill's bundled `scripts/`, only two are genuinely usable here
(pure Python + stdlib, no missing dependency):

- `scripts/office/soffice.py` — `run_soffice()`, the LibreOffice
  wrapper above.
- `scripts/add_slide.py` — duplicates a slide (or a `slideLayoutN.xml`)
  with full package bookkeeping. Genuinely needed: `python-pptx`'s own
  API has no slide-duplication entry point at all (see Limitations
  below), so this is the only way to do it.

`scripts/clean.py`, `scripts/thumbnail.py`, and `office/validate.py`
(plus everything under `office/validators/`) import `defusedxml`,
which is **not installed** in this sandbox — running any of them
raises `ModuleNotFoundError`. `thumbnail.py` additionally imports
`PIL` (Pillow), also not installed. Don't invoke any of the three.
Where this file used to lean on one of them, it now gives you the
direct `python-pptx` (or plain-rendering) equivalent instead.

# PPTX creation, editing, and analysis

A `.pptx` is a ZIP archive of XML files, but `python-pptx` reads and
writes that archive for you — you should never need to unzip/rezip
one by hand in this sandbox, except via `add_slide.py` for the one
case it exists to cover.

| Task | Approach |
|---|---|
| **Create** a new deck | `python-pptx`'s `Presentation()` — see gotchas below |
| **Edit** an existing deck, or build from a template | `python-pptx`'s `Presentation(path)` — mutate shapes/text frames in place; `scripts/add_slide.py` for duplicating a slide |
| **Read** content | `python-pptx`'s `Presentation(path)`, iterate `.slides`/`.shapes`; visual look: render via `soffice` + `pdftoppm` (see Converting to Images) |

## Scripts

Paths are relative to this skill's directory.

| Script | What it does | Safe here? |
|---|---|---|
| `scripts/office/soffice.py` | LibreOffice wrapper (auto-generates a writable profile dir) | Yes |
| `scripts/add_slide.py unpacked/ slide2.xml [--after slideN.xml]` | Duplicate a slide (or a `slideLayoutN.xml`) with all the package bookkeeping. Also takes a `.pptx` directly with `-o out.pptx` | Yes |
| `scripts/clean.py` | Delete orphaned slides/media/rels | **No** — imports `defusedxml`, not installed |
| `scripts/office/validate.py` | Schema/relationship/content-type/chart checks | **No** — imports `defusedxml`, not installed |
| `scripts/thumbnail.py` | Labeled grid of every slide | **No** — imports `defusedxml` AND `PIL` (Pillow), neither installed |

For the three that don't run here:

- **Instead of `clean.py`** (orphaned parts after deleting slides): this
  sandbox has no automated cleanup. An orphaned media/rels part makes
  the file slightly larger but both PowerPoint and LibreOffice open it
  fine — accept the small bloat rather than hand-editing `[Content_Types].xml`.
- **Instead of `office/validate.py`** (schema/structural validation):
  there is no schema validator available here. Use two weaker but real
  checks instead — (1) `Presentation(out_path)` must reopen without
  raising right after you save, and (2) `soffice --convert-to pdf` must
  exit 0 and produce a non-empty PDF. Neither catches everything
  `validate.py` would, so lean harder on Visual QA (below) than you
  otherwise would.
- **Instead of `thumbnail.py`** (a labeled grid image): render normally
  via `soffice --convert-to pdf` + `pdftoppm` (see Converting to
  Images) and look at the individual numbered slide images — slower to
  scan than one grid, but the same information.

## Creating with python-pptx — gotchas

The model knows the API; these are the footguns already caught on in
this project or well-documented upstream:

- **Default slide size is 4:3 (10" × 7.5"), not 16:9.** Set both before
  adding slides: `prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)`
  for 16:9. Coordinates past the edge are written, not clamped — the
  shape just isn't on the slide.
- **Colors:** `RGBColor(0xFF, 0x00, 0x00)` or `RGBColor.from_string("FF0000")`
  — never `#`, and there is no alpha/transparency channel on a solid
  fill at all through the object model (unlike some JS libraries' hex+alpha
  shortcuts). True transparency needs a raw `<a:alpha>` element under
  the fill's `<a:srgbClr>` — most decks don't need it; say so rather
  than faking it with a lighter shade.
- **`shape.text_frame.text = "..."` collapses to ONE run** and drops
  any formatting you wanted to vary within the text. For anything
  beyond a single uniform run, build it through
  `text_frame.paragraphs[i].add_run()` (add a paragraph with
  `text_frame.add_paragraph()` first if you need a new line).
- **No bullet API.** A text frame's bullet comes from the slide
  layout's placeholder by default. To force or remove one, add raw
  `<a:buChar>`/`<a:buAutoNum>`/`<a:buNone>` under the paragraph's
  `pPr` via the paragraph's own `._pPr`/`.get_or_add_pPr()` — same
  limitation as PowerPoint's own object model has always had.
- **Shadows are effectively read-only** through the high-level API in
  most `python-pptx` versions (they inherit from the theme). Don't
  promise a specific custom shadow (offset/angle/blur) unless you've
  verified your installed version actually exposes a settable shadow
  API — when in doubt, treat shadow styling as a raw-XML
  (`<a:effectLst><a:outerShdw>`) task, not a one-line property set.
- **One `Presentation()` (or `Presentation(template_path)`) per output
  file** — reusing one object across decks carries its slides/masters
  into the next file.
- **`add_textbox(left, top, width, height)`** needs all four dimensions
  explicit (EMU via `Inches`/`Cm`) — there's no separate "is this a
  text box" flag to remember to set (every `python-pptx` textbox shape
  already is one structurally). Set `shape.name` to something
  descriptive for accessibility, since nothing does that automatically.
- **Margins:** `text_frame.margin_left/right/top/bottom` (EMU) — set to
  `Emu(0)` when text must align flush with a shape/line/icon edge.
- **Speaker notes:** `slide.notes_slide.notes_text_frame.text = "..."`
  (accessing `.notes_slide` the first time creates the notes part) —
  never a text box on the slide itself.
- **Charts are native:** `slide.shapes.add_chart(chart_type, x, y, cx, cy, chart_data)`
  with `chart_data` built from `pptx.chart.data.CategoryChartData`, and
  `chart_type` from `pptx.enum.chart.XL_CHART_TYPE` — covers bar/line/
  pie/combo natively. There is no trendline/error-bar API — those need
  raw chart-part XML; don't fall back to a rendered image for a chart
  type `XL_CHART_TYPE` genuinely supports.
- **Default charts render bare** — set a title
  (`chart.has_title = True; chart.chart_title.text_frame.text = "..."`),
  data labels (`plot.has_data_labels = True`), and legend visibility
  (`chart.has_legend`) explicitly; nothing is opinionated by default.
- **After `save()`, round-trip it:** re-open with
  `Presentation(out_path)` (must not raise) and run a real
  `soffice --convert-to pdf` (must exit 0, non-empty PDF) — this
  sandbox has no schema validator, so these two checks plus Visual QA
  are the only signal you have that the file isn't corrupt.
- **Never hand-reorder `<p:presentation>`'s children** if you drop to
  raw XML for anything above. `python-pptx` writes `<p:sldIdLst>` and
  `<p:notesMasterIdLst>` in a specific relative order PowerPoint
  depends on — only ever `.append()` a new child, never rebuild the
  parent element.

## Editing existing decks and templates

Pick layouts first — since `thumbnail.py` doesn't run here, list them
directly and render the template for a visual look:

```python
from pptx import Presentation

prs = Presentation("template.pptx")
for i, layout in enumerate(prs.slide_layouts):
    print(i, layout.name)
```

```bash
python scripts/office/soffice.py --headless --convert-to pdf template.pptx
pdftoppm -jpeg -r 150 template.pdf template-page
```

(template analysis only — it only accepts `.pptx`, so copy a `.potx`
to a `.pptx` name first). Use the slide/shape text you read via
`python-pptx` to map each content section onto a template slide, and
vary the layouts — don't put every section on the same
title-and-bullets slide.

```bash
python scripts/add_slide.py unpacked/ slide2.xml --after slide2.xml   # duplicate a slide (or slideLayoutN.xml); prints the new slide's path
```

Reordering or deleting slides has no `python-pptx` method — edit the
slide-id list directly:

```python
def delete_slide(prs, index):
    xml_slides = prs.slides._sldIdLst
    slides = list(xml_slides)
    xml_slides.remove(slides[index])
```

This leaves that slide's own media/rels parts orphaned in the package
— harmless (both PowerPoint and LibreOffice tolerate it), just not
cleaned up, since `clean.py` doesn't run here (see above).

- **Do all structural work — add, delete, reorder — before editing any
  slide's content.** `add_slide.py` copies a slide file verbatim, so
  duplicating after you edit clones the edited content.
- **Never copy a slide file by hand** — `add_slide.py` does every
  registration a new slide needs and reports what it made (`Created
  ppt/slides/slide17.xml from slide2.xml`). It also works directly on
  a file: `add_slide.py deck.pptx slide2.xml -o out.pptx` — **pass
  `-o`, or it rewrites the input deck in place.** A duplicated slide
  still *references* its source's chart/SmartArt/embedded-object parts
  rather than cloning them, so editing one slide's chart changes the
  other's.
- **`python-pptx` won't do three things**: duplicate a slide (its only
  entry point is `add_slide(layout)`, which creates a blank one from a
  layout, not a copy of an existing slide — use `add_slide.py`),
  preserve formatting through `text_frame.text = "..."` (assign
  `run.text` instead, see the gotcha above), or read the SVG/EMF most
  template art uses (`add_picture` raises `UnidentifiedImageError`).
- Legacy `.ppt` must be converted first:
  `python scripts/office/soffice.py --headless --convert-to pptx file.ppt`.
  `.potx` templates unpack and pack identically — keep the `.potx`
  extension on the output.
- To reuse a template icon or image, duplicate a slide or layout that
  already contains it (`add_slide.py`), then delete what you don't
  need from the copy.

When filling in a template:

- Prefer `python-pptx`'s object model end-to-end
  (`shape.text_frame`, `shape.fill`, `shape.line`, …). Only drop to raw
  XML via the shape's own `shape._element` (an `lxml` element —
  `lxml` IS installed, as `python-pptx`'s own dependency) for the
  handful of things listed as gotchas above that the object model has
  no coverage for. There is no `defusedxml`-based transform script in
  this sandbox to reach for instead.
- **Template slots ≠ source items.** If the template shows 4 team
  members and you have 3, delete the 4th member's entire shape group
  (image + text boxes) — `group_shape.shapes` iterates a group's
  members — not just its text, then check for orphaned visuals in QA.
- **One `text_frame.add_paragraph()` per list item** — never
  concatenate items into a single paragraph's text. Copy formatting
  from a sibling paragraph's `.font`/`.alignment` to keep spacing
  consistent, and set `run.font.bold = True` on titles, section
  headers, and inline labels (`Status:`, `Owner:`).
- Let bullets inherit from the layout; only touch raw
  `<a:buChar>`/`<a:buAutoNum>`/`<a:buNone>` to override (see gotcha
  above) — never a literal `•` character in run text.
- Leading/trailing spaces in a run need the same care Word/PowerPoint
  XML always needs: if you build a run's text via raw XML instead of
  `run.text = ...`, the element needs `xml:space="preserve"` or
  surrounding whitespace collapses.

## Design Ideas

**Don't create boring slides.** Plain bullets on a white background won't impress anyone. Consider ideas from this list for each slide.

### Before Starting

- **Pick a bold, content-informed color palette**: The palette should feel designed for THIS topic. If swapping your colors into a completely different presentation would still "work," you haven't made specific enough choices.
- **Dominance over equality**: One color should dominate (60-70% visual weight), with 1-2 supporting tones and one sharp accent. Never give all colors equal weight.
- **Dark/light contrast**: Dark backgrounds for title + conclusion slides, light for content ("sandwich" structure). Or commit to dark throughout for a premium feel.
- **Commit to a visual motif**: Pick ONE distinctive element and repeat it — rounded image frames, icons in colored circles. Carry it across every slide. **Do not use a color bar or accent stripe as your motif** (see Avoid list).

### Color Palettes

Choose colors that match your topic — don't default to generic blue. Use these palettes as inspiration:

| Theme | Primary | Secondary | Accent |
|-------|---------|-----------|--------|
| **Midnight Executive** | `1E2761` (navy) | `CADCFC` (ice blue) | `FFFFFF` (white) |
| **Forest & Moss** | `2C5F2D` (forest) | `97BC62` (moss) | `F5F5F5` (cream) |
| **Coral Energy** | `F96167` (coral) | `F9E795` (gold) | `2F3C7E` (navy) |
| **Warm Terracotta** | `B85042` (terracotta) | `E7E8D1` (sand) | `A7BEAE` (sage) |
| **Ocean Gradient** | `065A82` (deep blue) | `1C7293` (teal) | `21295C` (midnight) |
| **Charcoal Minimal** | `36454F` (charcoal) | `F2F2F2` (off-white) | `212121` (black) |
| **Teal Trust** | `028090` (teal) | `00A896` (seafoam) | `02C39A` (mint) |
| **Berry & Cream** | `6D2E46` (berry) | `A26769` (dusty rose) | `ECE2D0` (cream) |
| **Sage Calm** | `84B59F` (sage) | `69A297` (eucalyptus) | `50808E` (slate) |
| **Cherry Bold** | `990011` (cherry) | `FCF6F5` (off-white) | `2F3C7E` (navy) |

### For Each Slide

**Every slide needs a visual element** — image, chart, icon, or shape. Text-only slides are forgettable.

**Layout options:**
- Two-column (text left, illustration on right)
- Icon + text rows (icon in colored circle, bold header, description below)
- 2x2 or 2x3 grid (image on one side, grid of content blocks on other)
- Half-bleed image (full left or right side) with content overlay

**Data display:**
- Large stat callouts (big numbers 60-72pt with small labels below)
- Comparison columns (before/after, pros/cons, side-by-side options)
- Timeline or process flow (numbered steps, arrows)

**Visual polish:**
- Icons in small colored circles next to section headers
- Italic accent text for key stats or taglines

### Typography

**Font names you write into the .pptx are rendered by the user's PowerPoint, not by this environment.** Your visual QA renders via LibreOffice, which substitutes fonts it doesn't have — and for some fonts the substitute has different widths, so your QA preview can show text overflow (or fit) that the real deck won't have. To keep your QA trustworthy:

- **Safe fonts** (render true-to-width in QA *and* ship with Office): **Arial, Calibri, Cambria, Times New Roman, Courier New, Bookman Old Style, Century Schoolbook**. Use these for body text and anything where fit matters.
- **Headers with personality at zero QA risk**: pair a safe-list serif header (Cambria, Bookman Old Style, Century Schoolbook) with a safe-list sans body (Calibri or Arial). You get visual contrast without giving up reliable overflow checks.
- **If the user asks for a font outside the safe list** (e.g. Georgia or Trebuchet MS): use it where the user asked, but size those containers with extra slack (~10%) and don't trust QA text-fit on those elements — the preview of that font is approximate. If the user hasn't specified, prefer safe-list fonts for body text.
- **QA-unreliable fonts** (substitute has different widths — overflow checks can be wrong): Georgia, Trebuchet MS, Impact, Arial Black, Garamond, Consolas, Palatino Linotype. Calibri Light substitution varies by environment; treat as QA-unreliable. Fine for titles/accents with slack; don't trust QA text-fit on these.
- **Never default to Aptos** — Office's post-2023 default has no metric-compatible substitute here *and* is missing from older Office installs, so it's unreliable on both ends.

| Element | Size |
|---------|------|
| Slide title | 36-44pt bold |
| Section header | 20-24pt bold |
| Body text | 14-16pt |
| Captions | 10-12pt muted |

### Spacing

- 0.5" minimum margins
- 0.3-0.5" between content blocks
- Leave breathing room—don't fill every inch

### Avoid (Common Mistakes)

- **Don't repeat the same layout** — vary columns, cards, and callouts across slides
- **Don't center body text** — left-align paragraphs and lists; center only titles
- **Don't skimp on size contrast** — titles need 36pt+ to stand out from 14-16pt body
- **Don't default to blue** — pick colors that reflect the specific topic
- **Don't mix spacing randomly** — choose 0.3" or 0.5" gaps and use consistently
- **Don't style one slide and leave the rest plain** — commit fully or keep it simple throughout
- **Don't create text-only slides** — add images, icons, charts, or visual elements; avoid plain title + bullets
- **Don't forget text box padding** — when aligning lines or shapes with text edges, set `margin_left`/etc. to `Emu(0)` on the text frame or offset the shape to account for padding
- **Don't use low-contrast elements** — icons AND text need strong contrast against the background; avoid light text on light backgrounds or dark text on dark backgrounds
- **NEVER use accent lines under titles** — these are a hallmark of AI-generated slides; use whitespace or background color instead
- **NEVER add decorative color bars or accent stripes** — this includes: header/footer bars spanning the slide width, vertical sidebar stripes down one edge of the slide, thin accent stripes along one edge of a card or content block, and "single-side borders" on rectangles. These read as AI-generated filler. If you want to set a card apart, use a subtle background tint, a drop shadow, or an icon — not an edge stripe.
- **Don't default to cream/beige backgrounds** — when no background is specified, use white (`FFFFFF`) or the user's brand palette; avoid warm-neutral defaults like `F5F5DC`, `FAF0E6`, `FAEBD7`, `FFF8E1`
- **Don't ship text that overflows its shape** — if text doesn't fit, reduce font size, split across slides, or enlarge the container; never leave content cut off or spilling past bounds

## QA (Required)

Your first render usually has a few real issues — overlaps, overflow, misalignment. Find and fix those, re-render only the slides you changed, and stop.

### Content QA

`markitdown` isn't installed in this sandbox — dump text through `python-pptx` directly:

```python
from pptx import Presentation

prs = Presentation("output.pptx")
for i, slide in enumerate(prs.slides, 1):
    print(f"--- Slide {i} ---")
    for shape in slide.shapes:
        if shape.has_text_frame:
            print(shape.text_frame.text)
```

Check for missing content, typos, wrong order.

**When using templates, check for leftover placeholder text** — run
the dump above, then search its output the same way you would grep
`markitdown`'s (a plain `re.search` over the collected text, or pipe
the script's stdout to `grep` from your own `subprocess.run` call):

```
\bx{3,}\b|lorem|ipsum|\bTODO|\[insert|this.*(page|slide).*layout
```

Fix any match before declaring success.

### File QA (best available — no schema validator here)

```python
from pptx import Presentation
Presentation("output.pptx")  # must not raise
```

```bash
python scripts/office/soffice.py --headless --convert-to pdf output.pptx
```

Must exit 0 and produce a non-empty PDF. This sandbox has no
`office/validate.py`-equivalent schema/relationship/chart checker (it
needs `defusedxml`, not installed) — these two checks plus Visual QA
below are what you have; lean harder on Visual QA than you would with
a real validator available.

### Visual QA

Convert the slides to images (see [Converting to Images](#converting-to-images)) and inspect every one. After staring at the generating code you tend to see what you expect rather than what rendered, so look at the images fresh (a subagent works well for this if you have one). User-visible defects to look for:

- **Text overflow or text cut off at a box or slide boundary — check this first.** It is the most common defect and always user-visible. (For a font the previewer renders unreliably per Typography, the preview is approximate: trust the ~10% slack you left, not its apparent fit.)
- Overlapping elements (text through shapes, lines through words, stacked elements)
- Source citations or footers colliding with content above
- Elements too close (< 0.3" gaps) or cards/sections nearly touching
- Uneven gaps (large empty area in one place, cramped in another)
- Insufficient margin from slide edges (< 0.5")
- Columns or similar elements not aligned consistently
- Low-contrast text (e.g., light gray text on cream-colored background)
- Template decoration mispositioned after text replacement — e.g., a title underline positioned for one line, but the replaced title wrapped to two
- Low-contrast icons (e.g., dark icons on dark backgrounds without a contrasting circle)
- Text boxes too narrow causing excessive wrapping
- Leftover placeholder content

## Converting to Images

Convert presentations to individual slide images for visual inspection:

```bash
python scripts/office/soffice.py --headless --convert-to pdf output.pptx
rm -f slide-*.jpg
pdftoppm -jpeg -r 150 output.pdf slide
ls -1 "$PWD"/slide-*.jpg
```

**Pass the absolute paths printed above directly to the view tool.** The `rm` clears stale images from prior runs. `pdftoppm` zero-pads based on page count: `slide-1.jpg` for decks under 10 pages, `slide-01.jpg` for 10-99, `slide-001.jpg` for 100+.

**After fixes, rerun all commands above** — the PDF must be regenerated from the edited `.pptx` before `pdftoppm` can reflect your changes.

## Dependencies

`python-pptx` (pip, pinned in `sandbox-service/Dockerfile`) · LibreOffice
(`soffice`, via this skill's `scripts/office/soffice.py`) · `pdftoppm`
(poppler-utils) for visual QA. No `npm`, no `pandoc`, no `markitdown`,
no `Pillow` — none of those are installed in this sandbox.
