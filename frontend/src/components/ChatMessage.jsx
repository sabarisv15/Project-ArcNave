import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Pencil, Share2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { Markdown } from './Markdown';
import { CollapsibleContent } from './CollapsibleContent';
import { GenerationState, ANMessageMark } from './GenerationState';
import { CopyButton } from './ui/CopyButton';
import { iconFor } from './ComposerAttachmentStrip';
import { useRelativeTime } from '../hooks/useRelativeTime';
import { useTypewriter } from '../hooks/useTypewriter';
import { cn } from '../lib/utils';
import { formatBytes } from '../lib/composerAttachments';
import { downloadFile } from '../api/client';

const ACTION =
  'w-[26px] h-[26px] grid place-items-center border-0 bg-transparent rounded-[7px] text-ink-ghost cursor-pointer transition-colors duration-200 hover:bg-tint2 hover:text-ink-soft focus-visible:opacity-100';

/**
 * The row a message's actions live in.
 *
 * It holds its space unconditionally and reveals its controls on hover and on
 * keyboard focus, so nothing in the transcript moves when the pointer passes
 * over it. The timestamp is revealed by exactly the same gesture as Copy and
 * Edit: a message's age is worth having on demand, but fifty of them printed
 * down the side of a transcript is a column of noise nobody was reading.
 *
 * Revealed, not mounted — it is in the DOM at all times, only transparent, so
 * it costs no layout when it appears and a screen reader still announces it.
 * `<time>` carries the machine-readable instant; the visible text is always
 * relative, never a date.
 */
function MessageTimestamp({ message }) {
  const iso = message.editedAt || message.createdAt;
  const label = useRelativeTime(iso);
  if (!label) return null;

  return (
    <time dateTime={iso} className="text-[11.5px] font-[400] text-ink-faint whitespace-nowrap">
      {label}
      {message.editedAt && <span className="ml-[4px]"> · edited</span>}
    </time>
  );
}

/**
 * Compact response actions. No labels, no card, no repeated "AI" chrome, and
 * no three-dot menu — they appear on hover and on keyboard focus, and they
 * never push the next message down.
 */
function ResponseActions({ message }) {
  const [vote, setVote] = useState(null);

  return (
    // Seated directly under the last line of the reply — the actions belong to
    // the response above them, and a gap wide enough to read as blank space
    // makes them look like the start of the next one.
    <div className="flex items-center gap-[1px] mt-[1px] ml-[-4px]">
      <div className="flex items-center gap-[1px] opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
        <CopyButton
          getText={() => `${message.body}\n\n${message.closing ?? ''}`.trim()}
          label="Copy response"
          className={ACTION}
        />
        <button
          type="button"
          aria-label="Share response"
          title="Share"
          onClick={() => toast('Share link copied for this response.')}
          className={ACTION}
        >
          <Share2 size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Good response"
          aria-pressed={vote === 'up'}
          title="Good response"
          onClick={() => setVote((v) => (v === 'up' ? null : 'up'))}
          className={cn(ACTION, vote === 'up' && 'text-accent opacity-100')}
        >
          <ThumbsUp size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label="Poor response"
          aria-pressed={vote === 'down'}
          title="Poor response"
          onClick={() => setVote((v) => (v === 'down' ? null : 'down'))}
          className={cn(ACTION, vote === 'down' && 'text-accent opacity-100')}
        >
          <ThumbsDown size={14} strokeWidth={1.8} />
        </button>
        <span className="ml-[6px]">
          <MessageTimestamp message={message} />
        </span>
      </div>
    </div>
  );
}

/**
 * A sent message, reopened for editing in place.
 *
 * In place, not in the composer: the composer belongs to the *next* message,
 * and borrowing it to fix an old one means the draft you were writing has to
 * go somewhere. Editing here keeps the message in its position in the
 * conversation, which is also where its meaning is.
 *
 * The textarea opens with the exact original text — every character, every
 * line break, every markdown mark, so formatting survives a round trip
 * untouched — with the caret at the end. Escape cancels, Cmd/Ctrl+Enter saves,
 * and an empty edit is refused rather than silently deleting the message.
 */
