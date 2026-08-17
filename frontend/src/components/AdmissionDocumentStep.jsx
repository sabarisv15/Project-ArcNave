import { useRef } from 'react';
import { FileText, Sparkles, Upload, X } from 'lucide-react';
import { DOCUMENT_KINDS, extractFrom } from '../lib/admissionData';
import { cn } from '../lib/utils';

/**
 * Step one: the documents the student brought, and a proposed reading of them.
 *
 * **The extraction is a prototype mock and never hides it.** There is no OCR,
 * no model and no network in this app; `extractFrom()` returns a deterministic
 * reading derived from the file name. The block that carries it is labelled as
 * prototype output, its confidence is stated per field, and — the part that
 * matters — **nothing it proposes is applied until a person continues to
 * Details and sees every value in an editable field.** A wizard that read a
 * scan and created a student from it would be treating a machine's guess as a
 * fact about a real person's record.
 *
 * Uploading is optional. A late admission or a transfer-in routinely arrives
 * before their paperwork, and blocking enrolment on a document would leave a
 * real student sitting in a class with no record at all. Skipping produces the
 * `Documents pending` state instead, which is a follow-up rather than a hold.
 */
export function AdmissionDocumentStep({ files, onAdd, onRemove, extraction, onExtract }) {
  const inputRef = useRef(null);

  return (
    <div className="flex flex-col gap-[14px]">
      <p className="m-0 text-[12.5px] text-ink-muted">
        Upload what the student has provided. Nothing here is required — a student can be
        admitted now and their documents added later.
      </p>

      <ul className="m-0 p-0 list-none flex flex-col gap-[7px]">
        {DOCUMENT_KINDS.map((kind) => {
          const file = files.find((f) => f.kind === kind.key);
          return (
            <li
              key={kind.key}
              className="flex items-center gap-[10px] px-[12px] py-[9px] border border-line rounded-[12px] bg-paper"
            >
              <FileText size={15} strokeWidth={1.8} aria-hidden="true" className="flex-none text-ink-faint" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] text-ink truncate">{kind.label}</span>
                {file ? (
                  <span className="block mt-[1px] text-[11px] text-ink-faint truncate">{file.name}</span>
                ) : (
                  <span className="block mt-[1px] text-[11px] text-ink-faint">Not uploaded</span>
                )}
              </span>
              {file ? (
                <button
                  type="button"
                  onClick={() => onRemove(kind.key)}
                  aria-label={`Remove ${kind.label}`}
                  className="flex-none w-[26px] h-[26px] grid place-items-center border-0 bg-transparent rounded-[8px] text-ink-faint cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink"
                >
                  <X size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    inputRef.current = kind.key;
                    // No file system in a prototype: the "upload" is a named
                    // stand-in, deterministic so the extraction below is too.
                    const name = `${kind.key}-scan.pdf`;
                    onAdd({ kind: kind.key, name });
                    if (kind.extracts) onExtract(extractFrom(name));
                  }}
                  className="flex-none inline-flex items-center gap-[5px] h-[26px] px-[9px] border border-line rounded-[8px] bg-paper font-sans text-[11.5px] font-[500] text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink"
                >
                  <Upload size={12} strokeWidth={2} aria-hidden="true" />
                  Upload
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {extraction && (
        <div className="px-[12px] py-[10px] rounded-[12px] bg-tint border border-line">
          <div className="flex items-center gap-[6px]">
            <Sparkles size={13} strokeWidth={1.9} aria-hidden="true" className="text-ink-faint" />
            <span className="text-[11px] font-[500] tracking-[.05em] uppercase text-ink-muted">
              Prototype extraction — not a real reading
            </span>
          </div>
          <p className="m-0 mt-[6px] text-[12px] text-ink-muted">
            These values are a mock, produced locally from the file name. They are proposals only:
            every one of them appears as an editable field on the next step, and nothing is saved
            until you have checked it.
          </p>
          <ul className="m-0 mt-[8px] p-0 list-none flex flex-wrap gap-x-[18px] gap-y-[4px]">
            {Object.entries(extraction.values)
              .filter(([, v]) => v)
              .map(([key, value]) => (
                <li key={key} className="text-[12px] text-ink-soft">
                  <span className="text-ink-faint">{key}:</span> {value}
                </li>
              ))}
          </ul>
        </div>
      )}

      <p className={cn('m-0 text-[12px] text-ink-faint')}>
        Continue without uploading and the student will be marked{' '}
        <span className="text-ink-soft">Documents pending</span> until their documents are added.
      </p>
    </div>
  );
}
