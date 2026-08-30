import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, ChevronUp, Mic, Paperclip } from 'lucide-react';
import { ScopeToggle } from './ScopeToggle';
import { ThinkingLevelToggle } from './ThinkingLevelToggle';
import { ComposerAttachmentStrip } from './ComposerAttachmentStrip';
import { IconButton } from './ui/IconButton';
import { useComposerAttachments } from '../hooks/useComposerAttachments';
import { useSpeechToText } from '../hooks/useSpeechToText';
import { ACCEPTED_ATTACHMENT_TYPES } from '../lib/composerAttachments';
import { markdownFromClipboard } from '../lib/richPaste';
import { countLines, isLongContent, lineCountLabel, showMoreLabel } from '../lib/longContent';
import { cn, hasTypedContent } from '../lib/utils';

/**
 * Two composers, one component.
 *
 * `start` is the empty-chat composer — Home, a project with no conversation
 * yet. It may be prominent, because it is the only thing on the screen asking
 * for input.
 *
 * `chat` is the composer of a running conversation. Once a transcript exists,
 * the composer is no longer the subject of the page; it is the tool at the
 * bottom of it, and it must not eat the conversation it belongs to. It docks
 * compact and stays compact — the previous build kept the large start-state
 * height after the first send, which is the specific thing this split fixes.
 *
 * Both are bounded. The text area grows to the variant's ceiling and then
 * scrolls internally with the control row still in place, so a long prompt is
 * always editable and Send never leaves the viewport. A long paste expands only
 * its own bounded region, never the composer without limit.
 *
 * Attachments are not part of the composer surface at all: `ComposerAttachmentStrip`
 * is a sibling above it with its own fixed height, so the count of attached
 * files has no effect on the composer's geometry.
 */
const HEIGHTS = {
  //           resting  ceiling  collapsed-preview ceiling for a long paste
  start: { min: 96, max: 160, preview: 116 },
  chat: { min: 56, max: 116, preview: 80 },
};

/** Matches the textarea's 14px/1.55 — used to state how much of a long paste is visible. */
const LINE_HEIGHT = 22;

