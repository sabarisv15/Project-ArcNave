---
name: xlsx
description: "How to read an uploaded xlsx attachment, and how to build a NEW xlsx workbook that execute_code's saveAs/expectFormulasIn gate will actually accept and deliver to the user. Read this before writing any openpyxl code — the gate rejects a common, easy mistake this skill exists to prevent."
---

# Reading and building Excel workbooks

## Reading an uploaded workbook

`openpyxl` is installed. Load with
`openpyxl.load_workbook(name, data_only=True)` if you only need the
values a spreadsheet application last computed, or `data_only=False` if
you need the formulas themselves. Do not assume `data_only=True` gives
you a value for every formula cell — a workbook that was never opened
and recalculated by a real spreadsheet application has **no cached
value at all**, and you will get `None`. If that happens, say so rather
than treating `None` as zero.

For an xlsx whose columns are merged or otherwise misaligned,
`analyze_document_table` (a non-sandbox tool) may already report
`unreliable_extraction` — `pdfplumber` is for PDFs, not for this;
`openpyxl` reading a genuinely malformed sheet still needs manual
column-boundary reasoning, same as any other tool.

## Building a NEW workbook to hand back to the user

This is the one case in ARCNAVE where a sandbox script can produce a
real, downloadable file. It goes through a **quality gate** you cannot
skip and should not try to work around.

### The one rule that matters

**Write real formulas into the cells that need them. Never compute the
answer in Python and write it as a number.**

```python
# WRONG — the gate rejects this even though the number is correct.
total = sum(row["amount"] for row in rows if row["category"] == "PLB")
ws["B2"] = total

# RIGHT — a live formula the gate accepts, and that keeps working if
# a source row changes later.
ws["B2"] = '=SUMIFS(Data!C:C, Data!A:A, "PLB")'
```

This is not a style preference. `execute_code`'s gate re-opens your
recalculated workbook and checks, cell by cell, whether every cell you
declared in `expectFormulasIn` still holds a formula string. A cell
holding a plain number there — even the exactly correct number — is
**rejected**, because a hardcoded total does not update when the
underlying data does, and looks identical to a real one until someone
edits a row.

### How to call it

```python
import openpyxl
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Summary"
# ... write your source rows and formulas ...
wb.save("breakdown.xlsx")
```

Then call `execute_code` with:
- `saveAs: "breakdown.xlsx"` — the exact filename your code saved
- `expectFormulasIn: ["Summary!B2:B9"]` — every cell/range that must
  hold a formula, sheet-qualified

### What happens to the result

- **Passes the gate** → a new artifact is created holding your code and
  the verification report, the workbook is attached to it, and the tool
  result gives you the artifact id. The raw file bytes never come back
  to you — you cannot inspect them further in this turn, only report
  that it was produced.
- **Fails the gate** → nothing is created or attached. The tool result
  tells you exactly which cells were the problem (`errors`, `constants`,
  `uncached`, or `missingCells` in the verification report) so you can
  fix the code and call `execute_code` again.
- **No `expectFormulasIn` given** → reported `unverified`, refused, same
  as a failure. There is no "trust me" option — every generated workbook
  must declare what it expects to be checked against.

### Common causes of a failed gate

- A formula pointing at a cell that turned out blank or merged —
  evaluates to `#REF!`/`#VALUE!` after recalculation.
- A total written in Python instead of as `=SUMIFS(...)`/`=SUM(...)` —
  the exact mistake this skill opened with.
- A cell named in `expectFormulasIn` that does not exist in the sheet at
  all — check the range and sheet name.
