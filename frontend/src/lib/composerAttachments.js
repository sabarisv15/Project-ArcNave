/**
 * Composer attachments — the one place a file becomes an ArcNave attachment,
 * whatever door it came through.
 *
 * The clipboard, the file picker and a drag-drop all funnel into
 * `buildAttachment` and through the same validation, so a pasted screenshot
 * cannot bypass a limit the picker enforces. Attachments themselves live in
 * the caller's composer scope (`ComposerProvider`), never here — this module
 * is stateless, which is what keeps one composer's paste from being visible to
 * another.
 *
 * Client-side validation is a courtesy, not a control: it exists to fail fast
 * and explain why. The server still authorizes and re-validates every upload.
 */

/** Formats a browser can render inline and the API accepts. */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Document formats `aiService.js`'s `resolveChatAttachments` already
 * extracts text from server-side (`DOCUMENT_ATTACHMENT_MIME_TYPES`) — the
 * backend has supported these since the governed chat-attachment pass, this
 * list is what finally lets the composer offer them. Kept in the browser's
 * own MIME spelling; `EXTENSION_MIME_TYPES` below is the fallback for a
 * file whose OS/browser never registered one (chiefly `.md`, which reports
 * an empty `file.type` almost everywhere).
 */
export const ACCEPTED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.oasis.opendocument.text', // .odt
  'application/vnd.oasis.opendocument.spreadsheet', // .ods
  'text/markdown',
  'text/plain',
  'text/csv',
];

export const ACCEPTED_ATTACHMENT_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_DOCUMENT_TYPES];

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
/** Ten, because ten is what people actually paste — a set of screenshots from
 *  one session. The strip scrolls and the Attachment Manager lists them all;
 *  the limit is not there to keep the composer small. */
export const MAX_ATTACHMENTS = 10;

const EXTENSION = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Extension → MIME, used only when the browser handed back an empty or
 * generic `file.type` (routine for `.md`, and seen for `.csv`/`.odt`/`.ods`
 * on some OSes) — never as an override of a type the browser *did* supply.
 * Purely a client-side label: the upload route never trusts a declared
 * `mime_type` either way (`routes/documents.js` sniffs the real bytes), so
 * getting this exactly right only affects the local icon/validation, not
 * what the server accepts.
 */
const EXTENSION_MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
};

/** The best MIME type available for a candidate file — its own, or one
 *  inferred from the extension when the browser gave nothing usable. */
export function resolveAttachmentType(type, name = '') {
  if (ACCEPTED_ATTACHMENT_TYPES.includes(type)) return type;
  const ext = name.split('.').pop()?.toLowerCase();
  return (ext && EXTENSION_MIME_TYPES[ext]) || type;
}

export function isAcceptedImage(type) {
  return ACCEPTED_IMAGE_TYPES.includes(type);
}

export function isAcceptedAttachment(type) {
  return ACCEPTED_ATTACHMENT_TYPES.includes(type);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A clipboard image arrives with no name at all — `item.getAsFile()` returns
 * something called `image.png` at best and `blob` at worst. Naming it by the
 * moment it was pasted is the only thing that makes two screenshots in the
 * same conversation tellable apart later, in the files list or on the server.
 */
export function pastedImageName(type, now = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `pasted-image-${stamp}.${EXTENSION[type] ?? 'png'}`;
}

let seq = 0;
function nextId() {
  seq += 1;
  return `att-${Date.now().toString(36)}-${seq}`;
}

/**
 * Pulls every image out of a `paste` event, ignoring the text/* entries so
 * ordinary copied text keeps flowing to the textarea untouched.
 *
 * Both halves of the clipboard are read on purpose: `clipboardData.files` is
 * what a file manager copy populates, while `items` is what a screenshot tool
 * populates, and no single browser fills both consistently.
 */
export function imagesFromClipboard(clipboardData, now = new Date()) {
  if (!clipboardData) return [];
  const out = [];
  const seen = new Set();

  const take = (file, type) => {
    if (!file) return;
    // A blob is identified by shape, not identity — the same screenshot can
    // legitimately appear in `files` and `items` both.
    const fingerprint = `${type}:${file.size}:${file.lastModified ?? 0}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    const named =
      file.name && !/^(image|blob)\.?[a-z]*$/i.test(file.name)
        ? file.name
        : pastedImageName(type, now);
    out.push({ file, type, name: named });
  };

  for (const file of clipboardData.files ?? []) {
    if (isAcceptedImage(file.type)) take(file, file.type);
  }
  for (const item of clipboardData.items ?? []) {
    if (item.kind !== 'file' || !item.type?.startsWith('image/')) continue;
    take(item.getAsFile(), item.type);
  }
  return out;
}

/** True when the clipboard also carries text worth keeping in the textarea. */
export function clipboardHasText(clipboardData) {
  if (!clipboardData) return false;
  return Boolean(clipboardData.getData?.('text/plain'));
}

/**
 * One candidate → one attachment record, or a rejection with a reason the UI
 * can announce verbatim. `existingCount` is passed in rather than read from
 * anywhere, because the count that matters belongs to the calling scope.
 */
export function buildAttachment({ file, type, name }, existingCount) {
  const resolvedType = resolveAttachmentType(type, name);
  if (!isAcceptedAttachment(resolvedType)) {
    return { ok: false, reason: 'This file type is not supported.' };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: 'File exceeds the size limit.' };
  }
  if (existingCount >= MAX_ATTACHMENTS) {
    return { ok: false, reason: `You can attach up to ${MAX_ATTACHMENTS} files.` };
  }
  return {
    ok: true,
    attachment: {
      id: nextId(),
      name,
      type: resolvedType,
      size: file.size,
      // Only ever set for a real image — a document's object URL would just
      // be a broken <img>, so the strip/manager fall back to a file-type
      // glyph for anything else. Revoked when the attachment is removed or
      // the composer unmounts, so a long session can't leak object URLs.
      previewUrl: isAcceptedImage(resolvedType) ? previewUrlFor(file) : '',
      status: 'uploading', // uploading → ready | failed
      progress: 0,
      file,
    },
  };
}

/** Screen-reader wording for a batch, so the announcement matches the count. */
export function attachedAnnouncement(count) {
  if (count <= 0) return '';
  return count === 1 ? 'File attached' : `${count} files attached`;
}

/**
 * Object URLs are a browser affordance, not a guarantee — jsdom has no
 * `createObjectURL` at all. An attachment without a preview still uploads,
 * still sends and still lists; it just falls back to the file-type glyph.
 */
/**
 * Reads a File/Blob into a raw base64 string (no `data:...;base64,` prefix
 * — the backend's POST /documents/chat-attachments takes the same bare
 * base64 shape every other upload route in this app already uses).
 */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIndex = result.indexOf(',');
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function previewUrlFor(file) {
  try {
    return URL.createObjectURL(file);
  } catch {
    return '';
  }
}

export function releasePreview(attachment) {
  if (attachment?.previewUrl) {
    try {
      URL.revokeObjectURL(attachment.previewUrl);
    } catch {
      /* already revoked, or a browser that never issued one */
    }
  }
}
