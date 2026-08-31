import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Markdown } from './Markdown';
import { cn } from '../lib/utils';
import { MESSAGE_PREVIEW_LINES, isLongContent, lineCountLabel, previewLines, showMoreLabel } from '../lib/longContent';

/**
 * A sent message that happens to be 271 lines long.
 *
 * The message keeps every character — this is disclosure, not truncation, and
 * the full text is what was sent to ArcNave. What changes is only how much of
 * it the transcript shows before the reader asks for the rest: a preview of the
 * first {@link MESSAGE_PREVIEW_LINES} lines, its real line count, and a button
 * naming the exact remainder. Expanded, it opens into a bounded scroll region
 * rather than pushing the rest of the conversation off the screen.
 *
 * Formatting survives both states: the preview is sliced by line and rendered
 * through the same Markdown renderer, with an unbalanced code fence closed so a
 * cut mid-block still reads as code.
 */
export function CollapsibleContent({ text, className, fadeClass = 'to-[rgb(var(--c-paper))]' }) {
  const [expanded, setExpanded] = useState(false);
  const long = isLongContent(text);

  if (!long) return <Markdown className={className}>{text}</Markdown>;

  const { preview, total, remaining } = previewLines(text, MESSAGE_PREVIEW_LINES);

  return (
    <div className="flex flex-col items-start gap-[6px] w-full">
      <div className={cn('relative w-full', expanded && 'max-h-[420px] overflow-y-auto scroll-quiet pr-[4px]')}>
        <Markdown className={className}>{expanded ? text : preview}</Markdown>
        {!expanded && (
          // Crop rather than cut: the last preview line fades out, so it is
          // obvious there is more without a hard edge implying an ending.
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 h-[26px] bg-gradient-to-b from-transparent',
              fadeClass,
            )}
          />
        )}
      </div>

      <div className="flex items-center gap-[8px]">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-[4px] border-0 bg-transparent p-0 text-[12.5px] font-[500] text-accent cursor-pointer hover:underline"
        >
          {expanded ? <ChevronUp size={13} strokeWidth={2} /> : <ChevronDown size={13} strokeWidth={2} />}
          {expanded ? 'Show less' : showMoreLabel(remaining)}
        </button>
        <span className="text-[11.5px] text-ink-faint tabular-nums">{lineCountLabel(total)}</span>
      </div>
    </div>
  );
}