function MessageEditor({ message, onSave, onCancel }) {
  const [draft, setDraft] = useState(message.text ?? '');
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, []);

  const grow = (el) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  };

  const dirty = draft.trim() !== (message.text ?? '').trim();
  const valid = Boolean(draft.trim());

  return (
    <div className="w-[min(70ch,100%)] max-w-full bg-accent-soft rounded-[12px] py-[8px] px-[11px]">
      <textarea
        ref={ref}
        aria-label="Edit your message"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          grow(e.target);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (valid) onSave(draft);
          }
        }}
        className="w-full block resize-none border-0 outline-none focus:outline-none focus-visible:outline-none bg-transparent font-chat text-[14.5px] leading-[1.48] text-ink scroll-quiet"
      />
      <div className="flex items-center justify-end gap-[6px] pt-[6px]">
        <button
          type="button"
          onClick={onCancel}
          className="h-[26px] px-[10px] rounded-[8px] border-0 bg-transparent text-[12px] font-[500] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-accent-soft2 hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => valid && onSave(draft)}
          disabled={!valid || !dirty}
          className="h-[26px] px-[11px] rounded-[8px] border-0 bg-accent text-[12px] font-[500] text-white cursor-pointer transition-colors duration-200 hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>
    </div>
  );
}

/**
 * A real, downloadable file a tool (generate_document/export_artifact —
 * aiService.js's own extractDocumentAttachment) just saved into the acting
 * user's own Documents, surfaced right where it was produced rather than
 * only in the Documents module the user would otherwise have to go find it
 * in. Download streams the real bytes (GET /documents/:id/download,
 * client.js's own downloadFile) — never a synthetic client-side blob of
 * whatever markdown happens to be in `message.body`, so this stays correct
 * even when the model's chat text differs from the saved file.
 */
function DocumentAttachmentCard({ document: doc }) {
  const [downloading, setDownloading] = useState(false);

  return (
    <div className="mt-[8px] flex items-center gap-[10px] w-[min(70ch,100%)] max-w-full px-[12px] py-[9px] border border-line rounded-[12px] bg-paper">
      <span className="flex-none w-[32px] h-[32px] grid place-items-center rounded-[9px] bg-accent-soft text-accent">
        <FileText size={15} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-[500] text-ink truncate" title={doc.fileName}>{doc.fileName}</span>
        <span className="block text-[11px] text-ink-faint">Saved to your Documents</span>
      </span>
      <button
        type="button"
        aria-label={`Download ${doc.fileName}`}
        title="Download"
        disabled={downloading}
        onClick={async () => {
          setDownloading(true);
          try {
            await downloadFile(`/documents/${doc.id}/download`, doc.fileName);
          } catch {
            toast('Could not download this file — please try again.');
          } finally {
            setDownloading(false);
          }
        }}
        className="flex-none inline-flex items-center gap-[6px] h-[30px] px-[11px] border-0 rounded-[9px] bg-accent text-white font-sans text-[12px] font-[500] cursor-pointer transition-colors duration-200 hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <Download size={13} strokeWidth={2} />
        {downloading ? 'Downloading…' : 'Download'}
      </button>
    </div>
  );
}

/**
 * True for the short moment right after a reply finishes generating.
 *
 * The Vel mark is a *loading* mark: it belongs to work in progress and to
 * nothing else. A settled reply gets one brief success settle and then the mark
 * is removed from the DOM entirely — twenty completed replies must not leave
 * twenty marks sitting in the transcript, animated or otherwise.
 */
function useJustFinished(generating, ms = 700) {
  const was = useRef(generating);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    if (was.current && !generating) {
      setSettling(true);
      const t = setTimeout(() => setSettling(false), ms);
      was.current = generating;
      return () => clearTimeout(t);
    }
    was.current = generating;
  }, [generating, ms]);

  return settling;
}

