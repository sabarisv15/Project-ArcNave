---
name: pdf-reading
description: "When and how to reach for pdfplumber inside execute_code for a PDF attachment — specifically when a merged or misaligned table needs real column-boundary detection that reading the attachment directly cannot reliably give you."
---

# Reading PDFs — when the sandbox is actually needed

## Read the attachment directly first

For a flat, well-aligned PDF, reading the attached document directly
(no tool call) is the fastest path and usually correct for describing
or attributing content. Reach for `execute_code` + `pdfplumber` when a
table's structure is genuinely ambiguous for a direct read — a merged
header cell, misaligned columns, or a suspiciously low apparent record
count for what the document should contain — or for any exact count/
sum/comparison across many rows, since counting reliably across a long
table is exactly what a direct read is weakest at.

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
