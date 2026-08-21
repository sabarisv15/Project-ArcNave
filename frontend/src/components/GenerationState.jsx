import { Terminal } from 'lucide-react';
import { ArcNaveVelMark } from './ArcNaveVelMark';

/**
 * Compact generation state — never a large loading panel, and deliberately no
 * generic spinner: the message's own Vel mark is already saying "thinking", so
 * a second circular indicator beside it would be the same information twice.
 * The status line stays plain text.
 *
 * `phase` (P1, from a real `step` SSE event — `lib/aiStepStatus.js`'s own
 * comment) swaps the plain label for one with a small glyph once ArcNave is
 * actually running something specific, the same "say the real thing, not a
 * generic spinner" idea Claude Code's own status line follows — never a
 * second animation competing with the Vel mark, just a static icon beside
 * text that is itself already changing.
 */
export function GenerationState({ status, phase }) {
  return (
    <span className="inline-flex items-center gap-[6px] text-[13.5px] text-ink-muted animate-pulseSoft">
      {phase === 'running_tool' && <Terminal size={13} strokeWidth={2} aria-hidden="true" />}
      {status}
    </span>
  );
}

/**
 * The mark beside an assistant message — and *only* while that message is
 * being produced.
 *
 * The rule this enforces: the Vel mark is a loading state, not a signature. It
 * animates while ArcNave is generating, plays exactly one success settle when
 * the reply lands, and is then removed from the transcript altogether by
 * `ChatMessage`. A settled reply carries no mark at all, so a long conversation
 * has at most one animating thing in it — the one that is actually running.
 */
export function ANMessageMark({ generating = false, settling = false }) {
  return (
    <ArcNaveVelMark
      size={22}
      state={generating ? 'thinking' : settling ? 'success' : 'static'}
      label={generating ? 'ArcNave is preparing a response' : undefined}
      className="mt-[2px] text-ink-soft"
    />
  );
}