/**
 * A sent, non-image attachment (PDF/DOCX/XLSX/...) — the composer only
 * gives it a file-type glyph, never an `<img>` thumbnail, so the transcript
 * needs its own row: name, size, and a real Download hitting the same
 * `GET /documents/:id/download` route `DocumentAttachmentCard` uses.
 * `serverId` is the backend document id `useComposerAttachments` recorded
 * once the upload finished — the same id already sent as this message's
 * own `attachment_ids` entry, not a second reference.
 */
function SentFileChip({ attachment }) {
  const [downloading, setDownloading] = useState(false);
  const Icon = iconFor(attachment.type, attachment.name);

  return (
    <div className="flex items-center gap-[8px] w-[220px] max-w-full px-[9px] py-[7px] rounded-[10px] bg-tint2 border border-line">
      <span className="flex-none w-[28px] h-[28px] grid place-items-center rounded-[8px] bg-paper text-ink-ghost">
        <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] font-[500] text-ink-soft truncate" title={attachment.name}>
          {attachment.name}
        </span>
        <span className="block text-[10.5px] text-ink-faint">{formatBytes(attachment.size)}</span>
      </span>
      {attachment.serverId && (
        <button
          type="button"
          aria-label={`Download ${attachment.name}`}
          title="Download"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true);
            try {
              await downloadFile(`/documents/${attachment.serverId}/download`, attachment.name);
            } catch {
              toast('Could not download this file — please try again.');
            } finally {
              setDownloading(false);
            }
          }}
          className="flex-none w-[26px] h-[26px] grid place-items-center border-0 bg-transparent rounded-[7px] text-ink-muted cursor-pointer transition-colors duration-200 hover:bg-paper hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={13} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

