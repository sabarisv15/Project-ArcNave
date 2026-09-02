import { Building2, Download, ExternalLink, FileText, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { DrawerRail, DrawerShell, GHOST_BTN, PRIMARY_BTN } from '@/components/ui/Drawer';

/**
 * Preview for a document source — the institutional and personal documents a
 * reply drew on.
 *
 * These are the two source kinds a reader most often needs to *check* rather
 * than merely see named, and until now they were the only ones a row could not
 * act on: a web source opened its page, an upload opened its preview URL, and a
 * policy the answer was built from was a dead line of text.
 *
 * It shows what the reply actually recorded about the reference — title, which
 * document estate it came from, where it was published from, and the clause or
 * section that was used — and nothing more. It deliberately does **not** invent
 * a size, a modified date, an owner or a page count: this is a source record,
 * not a file listing, and a preview that fills those fields in would be
 * inventing provenance rather than reporting it.
 *
 * Institutional documents say plainly that they are read-only, the same as they
 * do in Documents, instead of showing controls a staff member could never use.
 */
export function SourcePreviewDrawer({ source, open, onClose }) {
  if (!source) return null;

  const institutional = source.kind === 'institutional';
  const Icon = institutional ? Building2 : FileText;
  const kindLabel = institutional ? 'Institutional document' : 'Personal document';
  const contextLine = [kindLabel, source.origin].filter(Boolean).join(' · ');

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={source.title}
      contextLine={contextLine}
      description={`Preview of ${source.title}`}
      width="sm:w-[480px]"
    >
      <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] pt-[14px] pb-[16px]">
        {/* A representative preview surface, not a fake document renderer. */}
        <div className="grid place-items-center h-[170px] rounded-[14px] border border-line bg-paper">
          <div className="text-center">
            <Icon size={28} strokeWidth={1.6} className="mx-auto text-ink-ghost" aria-hidden="true" />
            <div className="mt-[8px] text-[12px] text-ink-faint">Preview</div>
          </div>
        </div>

        <div className="mt-[14px] rounded-[14px] border border-line bg-paper px-[13px] py-[4px]">
          <Row label="Name" value={source.title} />
          <Row label="Type" value={kindLabel} />
          <Row label={institutional ? 'Published by' : 'Location'} value={source.origin} />
          {/* The part of the document the reply used — the whole reason this
              reference is on the list. */}
          <Row label="Used" value={source.detail} />
        </div>

        {institutional && (
          <p className="flex items-start gap-[7px] mt-[12px] mb-0 text-[11.5px] text-ink-muted">
            <Lock size={13} strokeWidth={1.9} className="flex-none mt-[1px] text-ink-faint" aria-hidden="true" />
            Institutional documents are read-only — you can view and download them.
          </p>
        )}
      </div>

      <DrawerRail>
        <button type="button" className={GHOST_BTN} onClick={() => toast(`Opening ${source.title}`)}>
          <span className="inline-flex items-center gap-[6px]">
            <ExternalLink size={13} strokeWidth={2} />
            Open
          </span>
        </button>
        <button type="button" className={PRIMARY_BTN} onClick={() => toast(`Downloading ${source.title}`)}>
          <span className="inline-flex items-center gap-[6px]">
            <Download size={13} strokeWidth={2} />
            Download
          </span>
        </button>
      </DrawerRail>
    </DrawerShell>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-[10px] py-[7px] border-b border-line-lighter last:border-0">
      <span className="flex-none w-[104px] text-[11px] uppercase tracking-[.05em] text-ink-faint">{label}</span>
      <span className="min-w-0 flex-1 text-[12.5px] text-ink break-words">{value}</span>
    </div>
  );
}
