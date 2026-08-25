import { describe, expect, it, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ComposerProvider, composerScope, isEmptyComposer, useComposer } from '../store/ComposerProvider';
import { draftKey, readDraft } from '../lib/draftStore';
import { ME } from '../lib/substituteData';

/**
 * The regression these lock down: a single global composer slot meant typing on
 * Home and then opening a project showed the Home text in the project composer.
 * Every assertion below is about one scope being unable to see another's state.
 */

const wrapper = ({ children }) => <ComposerProvider>{children}</ComposerProvider>;
const storageFor = (scope) => draftKey(ME.id, 'composer', scope);

/** One provider, two composers — exactly the "two surfaces mounted at once" case. */
function renderPair(keyA, keyB) {
  return renderHook(
    ({ a, b }) => ({ a: useComposer(a), b: useComposer(b) }),
    { wrapper, initialProps: { a: keyA, b: keyB } }
  );
}

beforeEach(() => {
  try { window.sessionStorage.clear(); } catch { /* storage unavailable — the store degrades to memory only */ }
});

describe('composer scope keys', () => {
  it('never produces the same key for two different surfaces', () => {
    const keys = [
      composerScope.home(),
      composerScope.chat('c1'),
      composerScope.chat('c2'),
      composerScope.project('p1', null),
      composerScope.project('p1', 'k9'),
      composerScope.project('p2', null),
      composerScope.artifactCreate('a1'),
      composerScope.artifactRevision('a1'),
      composerScope.artifactRevision('a2'),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives a project conversation its own key, distinct from the project’s first message', () => {
    expect(composerScope.project('p1', null)).not.toBe(composerScope.project('p1', 'k9'));
  });
});

describe('draft isolation', () => {
  it('does not leak Home text into a project composer', () => {
    const { result } = renderPair(composerScope.home(), composerScope.project('p1', null));
    act(() => result.current.a.setText('attendance summary for CSE'));
    expect(result.current.a.text).toBe('attendance summary for CSE');
    expect(result.current.b.text).toBe('');
  });

  it('keeps project A and project B apart', () => {
    const { result } = renderPair(composerScope.project('p1', null), composerScope.project('p2', null));
    act(() => result.current.a.setText('only for project A'));
    expect(result.current.b.text).toBe('');
  });

  it('keeps artifact A and artifact B revisions apart', () => {
    const { result } = renderPair(composerScope.artifactRevision('a1'), composerScope.artifactRevision('a2'));
    act(() => result.current.a.setText('tighten the closing paragraph'));
    expect(result.current.b.text).toBe('');
  });

  it('keeps chat A and chat B apart', () => {
    const { result } = renderPair(composerScope.chat('c1'), composerScope.chat('c2'));
    act(() => result.current.a.setText('reply in progress'));
    expect(result.current.b.text).toBe('');
  });

  it('isolates mode and attachments, not just text', () => {
    const { result } = renderPair(composerScope.home(), composerScope.artifactRevision('a1'));
    act(() => {
      result.current.a.setMode('curriculum');
      result.current.a.setAttachments([{ id: 'f1', name: 'roster.csv' }]);
    });
    expect(result.current.b.mode).toBe('general');
    expect(result.current.b.attachments).toEqual([]);
  });
});

describe('navigation between scopes', () => {
  it('restores only the scope being returned to', () => {
    const { result, rerender } = renderHook(({ k }) => useComposer(k), {
      wrapper,
      initialProps: { k: composerScope.project('p1', null) },
    });
    act(() => result.current.setText('draft for project A'));

    rerender({ k: composerScope.project('p2', null) }); // → project B
    expect(result.current.text).toBe('');

    rerender({ k: composerScope.artifactRevision('a1') }); // → an artifact
    expect(result.current.text).toBe('');

    rerender({ k: composerScope.project('p1', null) }); // → back to project A
    expect(result.current.text).toBe('draft for project A');
  });

  it('flushes a pending write to the scope that produced it, not the new one', () => {
    const aKey = composerScope.project('p1', null);
    const bKey = composerScope.project('p2', null);
    const { result, rerender } = renderHook(({ k }) => useComposer(k), { wrapper, initialProps: { k: aKey } });

    // Type and navigate away immediately — inside the debounce window.
    act(() => result.current.setText('typed then left at once'));
    rerender({ k: bKey });

    expect(readDraft(storageFor(aKey))?.value.text).toBe('typed then left at once');
    expect(readDraft(storageFor(bKey))).toBeNull();
    expect(result.current.text).toBe('');
  });

  it('does not restore a stored draft while the resource is unresolved', () => {
    const key = composerScope.project('p1', null);
    const { result, rerender } = renderHook(({ k, ok }) => useComposer(k, { canRestore: ok }), {
      wrapper,
      initialProps: { k: key, ok: true },
    });
    act(() => result.current.setText('saved for later'));
    act(() => result.current.flush());

    // A fresh mount that cannot yet read the resource must stay empty.
    const guarded = renderHook(({ k, ok }) => useComposer(k, { canRestore: ok }), {
      wrapper,
      initialProps: { k: key, ok: false },
    });
    expect(guarded.result.current.text).toBe('');
    rerender({ k: key, ok: true });
  });
});

describe('sending', () => {
  it('clears only the scope that sent', () => {
    const { result } = renderPair(composerScope.project('p1', 'k1'), composerScope.home());
    act(() => {
      result.current.a.setText('send me');
      result.current.b.setText('home draft stays');
    });
    act(() => result.current.a.reset());

    expect(result.current.a.text).toBe('');
    expect(result.current.b.text).toBe('home draft stays');
    expect(readDraft(storageFor(composerScope.project('p1', 'k1')))).toBeNull();
  });
});

describe('isEmptyComposer', () => {
  it('treats whitespace-only text with no attachments as empty', () => {
    expect(isEmptyComposer({ text: '   ', attachments: [], contextChips: [] })).toBe(true);
    expect(isEmptyComposer({ text: '', attachments: [{ id: 'f' }], contextChips: [] })).toBe(false);
    expect(isEmptyComposer(null)).toBe(true);
  });
});
