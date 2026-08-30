---
name: docx
description: "Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files) or Word templates (.dotx files). Triggers include: any mention of 'Word doc', 'word document', '.docx', '.dotx', or requests to produce professional documents with formatting like tables of contents, headings, page numbers, or letterheads. Also use when extracting or reorganizing content from .docx or .dotx files, inserting or replacing images in documents, performing find-and-replace in Word files, working with tracked changes or comments, or converting content into a polished Word document. If the user asks for a 'report', 'memo', 'letter', 'template', or similar deliverable as a Word or .docx file, use this skill. Do NOT use for PDFs, spreadsheets, Google Docs, or general coding tasks unrelated to document generation."
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

## This sandbox's real toolset — read before following any other docx guide

This is a Python-only sandbox (`execute_code`) — no `npm`/Node, no
`pandoc`, no `markitdown`, no network access to install anything at
request time. **`python-docx` is the only library for `.docx` here.**
If you have seen docx guidance elsewhere (including generic examples
built around the `docx`/`docx4js` npm packages, `pandoc`, or
`markitdown`) — none of that runs in this sandbox. Everything below
uses only what `sandbox-service/Dockerfile` actually installs:
`python-docx`, plus LibreOffice (`soffice`, Writer included) for
rendering/verification.

Two bundled scripts under this skill's `scripts/` directory are
genuinely usable here (pure Python + stdlib, no missing dependency):

- `scripts/office/soffice.py` — `run_soffice()`, the LibreOffice
  wrapper above.
- `scripts/accept_changes.py` — accepts every tracked change in a
  `.docx` via LibreOffice and writes a clean copy.

