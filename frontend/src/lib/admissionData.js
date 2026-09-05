/**
 * The individual admission wizard's steps, fields and mock extraction.
 *
 * **Four steps, and the third one is the point.** Documents → Details →
 * Confirm → Complete. The extraction step reads an uploaded document and
 * proposes values; the Details step is where a human corrects them; Confirm is
 * where they see exactly what will be created. A flow that went straight from
 * an upload to a created student would be treating a machine's reading of a
 * scan as a fact, which it is not.
 *
 * **The extraction is a visual mock and says so.** There is no OCR, no model
 * and no network here — `extractFrom()` returns a deterministic reading derived
 * from the file name, with a confidence per field, and the interface labels it
 * as prototype output. Every extracted value lands in an editable field, none
 * of them is trusted, and nothing can be submitted without a person having seen
 * it. In the product this is a real extraction service whose output is still
 * advisory, and that is the behaviour being designed here.
 *
 * Local/mock only. Keep the shapes.
 *
 * Shapes
 *  Field      { key, label, required, placeholder, hint, type }
 *  Extraction { values: { [key]: string }, confidence: { [key]: number },
 *               source: string }
 */

export const ADMISSION_STEPS = [
  { key: 'documents', label: 'Documents', caption: 'Upload what the student has provided' },
  { key: 'details', label: 'Details', caption: 'Check every field before continuing' },
  { key: 'confirm', label: 'Confirm', caption: 'Exactly what will be created' },
  { key: 'complete', label: 'Complete', caption: 'Active in this class' },
];

/**
 * The documents an admission asks for.
 *
 * None of them is mandatory to complete the admission: a late admission or a
 * transfer-in routinely arrives before their paperwork does, and blocking
 * enrolment on it would leave a student sitting in a class with no record.
 * What a missing document produces is the `Documents pending` state, which is a
 * follow-up rather than a hold.
 */
export const DOCUMENT_KINDS = [
  { key: 'marksheet', label: 'Previous semester marksheet', extracts: true },
  { key: 'transfer', label: 'Transfer certificate', extracts: true },
  { key: 'id', label: 'Photo ID', extracts: false },
];

/**
 * The fields a student record needs.
 *
 * Deliberately short. This is an admission into an existing class, so
 * department, academic year, semester and section are **not** fields — they are
 * the seat's own scope and are shown as fixed context, not asked for. A form
 * that let a Class Tutor type a section would be offering a scope they do not
 * have.
 */
export const ADMISSION_FIELDS = [
  { key: 'name', label: 'Full name', required: true, placeholder: 'As printed on the certificate', type: 'text' },
  {
    key: 'reg',
    label: 'Register number',
    required: true,
    placeholder: 'REG-2024-0000',
    type: 'text',
    hint: 'Used to check this student is not already placed in the class',
  },
  { key: 'phone', label: 'Student phone', required: false, placeholder: '+91 …', type: 'tel' },
  { key: 'guardianPhone', label: 'Guardian phone', required: false, placeholder: '+91 …', type: 'tel' },
];

const FIRST = ['Aravind', 'Keerthana', 'Sathish', 'Nivetha', 'Praveen', 'Yamini', 'Hariharan', 'Deepthi'];
const LAST = ['Ramesh', 'Sundaram', 'Natarajan', 'Vasudevan', 'Chandran', 'Kumaravel'];

function hash(text) {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 100000;
  return h;
}

/**
 * A deterministic mock reading of an uploaded document.
 *
 * Derived from the file name so a reviewer gets the same result every time and
 * two different files read differently — that is the whole of the "extraction".
 * Confidence is returned per field and is deliberately **not** uniform: the
 * interface has to be able to show a low-confidence field differently, because
 * that is the field a human most needs to look at.
 */
export function extractFrom(fileName) {
  const h = hash(String(fileName || 'document'));
  const first = FIRST[h % FIRST.length];
  const last = LAST[Math.floor(h / 7) % LAST.length];

  return {
    source: fileName,
    values: {
      name: `${first} ${last}`,
      reg: `REG-2024-${String(1000 + (h % 8999))}`,
      phone: `+91 9${String(400000000 + (h % 599999999))}`,
      guardianPhone: '',
    },
    confidence: {
      name: 0.96,
      reg: 0.91,
      // Deliberately low: a phone number read off a scan is the field most
      // likely to be wrong, and the one a person should be asked to check.
      phone: 0.54,
      guardianPhone: 0,
    },
  };
}

export const CONFIDENCE_BANDS = {
  high: { min: 0.85, label: 'High confidence', tone: 'text-success' },
  medium: { min: 0.6, label: 'Check this', tone: 'text-pending' },
  low: { min: 0, label: 'Low confidence — check this', tone: 'text-danger' },
};

export function confidenceBand(value) {
  if (!value) return null;
  if (value >= CONFIDENCE_BANDS.high.min) return CONFIDENCE_BANDS.high;
  if (value >= CONFIDENCE_BANDS.medium.min) return CONFIDENCE_BANDS.medium;
  return CONFIDENCE_BANDS.low;
}

/** An empty form, so every field is a controlled input from the first render. */
export function emptyAdmission() {
  return Object.fromEntries(ADMISSION_FIELDS.map((f) => [f.key, '']));
}

/** Which required fields are still missing — the wizard's own Next gate. */
export function missingRequired(values) {
  return ADMISSION_FIELDS.filter((f) => f.required && !String(values[f.key] ?? '').trim()).map((f) => f.label);
}