export const AIComposer = forwardRef(function AIComposer(
  { value, onChange, onSend, mode, onMode, thinkingLevel, onThinkingLevel, placeholder, variant = 'start', minHeight, className, bare = false, composer },
  ref
) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const caret = useRef(null);
  const canSend = hasTypedContent(value);

  const { min, max, preview } = HEIGHTS[variant] ?? HEIGHTS.start;
  const restingHeight = minHeight ?? min;

  const { attachments, announcement, addFiles, handlePaste, remove, retry } =
    useComposerAttachments(composer);

  // Voice input (P1.4) — appends each finished phrase to whatever is already
  // typed, with a separating space/newline only when the existing text
  // doesn't already end in one, so voice and typing can be freely mixed in
  // one message rather than voice always overwriting or always requiring a
  // fresh line.
  const speech = useSpeechToText({
    onResult: (chunk) => {
      const needsSeparator = value.length > 0 && !/[\s\n]$/.test(value);
      onChange(`${value}${needsSeparator ? ' ' : ''}${chunk}`);
    },
  });

  /* ---- long paste: bounded preview, never a truncated value ---- */

  const [expanded, setExpanded] = useState(false);
  const long = isLongContent(value);
  const collapsed = long && !expanded;
  const ceiling = collapsed ? preview : max;
  const totalLines = long ? countLines(value) : 0;
  const visibleLines = Math.max(1, Math.floor(preview / LINE_HEIGHT));
  const remaining = Math.max(totalLines - visibleLines, 0);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  // Measured, not guessed: reset to `auto` first so the scroll height reflects
  // the content shrinking as well as growing, then clamp to this state's
  // ceiling. The growth itself is not transitioned — animating a height that
  // changes on every keystroke is what makes a composer feel laggy.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, restingHeight), ceiling);
    el.style.height = `${next}px`;
    // Collapsed, the overflow is hidden behind the fade and reached through
    // "Show more"; expanded, it scrolls in place.
    el.style.overflowY = collapsed ? 'hidden' : el.scrollHeight > ceiling ? 'auto' : 'hidden';
  }, [restingHeight, ceiling, collapsed]);

  // Runs on every value change, including ones this composer did not originate
  // — a restored draft or an Ideas prompt has to size the box too.
  useEffect(resize, [value, resize]);

  // A rich paste rewrites the whole value, so the caret has to be put back
  // where the inserted text ended rather than at the end of the document.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || caret.current == null) return;
    const at = caret.current;
    caret.current = null;
    el.selectionStart = at;
    el.selectionEnd = at;
  }, [value]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  /**
   * Paste, in one place, in this order:
   *  1. images become attachments (the existing pipeline, unchanged);
   *  2. whatever formatting the clipboard's `text/html` carried is converted to
   *     Markdown, sanitized through an allowlist, and inserted at the caret;
   *  3. anything else is left to the browser, which pastes the plain text with
   *     its own undo stack intact.
   */
  const onPaste = (event) => {
    if (composer) handlePaste(event);
    if (event.defaultPrevented) return;

    const markdown = markdownFromClipboard(event.clipboardData);
    if (!markdown) return; // plain text — the browser handles it

    event.preventDefault();
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    caret.current = start + markdown.length;
    onChange(`${value.slice(0, start)}${markdown}${value.slice(end)}`);
    // A long paste always arrives collapsed, whatever the previous state was.
    setExpanded(false);
  };

  const pickFiles = (fileList) => {
    const candidates = Array.from(fileList ?? []).map((file) => ({
      file,
      type: file.type,
      name: file.name,
    }));
    if (candidates.length) addFiles(candidates);
  };

  const attachable = Boolean(composer);

  // Drag-and-drop (P1.5) — the natural companion to the file picker above,
  // same `pickFiles`/`addFiles` pipeline, no separate upload path. A counter
  // rather than a plain boolean for enter/leave: dragging over a child
  // element (the textarea, the attachment strip) fires leave-then-enter on
  // the parent, and a plain boolean would flicker the highlight off between
  // those two events.
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepth = useRef(0);
  const onDragEnter = (e) => {
    if (!attachable || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragOver(true);
  };
  const onDragOver = (e) => {
    if (!attachable || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
  };
  const onDragLeave = (e) => {
    if (!attachable) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragOver(false);
  };
  const onDrop = (e) => {
    if (!attachable) return;
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragOver(false);
    pickFiles(e.dataTransfer.files);
  };

  return (
    <div className={cn('w-full relative z-[3] flex flex-col', className)}>
      {/* Above the surface, not inside it: the strip owns a fixed band of its
          own, so the composer's own height stays a function of the text and
          nothing else. */}
      {attachable && (
        <ComposerAttachmentStrip attachments={attachments} onRemove={remove} onRetry={retry} />
      )}

      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'pt-[12px] pr-[12px] pb-[8px] pl-[14px] transition-colors duration-200',
          bare
            ? 'bg-paper rounded-[14px] border border-transparent focus-within:border-accent-line'
            // One matte white surface lifted out of the off-white ground by a
            // single hairline and a 6% shadow. Focus warms that hairline to the
            // accent rather than adding a second, brighter shell around the
            // composer — there is no permanent teal rectangle at any point.
            : 'bg-paper border border-line rounded-[16px] shadow-composer transition-shadow focus-within:border-accent-line focus-within:shadow-[0_2px_14px_rgba(0,0,0,.08)]',
          // The dock's own settle plays on the first render after a send; it is
          // opacity and offset only, and reduced motion drops it entirely.
          variant === 'chat' && 'animate-composerDock motion-reduce:animate-none',
          // Drag-and-drop (P1.5) — the same accent used for keyboard focus
          // above, so a file drag reads as "this surface is about to accept
          // something," consistent with the composer's own focus language.
          isDragOver && 'border-accent-line shadow-[0_2px_14px_rgba(0,0,0,.08)]'
        )}
      >
        <div className="relative">
          <textarea
            ref={textareaRef}
            aria-label="Message ArcNave"
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder}
            style={{ minHeight: restingHeight }}
            // The typed value is chat content, so it is set in the reading face
            // — what you write here is what you will read in the transcript.
            // The composer's own chrome around it stays interface font.
            className="w-full block border-0 outline-none focus:outline-none focus-visible:outline-none resize-none bg-transparent font-chat text-[14px] leading-[1.5] text-ink scroll-quiet"
          />
          {collapsed && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-[24px] bg-gradient-to-b from-transparent to-[rgb(var(--c-paper))]"
            />
          )}
        </div>

        {long && (
          // Disclosure only: the value above is the complete paste, and it is
          // the complete paste that gets sent.
          <div className="flex items-center gap-[8px] pb-[8px]">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-[4px] border-0 bg-transparent p-0 font-sans text-[12px] font-[500] text-accent cursor-pointer hover:underline"
            >
              {expanded ? <ChevronUp size={12} strokeWidth={2} /> : <ChevronDown size={12} strokeWidth={2} />}
              {expanded ? 'Show less' : showMoreLabel(remaining)}
            </button>
            <span className="text-[11px] text-ink-faint tabular-nums">{lineCountLabel(totalLines)}</span>
          </div>
        )}

        <div className="flex items-center gap-[10px] pt-[6px]">
          {attachable && (
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_ATTACHMENT_TYPES.join(',')}
              className="hidden"
              onChange={(e) => {
                pickFiles(e.target.files);
                // Cleared so picking the same file twice in a row still fires.
                e.target.value = '';
              }}
            />
          )}
          <IconButton
            label="Attach files"
            tooltip="Attach files"
            onClick={attachable ? () => fileInputRef.current?.click() : undefined}
            className="w-[32px] h-[32px] rounded-[9px] text-ink-muted"
          >
            <Paperclip size={17} strokeWidth={1.75} />
          </IconButton>

          <ScopeToggle mode={mode} onMode={onMode} />
          {onThinkingLevel && <ThinkingLevelToggle level={thinkingLevel} onLevel={onThinkingLevel} />}

          <div className="flex-1" />

          <span className="text-[13px] text-ink-faint tracking-[.01em]">Auto</span>

          {speech.supported && (
            <IconButton
              label={speech.listening ? 'Stop voice input' : 'Voice input'}
              tooltip={speech.listening ? 'Listening… click to stop' : 'Voice input'}
              onClick={speech.toggle}
              aria-pressed={speech.listening}
              className={cn(
                'w-[32px] h-[32px] rounded-[9px]',
                speech.listening ? 'text-accent animate-pulse' : 'text-ink-muted'
              )}
            >
              <Mic size={17} strokeWidth={1.75} />
            </IconButton>
          )}

          <button
            type="button"
            aria-label="Send message"
            disabled={!canSend}
            onClick={() => canSend && onSend()}
            className={cn(
              'w-[32px] h-[32px] grid place-items-center border-0 rounded-[10px] bg-accent text-white transition-[opacity,transform] duration-200 ease-out',
              canSend
                ? 'opacity-100 translate-y-0 scale-100 cursor-pointer hover:bg-accent-hover active:bg-accent-press'
                : 'opacity-0 translate-y-[6px] scale-90 pointer-events-none'
            )}
          >
            <ArrowUp size={17} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Attaching happens without focus moving anywhere, so the result has to
          be spoken. Polite, because it never interrupts something the user is
          in the middle of reading. */}
      {attachable && (
        <span aria-live="polite" className="sr-only">
          {announcement}
        </span>
      )}
    </div>
  );
});
