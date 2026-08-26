---
name: pdf-reading
description: "When and how to reach for pdfplumber inside execute_code for a PDF attachment — specifically the case where the non-sandbox document tools already failed (unreliable_extraction) because a merged or misaligned table needs real column-boundary detection."
---

# Reading PDFs — when the sandbox is actually needed

## Try the deterministic path first

`analyze_document_table` and the other document-analysis tools already
handle flat, well-aligned PDF text without spending a sandbox call — and
their output is reviewed, deterministic code, not a script an LLM wrote
fresh each time. Reach for `execute_code` + `pdfplumber` only when one of
those has already reported `unreliable_extraction`, `none`, or a
suspiciously low record count for what the document should contain.

## Why pdfplumber specifically

The recorded failure this exists for: a result sheet or fee-list PDF
with a merged header cell recovers only 4 of 23 students' records
through flat text extraction — the identity columns are there, but a
naive read cannot tell which numeric column belongs to which row.
`pdfplumber.extract_tables()` does real x-column-boundary detection, not
just y-position bucketing, which is what actually fixes attribution:

```python
import pdfplumber

with pdfplumber.open("statement.pdf") as pdf:
    for page in pdf.pages:
        for table in page.extract_tables():
            for row in table:
                print(row)
```

`extract_tables()` returns a list of rows per table, each row a list of
cell strings (or `None` for an empty cell) — it does not merge or infer
values across page breaks, so a table spanning multiple pages needs its
own loop across `pdf.pages`.

## What this does not fix

`pdfplumber` recovers table STRUCTURE. It does not know what a
"correct" answer looks like for this specific document — if a value is
genuinely ambiguous in the source PDF (two numbers stacked in one
visual cell with no delimiter), no library resolves that automatically.
Say so rather than guessing which number belongs where.

## Scale

This is real work, not instant. A single-page fee list is fast; a
multi-hundred-page PDF is not — there is no measured number for this yet
in ARCNAVE, so budget accordingly and do not assume a large document
completes quickly.
