import { Download, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { DrawerRail, DrawerShell, PRIMARY_BTN } from '@/components/ui/Drawer';
import { DocumentIcon } from './DocumentIcon';
import { documentsApi } from '@/api/documents';
import { FILE_KINDS, fileKind, formatSize } from '../lib/documentsData';
import { formatDateDMY } from '@/lib/ist';

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-[10px] py-[7px] border-b border-line-lighter last:border-0">
      <span className="flex-none w-[104px] text-[11px] uppercase tracking-[.05em] text-ink-faint">{label}</span>
      <span className="min-w-0 flex-1 text-[12.5px] text-ink break-words">{value}</span>
    </div>
  );
}

/**
 * One viewer for both tabs — the *actions* differ, not the chrome.
 *
 * An institutional document is read-only here by construction: the drawer is
 * given no mutation callbacks at all, and says plainly why, rather than showing
 * greyed-out Rename/Delete controls a staff member could never use.
 */
export function DocumentPreviewDrawer({ open, onClose, doc }) {
  if (!doc) return null;

  const institutional = doc.scope === 'institutional';
  const kind = fileKind(doc.mimeType);
  const previewable = FILE_KINDS[kind]?.preview;

  const contextLine = institutional
    ? [doc.category, doc.department].filter(Boolean).join(' · ') || 'Institutional'
    : `${FILE_KINDS[kind]?.label ?? 'File'} · ${formatSize(doc.size)}`;

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={doc.name}
      contextLine={contextLine}
      description={`Preview of ${doc.name}`}
      width="sm:w-[520px]"
    >
      <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[18px] pt-[14px] pb-[16px]">
        {/* A representative preview surface, not a fake document renderer. */}
        <div className="grid place-items-center h-[190px] rounded-[14px] border border-line bg-paper">
          <div className="text-center">
            <DocumentIcon node={doc} size={30} />
            <div className="mt-[8px] text-[12px] text-ink-faint">
              {previewable ? 'Preview' : 'No inline preview for this file type'}
            </div>
          </div>
        </div>

        <div className="mt-[14px] rounded-[14px] border border-line bg-paper px-[13px] py-[4px]">
          <Row label="Name" value={doc.name} />
          <Row label="Type" value={FILE_KINDS[kind]?.label} />
          {institutional ? (
            <>
              <Row label="Category" value={doc.category} />
              <Row label="Department" value={doc.department} />
              <Row label="Status" value={doc.status} />
              <Row label="Uploaded" value={formatDateDMY(doc.publishedAt)} />
            </>
          ) : (
            <>
              <Row label="Modified" value={formatDateDMY(doc.updatedAt)} />
              <Row label="Created" value={formatDateDMY(doc.createdAt)} />
              <Row label="Owner" value="You" />
            </>
          )}
          <Row label="Size" value={formatSize(doc.size)} />
        </div>

        {institutional && (
          <p className="flex items-start gap-[7px] mt-[12px] mb-0 text-[11.5px] text-ink-muted">
            <Lock size={13} strokeWidth={1.9} className="flex-none mt-[1px] text-ink-faint" aria-hidden="true" />
            Institutional documents are read-only — you can view and download them.
          </p>
        )}
      </div>

      <DrawerRail>
        <button
          type="button"
          className={PRIMARY_BTN}
          onClick={() =>
            documentsApi.download(doc.id, doc.name).catch(() => toast(`Could not download “${doc.name}”.`))
          }
        >
          <span className="inline-flex items-center gap-[6px]">
            <Download size={13} strokeWidth={2} />
            Download
          </span>
        </button>
      </DrawerRail>
    </DrawerShell>
  );
}
