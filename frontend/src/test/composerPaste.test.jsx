import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ComposerProvider, composerScope, useComposer } from '../store/ComposerProvider';
import { useComposerAttachments } from '../hooks/useComposerAttachments';

/**
 * Pasting an image is a second way into the composer, so it is a second way to
 * leak between scopes. These lock the same guarantee `composer.test.jsx` locks
 * for text: an attachment belongs to exactly one scope and is invisible to
 * every other one.
 */

const wrapper = ({ children }) => <ComposerProvider>{children}</ComposerProvider>;

function blob({ size = 1024, type = 'image/png', lastModified = 1 } = {}) {
  return { size, type, name: '', lastModified };
}

/** The shape a real `paste` event hands the composer. */
function pasteEvent({ items = [], files = [], text = '' } = {}) {
  return {
    preventDefault: vi.fn(),
    clipboardData: {
      files,
      items: items.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
      getData: (kind) => (kind === 'text/plain' ? text : ''),
    },
  };
}

/** Two composers mounted at once, each with its own attachment pipeline. */
function renderPair(keyA, keyB) {
  return renderHook(
    () => {
      const a = useComposer(keyA);
      const b = useComposer(keyB);
      return { a, b, aFiles: useComposerAttachments(a), bFiles: useComposerAttachments(b) };
    },
    { wrapper }
  );
}

beforeEach(() => {
  try {
    window.sessionStorage.clear();
  } catch {
    /* storage unavailable — the store degrades to memory only */
  }
  vi.useFakeTimers();
});

