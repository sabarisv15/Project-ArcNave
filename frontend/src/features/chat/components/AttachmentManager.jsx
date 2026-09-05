import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, ExternalLink, FileText, RotateCcw, X } from 'lucide-react';
import { formatBytes } from '../../../lib/composerAttachments';
import { cn } from '../../../lib/utils';

/**
 * Every file currently attached to this composer — all of them, always.
 *
 * The composer strip is a fixed-height band that scrolls sideways, so every
 * attachment is reachable there too; this is the second route to the same set,
 * opened from the strip's count, and the guarantee that nothing attached is
 * ever unreachable. An out-of-view attachment is still uploaded, still sent and
 * still billed for context, so "it scrolled off" is not an acceptable end state
 * for it.
 *
 * One row per file: thumbnail (or the file glyph when a preview URL could not
 * be minted), name, size, upload state, and the two actions that matter —
 * Remove always, Retry when the upload failed. Preview opens the local object
 * URL in a new tab where the browser supports it.
 *
 * Scope is inherited, not chosen: it renders the list handed to it by one
 * composer, so a Home paste is not visible here from a project chat.
 */
/**
 * Status copy follows ai-chat-file-intelligence-router-approved-spec.md's
 * own recommended language ("Ready for AI analysis" / "Processing
 * failed", never "100% accurate" / "AI verified"). `processingStatus`
 * only ever carries the values the backend can actually return today
 * (uploaded/ready/failed/blocked) — this function is written to also
 * recognize the richer async vocabulary (queued/processing/needs_review)
 * the spec defines, so the UI does not need another change the day a
 * future slice wires up real async processing (audio/video transcode,
 * provider indexing) — those branches are simply unreachable until then,
 * not dead code guessing at a shape that doesn't exist.
 */
function statusLabel(attachment, uploading, failed) {
  if (uploading) return `Uploading ${Math.round((attachment.progress ?? 0) * 100)}%`;
  if (failed) return 'Processing failed';
  switch (attachment.processingStatus) {
    case 'validating':
      return 'Validating file';
    case 'queued':
      return 'Queued';
    case 'processing':
      return 'Processing';
    case 'needs_review':
      return `${formatBytes(attachment.size)} · Needs review`;
    case 'blocked':
      return 'File type is not supported for AI analysis';
    default:
      return `${formatBytes(attachment.size)} · Ready for AI analysis`;
  }
}

export function AttachmentManager({ open, onOpenChange, attachments, onRemove, onRetry }) {
  const total = attachments?.length ?? 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-overlay/15 animate-fadeUp motion-reduce:animate-none" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 right-0 z-[101] w-[min(380px,92vw)] flex flex-col',
            'bg-raised border-l border-line-strong rounded-l-[20px] shadow-pop outline-none',
            'data-[state=open]:animate-railIn motion-reduce:animate-none',
          )}
        >
          <div className="shrink-0 flex items-center gap-[8px] px-[16px] pt-[16px] pb-[10px]">
            <Dialog.Title className="flex-1 m-0 text-[14px] font-[600] text-ink-soft">Attachments</Dialog.Title>
            {/* The count is stated, not implied by however many rows fit. */}
            <span className="text-[11.5px] text-ink-faint tabular-nums">
              {total} {total === 1 ? 'attachment' : 'attachments'}
            </span>
            <Dialog.Close
              aria-label="Close attachments"
              className="flex-none w-[28px] h-[28px] grid place-items-center border-0 bg-transparent rounded-[8px] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink-soft"
            >
              <X size={15} strokeWidth={1.9} />
            </Dialog.Close>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-[9px] pb-[16px]">
            {total === 0 ? (
              <p className="px-[7px] py-[8px] m-0 text-[12.5px] text-ink-faint">
                Nothing attached yet. Attach a file, or paste an image, in the composer.
              </p>
            ) : (
              <ul className="flex flex-col gap-[2px] m-0 p-0 list-none">
                {attachments.map((a) => {
                  const failed = a.status === 'failed';
                  const uploading = a.status === 'uploading';

                  return (
                    <li key={a.id} className="group flex items-center gap-[10px] p-[7px] rounded-[10px] hover:bg-tint2">
                      <span className="relative flex-none w-[36px] h-[36px] rounded-[8px] overflow-hidden bg-tint2 grid place-items-center">
                        {a.previewUrl ? (
                          <img
                            src={a.previewUrl}
                            alt=""
                            className={cn('w-full h-full object-cover', uploading && 'opacity-55')}
                          />
                        ) : (
                          <FileText size={15} strokeWidth={1.8} className="text-ink-ghost" aria-hidden="true" />
                        )}
                        {failed && (
                          <span className="absolute inset-0 grid place-items-center bg-danger-soft">
                            <AlertCircle size={15} strokeWidth={2} className="text-danger" aria-hidden="true" />
                          </span>
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-[500] text-ink-soft truncate" title={a.name}>
                          {a.name}
                        </span>
                        <span className="block text-[11px] text-ink-faint">{statusLabel(a, uploading, failed)}</span>
                      </span>

                      {a.previewUrl && !failed && (
                        <button
                          type="button"
                          aria-label={`Open ${a.name}`}
                          title="Open"
                          onClick={() => window.open(a.previewUrl, '_blank', 'noopener')}
                          className="flex-none w-[26px] h-[26px] grid place-items-center border-0 bg-transparent rounded-[7px] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-soft hover:text-ink-soft"
                        >
                          <ExternalLink size={14} strokeWidth={1.8} />
                        </button>
                      )}
                      {failed && (
                        <button
                          type="button"
                          aria-label={`Retry uploading ${a.name}`}
                          title="Retry"
                          onClick={() => onRetry(a.id)}
                          className="flex-none w-[26px] h-[26px] grid place-items-center border-0 bg-transparent rounded-[7px] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-soft hover:text-ink-soft"
                        >
                          <RotateCcw size={14} strokeWidth={1.9} />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${a.name}`}
                        title="Remove"
                        onClick={() => onRemove(a.id)}
                        className="flex-none w-[26px] h-[26px] grid place-items-center border-0 bg-transparent rounded-[7px] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-soft hover:text-danger"
                      >
                        <X size={14} strokeWidth={2} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