export function ChatMessage({ message, selected = false, onSelect, onEdit }) {
  const settling = useJustFinished(Boolean(message.generating));
  const [editing, setEditing] = useState(false);
  // See useTypewriter's own file comment — smooths a bursty SSE chunk into
  // an actual typing motion. A no-op once generation is done: it renders
  // `message.body` immediately for any settled/history message.
  const displayedBody = useTypewriter(message.body ?? '', { active: Boolean(message.generating) });

  if (message.role === 'user') {
    const editable = typeof onEdit === 'function' && Boolean(message.text);

    return (
      <div className="group flex flex-col items-end gap-[4px]">
        {/* Sent attachments stay visible in the transcript, not just in the
            files list — otherwise a message reading "what's wrong with this?"
            loses the thing it was asking about. Same fixed geometry as the
            composer strip, so a sent image is recognisably the one attached.
            An edit never touches them: they belong to what was sent. */}
        {message.attachments?.length > 0 && (
          <div className="flex flex-wrap justify-end gap-[6px] max-w-[70%]">
            {message.attachments.map((a) =>
              a.previewUrl ? (
                <img
                  key={a.id}
                  src={a.previewUrl}
                  alt={a.name}
                  className="w-[72px] h-[72px] object-cover rounded-[8px] border border-line"
                />
              ) : (
                <SentFileChip key={a.id} attachment={a} />
              )
            )}
          </div>
        )}
        {editing ? (
          <MessageEditor
            message={message}
            onCancel={() => setEditing(false)}
            onSave={(next) => {
              // The message is replaced where it stands: same id, same
              // position, same attachments, no second message appended.
              if (onEdit(message.id, next) !== false) setEditing(false);
            }}
          />
        ) : (
          message.text && (
            // Structure the user pasted survives the send: real lists, real code,
            // real headings — and a very long message opens progressively rather
            // than filling the transcript on arrival. Differentiated by tone, not
            // by bulk: this is a quiet tinted block, not a second card.
            <div className="max-w-[70%] bg-accent-soft rounded-[12px] py-[6px] px-[11px]">
              <CollapsibleContent text={message.text} fadeClass="to-[rgb(var(--c-accent-soft))]" />
            </div>
          )
        )}

        {/* Edit and Copy, revealed by hover or keyboard focus — never a
            permanently visible control rail beside every sent line. */}
        {!editing && (
          <div className="flex items-center gap-[1px] mr-[-4px]">
            <div className="flex items-center gap-[1px] opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
              {editable && (
                <button
                  type="button"
                  aria-label="Edit message"
                  title="Edit"
                  onClick={() => setEditing(true)}
                  className={ACTION}
                >
                  <Pencil size={13} strokeWidth={1.8} />
                </button>
              )}
              <CopyButton getText={() => message.text ?? ''} label="Copy message" size={13} className={ACTION} />
              <span className="ml-[6px]">
                <MessageTimestamp message={message} />
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }

  const hasSources = !message.generating && message.sources?.length > 0;

  return (
    <div className="group flex flex-col items-start">
      <div className="flex gap-[10px] w-full">
        {/* The mark occupies the gutter only while it has something to say;
            the gutter itself stays reserved, so settled replies keep the same
            left edge as the one being generated. */}
        <div className="flex-none w-[22px]">
          {(message.generating || settling) && (
            <ANMessageMark generating={Boolean(message.generating)} settling={settling} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          {message.generating ? (
            // P0.5 (streaming): once the first real chunk has arrived,
            // message.body already holds the partial answer — show it
            // growing in place rather than a static skeleton for the
            // whole generation. Before the first chunk (still resolving
            // which tool to call, or none has arrived yet), body is
            // still empty and the skeleton is the honest state.
            message.body ? (
              <div className="py-[5px]">
                <Markdown>{displayedBody}</Markdown>
                {/* A blinking caret at the writing edge — the one thing that
                    still says "still typing" once useTypewriter has already
                    smoothed the text itself into a steady reveal. */}
                <span className="inline-block w-[2px] h-[15px] -mb-[2px] ml-px bg-ink-faint animate-caretBlink" aria-hidden="true" />
              </div>
            ) : (
              <GenerationState status={message.status} phase={message.stepPhase} />
            )
          ) : (
            <div
              // Selecting a reply is what scopes the Sources panel to it, and
              // that is now a state without a painted divider: the rule this
              // used to draw ran the full height of the reply, so on a long
              // answer it was a metre of line down the left of the text and a
              // permanent gutter reserved to hold it. The state itself is
              // unchanged — `aria-pressed`, click and Enter/Space still scope
              // the panel — it simply no longer costs the transcript a column.
              role={hasSources ? 'button' : undefined}
              tabIndex={hasSources ? 0 : undefined}
              aria-pressed={hasSources ? selected : undefined}
              aria-label={hasSources ? 'Show sources for this response' : undefined}
              onClick={hasSources ? () => onSelect?.(message.id) : undefined}
              onKeyDown={
                hasSources
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect?.(message.id);
                      }
                    }
                  : undefined
              }
              // A reply is text first: it is read and selected far more often
              // than it is clicked, so the whole container keeps the text
              // caret. A hand cursor over a paragraph promises a navigation
              // that isn't there and makes the copy look un-selectable. Only
              // real controls inside it — links, the actions row, code-block
              // copy, expand/collapse — take `cursor-pointer`.
              className={cn('py-[5px] cursor-text transition-colors duration-200')}
            >
              <Markdown>{message.body}</Markdown>
              {message.closing && (
                <p className="mt-[6px] mb-0 text-[14px] leading-[1.48] text-ink-muted">{message.closing}</p>
              )}
              {/* Deterministic backstop (aiService.askAgent's own comment) —
                  fires whenever an attached image existed but was never
                  actually shown to the configured AI model, independent of
                  whether the answer text above happens to mention it. */}
              {message.imageAnalysisUnavailable && (
                <p className="mt-[6px] mb-0 text-[13px] leading-[1.4] text-ink-faint">
                  The AI model configured for this college can't view images, so the attached photo was not analyzed.
                </p>
              )}
              {message.document && <DocumentAttachmentCard document={message.document} />}
            </div>
          )}
          {!message.generating && <ResponseActions message={message} />}
        </div>
      </div>
    </div>
  );
}
