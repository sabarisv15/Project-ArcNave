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
| `.pdf` | Read the attachment directly first — no sandbox call needed for a flat, well-aligned document. Reach for the sandbox when you need `pdfplumber`'s per-cell layout for a merged/misaligned table | `pdf-reading` |
| `.xlsx`, `.xls` | `openpyxl.load_workbook` | `xlsx` |
| `.csv`, `.tsv` | `pandas.read_csv` | — (below) |

## `.csv` / `.tsv`

`pandas` is available. Read with `pd.read_csv(name, sep=None, engine="python")`
if the delimiter is uncertain. Print only what answers the question —
`df.shape` for a row/column count, `df.head()` for a sample, never the
full frame unless it is genuinely small.

## docx / pptx / PDF-writing libraries

`python-docx`, `python-pptx`, `reportlab`, and `pypdf` are installed
(see `sandbox-service/Dockerfile`), and LibreOffice here has Writer
and Impress too, not just Calc.

- **Reading** a `.docx`/`.pptx` attachment: use `python-docx`/
  `python-pptx` directly, or `describe_skill('docx')` /
  `describe_skill('pptx')` / `describe_skill('pdf')` for fuller
  guidance — all three are written for this sandbox's real toolset
  (no `npm`, `pandoc`, or `markitdown` anywhere in them).
- **Producing a new file back to the user** is still `.xlsx`-only —
  see below. `reportlab`/`python-docx`/`python-pptx` can write a file
  inside the sandbox, but there is no verification gate yet for
  anything other than `.xlsx`, so a generated `.docx`/`.pptx`/`.pdf`
  cannot be attached and returned this way.

## Producing a NEW file back to the user

Only `.xlsx` is supported for this today, and only through the gate
described in the `xlsx` skill — see `describe_skill('xlsx')` before
attempting it. There is no general "write any file and hand it back"
mechanism for any other format; a workbook that fails the gate is
refused, not delivered unverified. ARCNAVE's own document generation
(`generate_document`, `export_artifact_as`) still covers
markdown-sourced docx/pdf/pptx through a separate, already-reviewed
path — prefer that when the content is text you already have, and
tell the user plainly when neither path covers what they asked for.

## Reporting a deterministic answer (count, sum, average, comparison, list)

For a count/sum/average/comparison/filter/grouping — anything you
compute rather than just describe — print exactly ONE final line
starting with `FINAL_RESULT_JSON:` followed by a JSON object, after
your normal progress/debug output. This is how ARCNAVE checks your
own narrated answer against what your code actually computed — never
add markdown fences around it, and never print more than one such
line unless an earlier one was a mistake you are correcting (only the
LAST one is read).

A scalar answer (count/sum/average/single comparison result):

```text
FINAL_RESULT_JSON:{"result_type":"deterministic_summary","metric":"students_below_75_attendance","value":29,"unit":"students"}
```

A per-group breakdown (each entry's own `value` is checked too, not
just the total):

```text
FINAL_RESULT_JSON:{"result_type":"deterministic_summary","metric":"arrears_by_semester","value":77,"unit":"arrears","breakdown":[{"label":"Semester 3","value":41},{"label":"Semester 5","value":36}]}
```

A list/filtered-rows answer:

```text
FINAL_RESULT_JSON:{"result_type":"list","items":[{"rollNo":"819","name":"..."}]}
```

If your code cannot produce the answer (a required column is missing,
the file didn't parse, an assumption you'd have to guess), report that
structurally too, instead of guessing a number:

```text
FINAL_RESULT_JSON:{"result_type":"error","code":"INPUT_FILE_NOT_FOUND","message":"attendance.xlsx was not available in the sandbox"}
```

Without a `FINAL_RESULT_JSON:` line, your narrated number cannot be
checked against anything — say so is still allowed, but it will not be
verified.
