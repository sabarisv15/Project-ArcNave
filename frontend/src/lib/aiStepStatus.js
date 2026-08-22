/**
 * Turns a real `step` SSE event (`aiService.js`'s own `onStep` — emitted
 * right before a tool actually runs, never a synthetic guess) into the
 * label `GenerationState` shows in place of the generic "Thinking…" —
 * the same idea as Claude Code's own status line naming the real thing
 * it's doing, not a spinner with no content.
 *
 * `toolName` is a registry name (`aiToolRegistry.js`), always snake_case —
 * humanized here rather than asking every tool to also carry a display
 * label, so a new tool is show-able the moment it's registered.
 */
function humanizeToolName(toolName = '') {
  const words = toolName.replace(/_nl$/, '').split('_').filter(Boolean);
  if (!words.length) return toolName;
  return words.join(' ').replace(/^./, (c) => c.toUpperCase());
}

export function stepStatusLabel(step) {
  if (!step) return null;
  if (step.phase === 'running_tool') {
    const name = humanizeToolName(step.toolName);
    if (step.totalSteps > 1) {
      return `Step ${(step.stepIndex ?? 0) + 1} of ${step.totalSteps}: ${name}…`;
    }
    return `Running ${name}…`;
  }
  // Fires once a tool (or every step of a plan) has already finished and
  // a separate LLM call is turning that result into the actual answer —
  // without this, the last 'running_tool' label (e.g. "Running Students
  // Roster…") stayed on screen for the whole synthesis call too, which
  // reads as stuck/stale once that tool is genuinely done.
  if (step.phase === 'synthesizing') return 'Putting the answer together…';
  // Fires before the tool-selection decision call itself — mainly so a
  // slow decision call is never silently unaccounted for, even though it
  // renders the same as the default "Thinking…" status today.
  if (step.phase === 'deciding') return 'Thinking…';
  return null;
}
