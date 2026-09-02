import { useState } from 'react';
import {
  AlertCircle,
  Code2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Paperclip,
  RotateCcw,
  X,
} from 'lucide-react';
import { AttachmentManager } from './AttachmentManager';
import { cn } from '../../../lib/utils';

/**
 * The attachment tray — a fixed-height region that sits **above** the composer
 * surface, behind its own hairline, never inside the input's border.
 *
 * Two rules it exists to enforce:
 *
 *  - **A tile is 72px, always.** Not larger because there is one attachment,
 *    not smaller because there are ten, and never stretched to fill the width.
 *    Attaching a file changes whether the tray is there and nothing else about
 *    the composer's geometry.
 *  - **Nothing attached is unreachable.** Three tiles are shown; past three the
 *    fourth becomes `+N` and opens the Attachment Manager, which lists every
 *    file with its size, status, Remove, Retry and Open. The count beside the
 *    tray states the real total, so "three" is never mistaken for "all".
 *
 * Upload state, retry, validation, draft persistence and scope isolation all
 * belong to the composer's attachment pipeline; this is the view of them.
 */

/** Beyond this the tray stops adding tiles and hands over to the manager. */
const VISIBLE_TILES = 3;

/** 72px nominal, 64px on mobile — inside the 64–80px band, never a function of the count. */
const TILE = 'w-[64px] h-[64px] sm:w-[72px] sm:h-[72px]';
/** The band the tiles sit in — fixed, so the composer never moves under them. */
const TRAY = 'h-[80px] sm:h-[88px]';

/** The glyph stands for what the file *is*, so a CSV is not just "a file".
 *  Exported: ChatMessage.jsx's sent-attachment chip uses the same mapping,
 *  so a document reads as the same kind of thing in the tray and the
 *  transcript. */
export function iconFor(type = '', name = '') {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (type.startsWith('image/')) return ImageIcon;
  if (ext === 'csv' || ext === 'tsv') return Paperclip;
  if (['xlsx', 'xls', 'ods'].includes(ext)) return FileSpreadsheet;
  if (['js', 'jsx', 'ts', 'tsx', 'json', 'py', 'sql', 'html', 'css'].includes(ext)) return Code2;
  return FileText;
}

function extensionOf(name = '') {
  const ext = name.split('.').pop();
  return ext && ext !== name ? `.${ext.toLowerCase()}` : '';
}