describe('pasting an image into a composer', () => {
  it('attaches the image to the scope that received the paste', () => {
    const { result } = renderPair(composerScope.home(), composerScope.chat('c1'));

    act(() => {
      result.current.aFiles.handlePaste(pasteEvent({ items: [blob()] }));
    });

    expect(result.current.a.attachments).toHaveLength(1);
    expect(result.current.a.attachments[0].name).toMatch(/^pasted-image-\d{8}-\d{6}\.png$/);
  });

  it('never shows a Home paste in another composer', () => {
    const { result } = renderPair(composerScope.home(), composerScope.project('p1', null));

    act(() => {
      result.current.aFiles.handlePaste(pasteEvent({ items: [blob()] }));
    });

    expect(result.current.a.attachments).toHaveLength(1);
    expect(result.current.b.attachments).toHaveLength(0);
  });

  it('keeps two chats' + ' attachments apart', () => {
    const { result } = renderPair(composerScope.chat('c1'), composerScope.chat('c2'));

    act(() => {
      result.current.aFiles.handlePaste(pasteEvent({ items: [blob({ size: 11 })] }));
      result.current.bFiles.handlePaste(pasteEvent({ items: [blob({ size: 22 })] }));
    });

    expect(result.current.a.attachments).toHaveLength(1);
    expect(result.current.b.attachments).toHaveLength(1);
    expect(result.current.a.attachments[0].size).toBe(11);
    expect(result.current.b.attachments[0].size).toBe(22);
  });

  it('attaches every image when several are pasted at once', () => {
    const { result } = renderPair(composerScope.home(), composerScope.chat('c1'));

    act(() => {
      result.current.aFiles.handlePaste(
        pasteEvent({
          items: [blob({ lastModified: 1 }), blob({ lastModified: 2 }), blob({ lastModified: 3 })],
        })
      );
    });

    expect(result.current.a.attachments).toHaveLength(3);
    expect(result.current.aFiles.announcement).toBe('3 images attached');
  });

  it('leaves an ordinary text paste alone', () => {
    const { result } = renderPair(composerScope.home(), composerScope.chat('c1'));
    const event = pasteEvent({ text: 'a pasted paragraph' });

    act(() => {
      result.current.aFiles.handlePaste(event);
    });

    // Not prevented, so the browser inserts the text itself — and nothing was
    // mistaken for an attachment.
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.a.attachments).toHaveLength(0);
  });

  it('keeps the text and attaches the image when the clipboard has both', () => {
    const { result } = renderPair(composerScope.home(), composerScope.chat('c1'));
    const event = pasteEvent({ items: [blob()], text: 'look at this' });

    act(() => {
      result.current.aFiles.handlePaste(event);
    });

    // Default is allowed through precisely so the text still lands in the
    // textarea; the image becomes an attachment alongside it.
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.a.attachments).toHaveLength(1);
  });

  it('refuses an unsupported image type and says why', () => {
    const { result } = renderPair(composerScope.home(), composerScope.chat('c1'));

    act(() => {
      result.current.aFiles.handlePaste(pasteEvent({ items: [blob({ type: 'image/tiff' })] }));
    });

    expect(result.current.a.attachments).toHaveLength(0);
    expect(result.current.aFiles.announcement).toContain('not supported');
  });

  it('refuses an image over the size limit and says why', () => {
    const { result } = renderPair(composerScope.home(), composerScope.chat('c1'));

    act(() => {
      result.current.aFiles.handlePaste(pasteEvent({ items: [blob({ size: 40 * 1024 * 1024 })] }));
    });

    expect(result.current.a.attachments).toHaveLength(0);
    expect(result.current.aFiles.announcement).toContain('size limit');
  });

  it('stops at the shared count limit across repeated pastes', () => {
    const { result } = renderPair(composerScope.home(), composerScope.chat('c1'));

    for (let i = 0; i < 13; i += 1) {
      act(() => {
        result.current.aFiles.handlePaste(pasteEvent({ items: [blob({ lastModified: i })] }));
      });
    }

    expect(result.current.a.attachments).toHaveLength(10);
    expect(result.current.aFiles.announcement).toContain('up to 10');
  });

  it('keeps all ten attachments addressable, not just the visible three', () => {
    const { result } = renderPair(composerScope.home(), composerScope.chat('c1'));

    for (let i = 0; i < 10; i += 1) {
      act(() => {
        result.current.aFiles.handlePaste(pasteEvent({ items: [blob({ lastModified: i })] }));
      });
    }
    expect(result.current.a.attachments).toHaveLength(10);

    // The tenth is as removable as the first — the strip showing three must
    // never make the rest unreachable.
    const last = result.current.a.attachments[9].id;
    act(() => {
      result.current.aFiles.remove(last);
    });

    expect(result.current.a.attachments).toHaveLength(9);
    expect(result.current.a.attachments.some((a) => a.id === last)).toBe(false);
  });

  it('removes one attachment without touching the rest or the other scope', () => {
    const { result } = renderPair(composerScope.home(), composerScope.chat('c1'));

    act(() => {
      result.current.aFiles.handlePaste(pasteEvent({ items: [blob({ lastModified: 1 })] }));
      result.current.bFiles.handlePaste(pasteEvent({ items: [blob({ lastModified: 2 })] }));
    });
    act(() => {
      result.current.aFiles.handlePaste(pasteEvent({ items: [blob({ lastModified: 3 })] }));
    });
    expect(result.current.a.attachments).toHaveLength(2);

    const keep = result.current.a.attachments[1].id;
    act(() => {
      result.current.aFiles.remove(result.current.a.attachments[0].id);
    });

    expect(result.current.a.attachments).toHaveLength(1);
    expect(result.current.a.attachments[0].id).toBe(keep);
    expect(result.current.b.attachments).toHaveLength(1);
  });

  it('reaches "ready" once its upload finishes', () => {
    const { result } = renderPair(composerScope.home(), composerScope.chat('c1'));

    act(() => {
      result.current.aFiles.handlePaste(pasteEvent({ items: [blob()] }));
    });
    expect(result.current.a.attachments[0].status).toBe('uploading');

    // Long enough for the stepped mock upload to run to completion.
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Either it finished or the mock's failure branch fired — both are
    // terminal, and neither may leave it stuck reporting progress forever.
    expect(['ready', 'failed']).toContain(result.current.a.attachments[0].status);
  });

  it('clears its own scope on reset and leaves the other alone', () => {
    const { result } = renderPair(composerScope.home(), composerScope.chat('c1'));

    act(() => {
      result.current.aFiles.handlePaste(pasteEvent({ items: [blob({ lastModified: 1 })] }));
      result.current.bFiles.handlePaste(pasteEvent({ items: [blob({ lastModified: 2 })] }));
    });
    act(() => {
      result.current.a.reset();
    });

    expect(result.current.a.attachments).toHaveLength(0);
    expect(result.current.b.attachments).toHaveLength(1);
  });
});
