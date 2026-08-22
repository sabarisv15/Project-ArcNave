import { describe, expect, it } from 'vitest';
import { stepStatusLabel } from '../lib/aiStepStatus';

describe('stepStatusLabel', () => {
  it('returns null for no step', () => {
    expect(stepStatusLabel(null)).toBe(null);
    expect(stepStatusLabel(undefined)).toBe(null);
  });

  it('humanizes a single-tool running_tool step', () => {
    expect(stepStatusLabel({ phase: 'running_tool', toolName: 'students_roster', stepIndex: 0, totalSteps: 1 })).toBe(
      'Running Students roster…'
    );
  });

  it('shows a step-of-total label for a multi-step plan', () => {
    expect(
      stepStatusLabel({
        phase: 'running_tool', toolName: 'attendance_summary', stepIndex: 1, totalSteps: 3,
      })
    ).toBe('Step 2 of 3: Attendance summary…');
  });

  // Fired once a tool (or every step of a plan) has already finished
  // and a separate LLM call is turning the result into the actual
  // answer — without a distinct label here, the last running_tool
  // label stayed on screen through that second call too, reading as
  // stuck even though the tool itself was long done.
  it('shows a distinct label once synthesizing the final answer', () => {
    expect(stepStatusLabel({ phase: 'synthesizing', toolName: 'students_roster' })).toBe('Putting the answer together…');
  });

  it('shows a label for the initial tool-selection decision', () => {
    expect(stepStatusLabel({ phase: 'deciding' })).toBe('Thinking…');
  });

  it('returns null for an unrecognized phase', () => {
    expect(stepStatusLabel({ phase: 'something_else' })).toBe(null);
  });
});