function Tile({ attachment, onRemove, onRetry }) {
  const failed = attachment.status === 'failed';
  const uploading = attachment.status === 'uploading';
  const isImage = Boolean(attachment.previewUrl);
  const Icon = iconFor(attachment.type, attachment.name);
  const ext = extensionOf(attachment.name);

  return (
    <li className="group/tile relative flex-none">
      <button
        type="button"
        // The tile is the preview control: opening the file is the obvious
        // thing to want from a thumbnail, and it is the only way to check what
        // a `pasted-image-*` actually is before sending it.
        onClick={() => attachment.previewUrl && window.open(attachment.previewUrl, '_blank', 'noopener')}
        aria-label={`Preview ${attachment.name}`}
        title={attachment.name}
        className={cn(
          TILE,
          'relative block p-0 overflow-hidden rounded-[8px] bg-paper border cursor-pointer',
          'transition-shadow duration-200 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
          failed ? 'border-danger/40' : 'border-line hover:border-accent-line',
        )}
      >
        {isImage ? (
          // An image's own content is its best identifier — the glyph would
          // tell the reader only what they already know.
          <img
            src={attachment.previewUrl}
            alt=""
            className={cn('w-full h-full object-cover', uploading && 'opacity-55')}
          />
        ) : (
          <span className="w-full h-full flex flex-col items-center justify-center gap-[3px] px-[4px] bg-soft">
            <Icon size={17} strokeWidth={1.7} className="text-ink-ghost" aria-hidden="true" />
            <span className="max-w-full text-[9px] leading-[1.15] text-ink-faint truncate">{attachment.name}</span>
          </span>
        )}

        {ext && (
          <span className="absolute bottom-[3px] left-[3px] px-[3px] py-px rounded-[3px] bg-paper/85 text-[8.5px] font-[500] leading-none text-ink-faint">
            {ext}
          </span>
        )}

        {failed && (
          <span className="absolute inset-0 grid place-items-center bg-danger-soft">
            <AlertCircle size={15} strokeWidth={2} className="text-danger" aria-hidden="true" />
          </span>
        )}

        {uploading && (
          // A determinate bar, not a spinner: the user needs to know whether
          // waiting will help, and by how much.
          <span className="absolute inset-x-[5px] bottom-[5px] h-[3px] rounded-full bg-paper/70 overflow-hidden">
            <span
              role="progressbar"
              aria-label={`Uploading ${attachment.name}`}
              aria-valuenow={Math.round((attachment.progress ?? 0) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ width: `${Math.round((attachment.progress ?? 0) * 100)}%` }}
              className="block h-full bg-accent transition-[width] duration-150 ease-out"
            />
          </span>
        )}
      </button>

      {/* Revealed on hover and on keyboard focus — and unconditionally where
          there is no hover to reveal it, because an attachment a touch user
          cannot remove is worse than one they cannot see.

          Inset rather than protruding: `overflow-x-auto` on the scroller
          implies `overflow-y: auto`, so anything hanging outside the tile is
          clipped the moment the tray scrolls. */}
      <span
        className={cn(
          'absolute top-[4px] right-[4px] flex items-center gap-[2px] transition-opacity duration-200',
          'opacity-0 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100',
          '[@media(hover:none)]:opacity-100',
        )}
      >
        {failed && (
          <button
            type="button"
            aria-label={`Retry uploading ${attachment.name}`}
            title="Retry"
            onClick={() => onRetry(attachment.id)}
            className="w-[19px] h-[19px] grid place-items-center border border-line bg-paper rounded-full text-ink-muted cursor-pointer transition-colors duration-200 hover:text-ink-soft"
          >
            <RotateCcw size={11} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          aria-label={`Remove ${attachment.name}`}
          title={`Remove ${attachment.name}`}
          onClick={() => onRemove(attachment.id)}
          className="w-[19px] h-[19px] grid place-items-center border border-line bg-paper rounded-full text-ink-muted cursor-pointer transition-colors duration-200 hover:text-danger"
        >
          <X size={11} strokeWidth={2.2} />
        </button>
      </span>
    </li>
  );
}

export function ComposerAttachmentStrip({ attachments, onRemove, onRetry }) {
  const [managerOpen, setManagerOpen] = useState(false);
  const total = attachments?.length ?? 0;

  if (!total) return null;

  const overflow = total > VISIBLE_TILES;
  const shown = overflow ? attachments.slice(0, VISIBLE_TILES) : attachments;
  const hidden = total - shown.length;
  const countLabel = `${total} ${total === 1 ? 'attachment' : 'attachments'}`;

  return (
    <>
      <div
        className={cn(
          TRAY,
          // Its own region above the composer, marked off by one hairline and
          // the quiet grouped surface — its own bounds, its own padding, no
          // shared border with the input.
          'shrink-0 flex items-center gap-[10px] mb-[8px] p-[8px] rounded-[10px] bg-surface border-b border-line-light',
          'animate-fadeUp motion-reduce:animate-none',
        )}
      >
        <ul
          tabIndex={0}
          aria-label={countLabel}
          className="flex-1 min-w-0 flex items-center gap-[8px] m-0 p-0 list-none overflow-x-auto overflow-y-hidden scroll-quiet rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {shown.map((a) => (
            <Tile key={a.id} attachment={a} onRemove={onRemove} onRetry={onRetry} />
          ))}

          {overflow && (
            <li className="flex-none">
              <button
                type="button"
                aria-label={`Show all ${countLabel}`}
                title={`Show all ${countLabel}`}
                onClick={() => setManagerOpen(true)}
                className={cn(
                  TILE,
                  'grid place-items-center rounded-[8px] border border-line bg-soft font-sans text-[14px] font-[600] text-ink-soft tabular-nums cursor-pointer',
                  'transition-colors duration-200 hover:bg-tint2 hover:border-accent-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                )}
              >
                +{hidden}
              </button>
            </li>
          )}
        </ul>

        {/* The count is stated, not implied by however many tiles fit, and it
            is a second way into the full list. */}
        <button
          type="button"
          onClick={() => setManagerOpen(true)}
          aria-label={`Manage ${countLabel}`}
          className="flex-none border-0 bg-transparent p-0 font-sans text-[11.5px] font-[500] text-ink-faint cursor-pointer tabular-nums hover:text-accent hover:underline"
        >
          {countLabel}
        </button>
      </div>

      <AttachmentManager
        open={managerOpen}
        onOpenChange={setManagerOpen}
        attachments={attachments}
        onRemove={onRemove}
        onRetry={onRetry}
      />
    </>
  );
}
