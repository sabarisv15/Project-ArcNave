---
name: file-reading
description: "Router for reading an already-uploaded chat attachment through execute_code. Tells you which approach to use for pdf, xlsx/csv, and other file types, and when a dedicated skill exists. Call describe_skill('file-reading') before writing code against an attachment you have not read yet."
---

# Reading an uploaded attachment

## Where the file actually is

An attachment lives in DocumentService, not on any filesystem you can
browse. You never get a path. You get an `attachmentId` (a chat
attachment from this turn), and the only way to look inside it is
`execute_code` with that id — the sandbox writes the file into its own
working directory before your code runs, under its ORIGINAL filename.

You cannot list files, cannot access any other attachment, and cannot
reach any ARCNAVE data from inside the sandbox. If your code needs a
second file, you cannot get one this way — say so instead of guessing.

## General approach

1. **Look at the file extension** — that is your dispatch key, same as
   any router.
2. **Read only what you need.** A "how many rows" question does not
   need the whole file loaded twice; count once, print the number.
3. **If a dedicated skill exists for the type, use it.** The table below
   says which. Fetch it with `describe_skill` before writing code for
   that type — it names the exact library and the gotchas that library
   has already been caught on in this project.

## Dispatch table

| Extension | First move | Dedicated skill |
|---|---|---|
| `.pdf` | Try flat text first (a non-sandbox tool, `analyze_document_table`, may already cover it without spending a sandbox call). Only reach for the sandbox when that reports `unreliable_extraction` or you need `pdfplumber`'s per-cell layout | `pdf-reading` |
| `.xlsx`, `.xls` | `openpyxl.load_workbook` | `xlsx` |
| `.csv`, `.tsv` | `pandas.read_csv` | — (below) |

## `.csv` / `.tsv`

`pandas` is available. Read with `pd.read_csv(name, sep=None, engine="python")`
if the delimiter is uncertain. Print only what answers the question —
`df.shape` for a row/column count, `df.head()` for a sample, never the
full frame unless it is genuinely small.

## What is NOT available in this sandbox

Be honest with the user rather than guessing. There is no `python-docx`,
no `python-pptx`, no PDF-writing library (`reportlab`, `pypdf`,
`fpdf`), and no word-processor/presentation engine (LibreOffice here is
Calc only, for the xlsx verification gate — not Writer or Impress).
That means:

- Reading a `.docx` or `.pptx` attachment through the sandbox is not
  currently supported. Say so; do not attempt an ad hoc unzip-and-parse
  of the OOXML — it will produce a wrong or partial answer that looks
  confident.
- Creating a new `.docx`, `.pptx`, or `.pdf` through `execute_code` is
  not currently supported. ARCNAVE's own document generation
  (`generate_document`, `export_artifact_as`) covers markdown-sourced
  docx/pdf/pptx through a different, already-reviewed path — prefer
  that when the content is text you already have, and tell the user
  plainly when neither path covers what they asked for.

## Producing a NEW file back to the user

Only `.xlsx` is supported for this today, and only through the gate
described in the `xlsx` skill — see `describe_skill('xlsx')` before
attempting it. There is no general "write any file and hand it back"
mechanism; a workbook that fails the gate is refused, not delivered
unverified.