The rest of this skill's bundled `scripts/` (`merge_runs.py`,
`comment.py`, `office/validate.py` and everything under
`office/validators/`) import `defusedxml`, which is **not installed**
in this sandbox — running any of them raises `ModuleNotFoundError`.
Don't invoke them. Where this file used to lean on one of them, it
now gives you the direct `python-docx` (or raw-XML-via-`lxml`, which
IS installed as `python-docx`'s own dependency) equivalent instead.

# DOCX creation, editing, and analysis

A `.docx` is a ZIP archive of XML files, but `python-docx` reads and
writes that archive for you — you should never need to unzip/rezip
one by hand in this sandbox.

| Task | Approach |
|---|---|
| **Create** a new document | `python-docx`'s `Document()` — see gotchas below |
| **Edit** an existing document | `python-docx`'s `Document(path)` — mutate paragraphs/runs/tables in place, then `.save()` |
| **Read** content | `python-docx`'s `Document(path)`, iterate `.paragraphs` / `.tables` |

## Quick start

```python
from docx import Document

doc = Document()
doc.add_heading("Report Title", level=1)
doc.add_paragraph("This is the body text.")

table = doc.add_table(rows=1, cols=2)
table.rows[0].cells[0].text = "Name"
table.rows[0].cells[1].text = "Value"

doc.save("output.docx")
```

Reading is the same object model in reverse:

```python
from docx import Document

doc = Document("input.docx")
for para in doc.paragraphs:
    print(para.text)
for table in doc.tables:
    for row in table.rows:
        print([cell.text for cell in row.cells])
```

## Creating with python-docx — gotchas

The model knows the API; these are the footguns already caught on in
this project or well-documented upstream:

- **Default page size is US Letter, 1" margins** — unlike `pptx`'s A4
  default canvas, `Document()`'s built-in template is already Letter.
  For A4: `section.page_width, section.page_height = Mm(210), Mm(297)`.
- **Landscape does not swap width/height for you.** Setting
  `section.orientation = WD_ORIENT.LANDSCAPE` only flips a flag Word
  reads for print-preview purposes — you must swap `page_width`/
  `page_height` yourself, or the content area stays portrait-shaped.
- **Tables need `autofit = False` before column widths stick.** Set
  `table.autofit = False`, then both `table.columns[i].width` AND each
  cell's own `.width` in that column — Word frequently ignores a
  column-only width otherwise. Use `Inches`/`Cm`/`Emu`, never raw
  twips.
- **No cell-shading API.** `python-docx` cannot set a table cell's
  background color through its object model. Reach into the cell's
  own XML:
  ```python
  from docx.oxml.ns import qn
  from docx.oxml import OxmlElement

  def shade_cell(cell, hex_color):
      tcPr = cell._tc.get_or_add_tcPr()
      shd = OxmlElement('w:shd')
      shd.set(qn('w:fill'), hex_color)
      tcPr.append(shd)
  ```
- **No native bulleted/numbered-list API.** Apply one of the
  template's own built-in styles instead of hand-rolling bullets:
  `paragraph.style = doc.styles['List Bullet']` (or `'List Number'`).
  A genuinely custom numbering scheme needs a new `numbering.xml`
  definition — there is no bundled helper for that in this sandbox;
  prefer the built-in styles.
- **`add_picture` doesn't preserve aspect ratio if you set both
  dimensions.** Pass only `width=` or only `height=` (in `Inches`/
  `Cm`) and let the other scale automatically.
- **Page breaks:** `document.add_page_break()` between blocks, or
  `run.add_break(WD_BREAK.PAGE)` mid-paragraph (`from docx.enum.text
  import WD_BREAK`).
- **Never rely on `\n` inside `run.text`** — Word does not render it
  as a line break. Use `run.add_break(WD_BREAK.LINE)`, or a separate
  paragraph.
- **Table of Contents:** `python-docx` cannot generate a real,
  live-updating TOC field — that needs a raw `w:fldSimple`/`w:fldChar`
  field code, and Word (or LibreOffice, on open) must recompute it
  before page numbers are accurate. Tell the user the TOC will show as
  empty/stale until opened once in a real Word client, rather than
  presenting a hand-typed page-number list as if it were a real field.
- **Dot-leader / right-aligned tab** (e.g. `Section .......... 4`):
  ```python
  from docx.enum.text import WD_TAB_ALIGNMENT, WD_TAB_LEADER
  paragraph.paragraph_format.tab_stops.add_tab_stop(
      Inches(6), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
  ```
  then put a literal tab character (`\t`) in the run text before the
  page number — never pad with spaces or literal dots.
- **No horizontal-rule element.** Don't use a 1-row table as a visual
  rule. Add a bottom paragraph border instead (same `OxmlElement`
  pattern as cell shading, on `paragraph.paragraph_format.element.get_or_add_pPr()`
  with a `w:pBdr`/`w:bottom` child).

## Verify the output

After writing a `.docx`, render it and look at it:

```python
import sys
sys.path.insert(0, "scripts")  # so `from office.soffice import run_soffice` resolves
from office.soffice import run_soffice

run_soffice(["--headless", "--convert-to", "pdf", "--outdir", "out", "output.docx"],
            capture_output=True, timeout=180)
```

```bash
pdftoppm -jpeg -r 100 out/output.pdf page
ls page-*.jpg   # then Read the images
```

`pdftoppm` (poppler-utils, installed) zero-pads page numbers to the
width of the page count (`page-01.jpg`…`page-12.jpg`).

## Editing existing documents

Legacy `.doc` files must be converted first — `python-docx` cannot
open the old binary format at all:

```python
run_soffice(["--headless", "--convert-to", "docx", "--outdir", "out", "file.doc"],
            capture_output=True, timeout=180)
```

Word splits visible text across many `<w:r>` runs (revision ids,
spell-check markers), so a phrase you can see in the rendered document
often doesn't exist as one contiguous string in `python-docx`'s
`run.text` values — but `paragraph.text` already joins every run in
that paragraph, so searching is still straightforward:

```python
for paragraph in doc.paragraphs:
    if "target phrase" not in paragraph.text:
        continue
    # Found it. To EDIT text that spans multiple runs, rebuild the
    # paragraph's runs rather than trying to patch one run in place —
    # simplest correct approach for a short paragraph:
    for run in paragraph.runs:
        run.text = ""
    paragraph.runs[0].text = paragraph.text.replace("target phrase", "replacement")
```

This loses per-run formatting variation WITHIN the paragraph (bold on
one word, plain on the rest) — fine for a whole-paragraph replacement,
wrong for "keep everything else's formatting and only swap one bolded
word." For that narrower case, find the specific run(s) whose `.text`
already contains your target substring and edit only those runs'
`.text` directly, leaving sibling runs untouched.

## Tracked changes

**Accepting** existing tracked changes into a clean copy works and is
bundled:

```bash
python scripts/accept_changes.py in.docx out.docx
```

(Uses LibreOffice under the hood via `office/soffice.py` — no
`defusedxml` dependency, safe in this sandbox.)

**Authoring new tracked changes (redlining)** has no `python-docx` API
and no bundled helper in this sandbox — it requires hand-building
`<w:ins>`/`<w:del>` XML via each paragraph's underlying `lxml` element
(`paragraph._p`), with `w:id`/`w:author`/`w:date` attributes on every
inserted/deleted run. This project has no schema-validation script
that can check a redline is well-formed here (the bundled
`office/validate.py` needs `defusedxml`, which isn't installed) — say
so plainly if a user asks for real Word-native redlining, rather than
emitting unverified raw XML with no way to confirm it opens correctly.

## Comments

Adding a native Word comment is **not currently supported** in this
sandbox — the bundled `scripts/comment.py` needs `defusedxml`, which
isn't installed here, and comments require six cross-linked XML parts
with no `python-docx` API to generate them. Don't attempt an ad hoc
version — say so, and offer a plain-text alternative (e.g. a bracketed
inline note in the document body, clearly marked as an annotation)
when the user needs feedback embedded in the file itself.

## Dependencies

`python-docx` (pip, pinned in `sandbox-service/Dockerfile`) · LibreOffice
(`soffice`, via this skill's `scripts/office/soffice.py`) · `pdftoppm`
(poppler-utils) for visual QA. No `npm`, no `pandoc`, no `markitdown` —
none of those are installed in this sandbox.
