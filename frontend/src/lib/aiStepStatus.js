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
  if (!step || step.phase !== 'running_tool') return null;
  const name = humanizeToolName(step.toolName);
  if (step.totalSteps > 1) {
    return `Step ${(step.stepIndex ?? 0) + 1} of ${step.totalSteps}: ${name}…`;
  }
  return `Running ${name}…`;
}
