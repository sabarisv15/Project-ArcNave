import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  attachedAnnouncement,
  buildAttachment,
  clipboardHasText,
  imagesFromClipboard,
  isAcceptedImage,
  pastedImageName,
} from '../lib/composerAttachments';

/** A stand-in for the `File` a clipboard hands over. */
function blob({ size = 1024, type = 'image/png', name = '', lastModified = 1 } = {}) {
  return { size, type, name, lastModified };
}

function clipboard({ files = [], items = [], text = '' } = {}) {
  return {
    files,
    items,
    getData: (kind) => (kind === 'text/plain' ? text : ''),
  };
}

function imageItem(file, type = file.type) {
  return { kind: 'file', type, getAsFile: () => file };
}

describe('accepted types', () => {
  it('accepts the four image formats the composer can render', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(isAcceptedImage(type)).toBe(true);
    }
  });

  it('rejects non-images and image formats the API does not take', () => {
    for (const type of ['application/pdf', 'text/plain', 'image/tiff', 'image/svg+xml', '']) {
      expect(isAcceptedImage(type)).toBe(false);
    }
  });
});

describe('pastedImageName', () => {
  it('stamps the paste so two screenshots are tellable apart', () => {
    const at = new Date(2026, 7, 14, 9, 5, 3);
    expect(pastedImageName('image/png', at)).toBe('pasted-image-20260814-090503.png');
  });

  it('uses the extension matching the clipboard MIME type', () => {
    const at = new Date(2026, 0, 2, 0, 0, 0);
    expect(pastedImageName('image/jpeg', at)).toBe('pasted-image-20260102-000000.jpg');
    expect(pastedImageName('image/webp', at)).toBe('pasted-image-20260102-000000.webp');
  });
});

describe('imagesFromClipboard', () => {
  it('finds an image a screenshot tool put in items', () => {
    const file = blob({ type: 'image/png' });
    const found = imagesFromClipboard(clipboard({ items: [imageItem(file)] }));
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe('image/png');
  });

  it('finds an image a file-manager copy put in files', () => {
    const found = imagesFromClipboard(clipboard({ files: [blob({ type: 'image/jpeg', name: 'roster.jpg' })] }));
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('roster.jpg');
  });

  it('does not add the same image twice when both halves carry it', () => {
    // Chrome populates `files` and `items` for one screenshot; naively reading
    // both is how a single paste used to become two attachments.
    const file = blob({ type: 'image/png', size: 4096, lastModified: 77 });
    const found = imagesFromClipboard(clipboard({ files: [file], items: [imageItem(file)] }));
    expect(found).toHaveLength(1);
  });

  it('names an unnamed clipboard blob rather than leaving it "image.png"', () => {
    const at = new Date(2026, 7, 14, 12, 0, 0);
    const found = imagesFromClipboard(clipboard({ items: [imageItem(blob({ name: 'image.png' }))] }), at);
    expect(found[0].name).toBe('pasted-image-20260814-120000.png');
  });

  it('ignores plain text so an ordinary paste is untouched', () => {
    const text = { kind: 'string', type: 'text/plain', getAsFile: () => null };
    expect(imagesFromClipboard(clipboard({ items: [text], text: 'hello' }))).toHaveLength(0);
  });

  it('returns every image when several are pasted at once', () => {
    const found = imagesFromClipboard(
      clipboard({
        items: [
          imageItem(blob({ size: 10, lastModified: 1 })),
          imageItem(blob({ size: 20, lastModified: 2 })),
          imageItem(blob({ size: 30, lastModified: 3 })),
        ],
      })
    );
    expect(found).toHaveLength(3);
  });
});

describe('clipboardHasText', () => {
  it('is true only when there is text to preserve in the composer', () => {
    expect(clipboardHasText(clipboard({ text: 'see this' }))).toBe(true);
    expect(clipboardHasText(clipboard({ text: '' }))).toBe(false);
  });
});

describe('buildAttachment', () => {
  const png = { file: blob({ type: 'image/png', size: 2048 }), type: 'image/png', name: 'a.png' };

  it('produces an uploading record', () => {
    const result = buildAttachment(png, 0);
    expect(result.ok).toBe(true);
    expect(result.attachment.status).toBe('uploading');
    expect(result.attachment.progress).toBe(0);
    expect(result.attachment.name).toBe('a.png');
    expect(result.attachment.size).toBe(2048);
  });

  it('still builds a usable attachment where object URLs are unavailable', () => {
    // jsdom has no `createObjectURL`; so does an old or locked-down browser.
    // Losing the thumbnail must not lose the attachment.
    const result = buildAttachment(png, 0);
    expect(result.ok).toBe(true);
    expect(result.attachment.previewUrl).toBe('');
  });

  it('gives each attachment its own id', () => {
    const a = buildAttachment(png, 0).attachment;
    const b = buildAttachment(png, 1).attachment;
    expect(a.id).not.toBe(b.id);
  });

  it('rejects an unsupported type with the announced wording', () => {
    const result = buildAttachment({ ...png, type: 'image/tiff' }, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('This image type is not supported.');
  });

  it('rejects an oversized image', () => {
    const big = { ...png, file: blob({ type: 'image/png', size: MAX_ATTACHMENT_BYTES + 1 }) };
    const result = buildAttachment(big, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Image exceeds the size limit.');
  });

  it('enforces the count limit against what is already attached', () => {
    expect(buildAttachment(png, MAX_ATTACHMENTS - 1).ok).toBe(true);
    expect(buildAttachment(png, MAX_ATTACHMENTS).ok).toBe(false);
  });
});

describe('attachedAnnouncement', () => {
  it('matches the wording to the count', () => {
    expect(attachedAnnouncement(1)).toBe('Image attached');
    expect(attachedAnnouncement(3)).toBe('3 images attached');
    expect(attachedAnnouncement(0)).toBe('');
  });
});
