import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from '../hooks/useAutosave';
import { clearDraft, draftKey, listDrafts, readDraft, writeDraft } from '../lib/draftStore';

const KEY = draftKey('staff-me', 'test', 'rec-1');

afterEach(() => {
  clearDraft(KEY);
  vi.useRealTimers();
});

describe('draft store', () => {
  it('round-trips a value with a saved timestamp', () => {
    writeDraft(KEY, { topic: 'Deadlock' });
    const entry = readDraft(KEY);
    expect(entry.value).toEqual({ topic: 'Deadlock' });
    expect(entry.savedAt).toBeInstanceOf(Date);
  });

  it('returns null once cleared', () => {
    writeDraft(KEY, { topic: 'x' });
    clearDraft(KEY);
    expect(readDraft(KEY)).toBeNull();
  });

  it("lists a user's drafts of one kind, newest first", () => {
    writeDraft(draftKey('staff-me', 'test', 'a'), 1);
    writeDraft(draftKey('staff-me', 'test', 'b'), 2);
    writeDraft(draftKey('staff-other', 'test', 'c'), 3);
    const mine = listDrafts('staff-me', 'test');
    expect(mine.map((d) => d.id).sort()).toEqual(['a', 'b']);
    clearDraft(draftKey('staff-me', 'test', 'a'));
    clearDraft(draftKey('staff-me', 'test', 'b'));
    clearDraft(draftKey('staff-other', 'test', 'c'));
  });
});

describe('useAutosave', () => {
  it('debounces: one save for a burst of edits', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) => useAutosave({ value, onSave, storageKey: KEY, delay: 400 }),
      { initialProps: { value: 'a' } },
    );

    for (const v of ['ab', 'abc', 'abcd']) {
      rerender({ value: v });
      act(() => {
        result.current.schedule();
      });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('abcd');
  });

  it('mirrors locally straight away, before the debounce elapses', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useAutosave({ value, onSave: () => {}, storageKey: KEY, delay: 600 }),
      { initialProps: { value: 'draft text' } },
    );
    rerender({ value: 'draft text' });
    act(() => {
      result.current.schedule();
    });
    expect(readDraft(KEY).value).toBe('draft text');
  });

  it('flush saves immediately — the drawer-close path', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const { result } = renderHook(() => useAutosave({ value: 'x', onSave, storageKey: KEY, delay: 600 }));
    act(() => {
      result.current.schedule();
    });
    await act(async () => {
      await result.current.flush();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');
  });

  it('clears the local draft only once the save succeeds', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAutosave({ value: 'x', onSave: () => {}, storageKey: KEY, delay: 10 }));
    act(() => {
      result.current.schedule();
    });
    expect(readDraft(KEY)).not.toBeNull();
    await act(async () => {
      await result.current.flush();
    });
    expect(readDraft(KEY)).toBeNull();
  });

  it('keeps the draft recoverable when the save fails, and reports the error', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn(() => {
      throw new Error('offline');
    });
    const { result } = renderHook(() => useAutosave({ value: 'unsent', onSave, storageKey: KEY, delay: 10 }));
    act(() => {
      result.current.schedule();
    });
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.status).toBe('error');
    expect(readDraft(KEY).value).toBe('unsent');
  });

  it('retry re-sends the same draft and can succeed', async () => {
    vi.useFakeTimers();
    let fail = true;
    const onSave = vi.fn(() => {
      if (fail) throw new Error('offline');
    });
    const { result } = renderHook(() => useAutosave({ value: 'unsent', onSave, storageKey: KEY, delay: 10 }));
    act(() => {
      result.current.schedule();
    });
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.status).toBe('error');

    fail = false;
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.status).toBe('saved');
    expect(readDraft(KEY)).toBeNull();
  });

  it('markClean drops the draft — used after an explicit submit/publish', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAutosave({ value: 'x', onSave: () => {}, storageKey: KEY, delay: 600 }));
    act(() => {
      result.current.schedule();
    });
    act(() => {
      result.current.markClean();
    });
    expect(readDraft(KEY)).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('does nothing at all when disabled (published/locked records)', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn();
    const { result } = renderHook(() =>
      useAutosave({ value: 'x', onSave, storageKey: KEY, delay: 10, enabled: false }),
    );
    act(() => {
      result.current.schedule();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(readDraft(KEY)).toBeNull();
  });
});
