/**
 * CSV/XLSX bulk import — parsing, column mapping and row classification.
 *
 * **Tabular data only.** A CSV or a spreadsheet of student rows, mapped column
 * by column. There is no ZIP, no document bundle and no file-per-student
 * mapping: bulk import creates *records*, and documents are attached afterwards
 * — which is exactly why every imported student lands with `Documents pending`.
 *
 * **The class context is not in the file.** Department, academic year,
 * semester, section and class are the seat's own scope and are applied to every
 * row; a `class` column in the sheet is deliberately ignored rather than
 * honoured. If a file could redirect rows into another class, an import would
 * be a way around the one-class scope the whole seat is built on.
 *
 * **Three outcomes, not two.** A row is valid, a warning, or rejected, and the
 * middle one is the one that matters: a student with no phone number is still a
 * student, and rejecting the row would lose them. Warnings import; rejections
 * do not.
 *
 * Local/mock only — the parser is a small CSV reader, and an `.xlsx` is
 * accepted by taking the same delimited text a spreadsheet export produces.
 *
 * Shapes
 *  ParsedFile   { headers: string[], rows: string[][] }
 *  Mapping      { [fieldKey]: headerIndex | null }
 *  ClassifiedRow{ index, values, state: 'valid'|'warning'|'rejected',
 *                 issues: string[] }
 */

import { ADMISSION_FIELDS } from './admissionData';

/** The columns an import can fill. Scope columns are absent on purpose. */
export const IMPORT_FIELDS = ADMISSION_FIELDS;

export const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx'];

/**
 * A deliberately small delimited parser.
 *
 * Handles quoted fields and embedded commas, which is the whole of what a
 * student-list export needs. Anything more elaborate belongs to a real parser
 * behind a real upload, not to a visual prototype.
 */
export function parseDelimited(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const [head, ...rest] = lines;
  return { headers: parseLine(head), rows: rest.map(parseLine) };
}

/**
 * A first guess at which column is which, by header name.
 *
 * A guess, and presented as one — the mapping step is editable, because a
 * column called "Roll" might be a register number or a class roll and only the
 * person who exported the file knows which.
 */
const HEADER_HINTS = {
  name: [/name/i, /student/i],
  reg: [/reg/i, /registration/i, /enrol/i],
  phone: [/^(student\s*)?(phone|mobile|contact)/i],
  guardianPhone: [/guardian/i, /parent/i],
};

export function guessMapping(headers) {
  const mapping = {};
  IMPORT_FIELDS.forEach((field) => {
    const patterns = HEADER_HINTS[field.key] ?? [];
    const index = headers.findIndex((h) => patterns.some((p) => p.test(h)));
    mapping[field.key] = index >= 0 ? index : null;
  });
  return mapping;
}

export function valuesFromRow(row, mapping) {
  return Object.fromEntries(
    IMPORT_FIELDS.map((f) => {
      const index = mapping[f.key];
      return [f.key, index == null ? '' : String(row[index] ?? '').trim()];
    }),
  );
}

export const ROW_STATES = {
  valid: { label: 'Valid', tone: 'text-success bg-success-soft' },
  warning: { label: 'Warning', tone: 'text-pending bg-pending-soft' },
  rejected: { label: 'Rejected', tone: 'text-danger bg-danger-soft' },
};

/**
 * Classify every row against the class it would land in.
 *
 * `validate` is the shared roster layer's own rule, passed in rather than
 * reimplemented — the preview and the confirm must agree about what "already
 * placed" and "at capacity" mean, and the only way to guarantee that is for
 * them to be the same function.
 *
 * Rows are checked **in order, against a running set** that includes the rows
 * above them: a file containing the same student twice rejects the second
 * occurrence, and a file with more rows than there are free seats rejects only
 * the ones past the line rather than the whole import.
 */
export function classifyRows(rows, mapping, validate) {
  const pending = [];

  return rows.map((row, index) => {
    const values = valuesFromRow(row, mapping);
    const check = validate(values, pending);
    const issues = [];

    if (!check.ok) {
      if (check.reason === 'duplicate') {
        issues.push(
          check.detail === 'promoted' ? 'Already placed in this class by promotion' : 'Already placed in this class',
        );
      } else if (check.reason === 'at_capacity') {
        issues.push('No provisioned seat left in this section');
      } else if (check.reason === 'missing_field') {
        issues.push(`${check.detail} is required`);
      } else {
        issues.push('Cannot be imported into this class');
      }
      return { index, values, state: 'rejected', issues };
    }

    // Accepted — but a row missing optional contact details is worth flagging
    // rather than silently importing as blank.
    if (!values.phone) issues.push('No student phone');
    if (!values.guardianPhone) issues.push('No guardian phone');
    issues.push('Documents pending until documents are added');

    pending.push(values);
    return {
      index,
      values,
      state: issues.length > 1 ? 'warning' : 'valid',
      issues,
    };
  });
}

export function summarise(classified) {
  return {
    total: classified.length,
    valid: classified.filter((r) => r.state === 'valid').length,
    warning: classified.filter((r) => r.state === 'warning').length,
    rejected: classified.filter((r) => r.state === 'rejected').length,
  };
}

/** Rows that will actually be created — valid and warning, never rejected. */
export function importableRows(classified) {
  return classified.filter((r) => r.state !== 'rejected').map((r) => r.values);
}

/**
 * A sample file, so the flow can be reviewed without a file system.
 *
 * It contains one of each outcome on purpose: two clean rows, one missing a
 * guardian number, one with no register number at all, and one that is already
 * in the class by promotion — which is the rejection this feature most has to
 * get right.
 */
export function sampleFile(promotedReg) {
  return [
    'Name,Register Number,Student Phone,Guardian Phone',
    'Meenakshi Raghavan,REG-2024-7781,+91 9840012345,+91 8840012345',
    'Sathish Kumaravel,REG-2024-7782,+91 9840012346,+91 8840012347',
    'Nivetha Chandran,REG-2024-7783,+91 9840012348,',
    'Row With No Register,,+91 9840012349,+91 8840012350',
    `Already Promoted Student,${promotedReg},+91 9840012351,+91 8840012352`,
  ].join('\n');
}
