import { useCallback, useEffect, useRef, useState } from 'react';
import {
  attachedAnnouncement,
  buildAttachment,
  clipboardHasText,
  imagesFromClipboard,
  readFileAsBase64,
  releasePreview,
} from '../lib/composerAttachments';
import { aiApi } from '../api/ai';

/**
 * The upload pipeline behind every composer attachment.
 *
 * It drives the composer's *own* scope (`attachments` / `setAttachments` from
 * `useComposer`) rather than owning a list of its own — which is what keeps a
 * Home paste out of a project's composer. There is no shared list to leak
 * through, exactly as with composer text.
 *
 * Every write goes through the updater form of `setAttachments`, because
 * several uploads report progress on their own timers and two landing in the
 * same tick with captured copies of the array would drop one.
 *
 * runUpload is real: base64-encode the file, POST it to
 * aiApi.uploadAttachment (routes to DocumentService via
 * POST /documents/chat-attachments), and record the backend-issued
 * `serverId` on the attachment once it lands — that id, never the
 * locally-minted `att-...` one, is what a later send() forwards as an
 * `attachment_ids` entry. A rejected upload (oversized, malformed,
 * content that doesn't sniff as a real image) surfaces the server's own
 * `detail` message through the same failed/retry path the old mock
 * exercised, so that affordance stays genuinely reachable, not just
 * simulated.
 */

export function useComposerAttachments(composer) {
  const attachments = composer?.attachments ?? [];
  const setAttachments = composer?.setAttachments;

  // Announcements go through a live region rather than a toast: an attachment
  // is a change to the surface the user is already looking at, and a toast per
  // paste would be noise in a long prompt.
  const [announcement, setAnnouncement] = useState('');

  // Attachment ids to ignore once their in-flight upload settles — a route
  // change (or a manual remove()) can outlive the real network request, and
  // this is what stops a late resolve/reject from writing into a scope
  // nobody is looking at anymore (the real-upload equivalent of the old
  // mock's clearInterval-on-unmount).
  const cancelled = useRef(new Set());
  // Every object URL this composer minted, so none survives the composer.
  const previews = useRef(new Set());
  // The live list, readable from a callback without making it a dependency.
  const current = useRef(attachments);
  current.current = attachments;

  const patchOne = useCallback(
    (id, changes) => {
      setAttachments?.((list) => list.map((a) => (a.id === id ? { ...a, ...changes } : a)));
    },
    [setAttachments]
  );

  const runUpload = useCallback(
    (attachment) => {
      cancelled.current.delete(attachment.id);
      (async () => {
        try {
          const fileBase64 = await readFileAsBase64(attachment.file);
          const uploaded = await aiApi.uploadAttachment({
            fileBase64, fileName: attachment.name, mimeType: attachment.type,
          });
          if (cancelled.current.has(attachment.id)) return;
          // serverId is the backend-issued document id — the one a later
          // send() forwards as an attachment_ids entry; the local att-...
          // id stays the React key/removal handle and is never sent.
          patchOne(attachment.id, { status: 'ready', progress: 1, serverId: uploaded.id });
        } catch (err) {
          if (cancelled.current.has(attachment.id)) return;
          patchOne(attachment.id, { status: 'failed', progress: 0 });
          setAnnouncement(`${attachment.name} failed to upload.${err?.detail ? ` ${err.detail}` : ''}`);
        }
      })();
    },
    [patchOne]
  );

  // A route change unmounts the composer, possibly mid-upload. In-flight
  // uploads must not keep writing into a scope nobody is looking at, and
  // the preview URLs must not outlive it either.
  useEffect(() => {
    const cancelledSet = cancelled.current;
    const urls = previews.current;
    return () => {
      current.current.forEach((a) => cancelledSet.add(a.id));
      urls.forEach((url) => releasePreview({ previewUrl: url }));
      urls.clear();
    };
  }, []);

  /**
   * Candidates → validated attachments → uploads. Returns how many landed.
   *
   * Validation and object-URL creation happen *before* the state update, never
   * inside the updater: an updater has to stay pure, or StrictMode's double
   * invoke would mint two preview URLs and count each file twice. Reading the
   * current list from render state is safe here because pastes, picks and
   * drops are all user gestures and cannot land twice in one tick.
   */
  const addFiles = useCallback(
    (candidates) => {
      if (!setAttachments || !candidates?.length) return 0;

      const accepted = [];
      const rejections = [];

      for (const candidate of candidates) {
        const result = buildAttachment(candidate, current.current.length + accepted.length);
        if (result.ok) accepted.push(result.attachment);
        else if (!rejections.includes(result.reason)) rejections.push(result.reason);
      }

      if (accepted.length) setAttachments((list) => [...list, ...accepted]);

      accepted.forEach((a) => {
        if (a.previewUrl) previews.current.add(a.previewUrl);
        runUpload(a);
      });

      // One line, whatever happened: what landed, then the first reason
      // anything didn't. Reading six identical rejections aloud helps nobody.
      setAnnouncement(
        [attachedAnnouncement(accepted.length), rejections[0]].filter(Boolean).join('. ')
      );
      return accepted.length;
    },
    [runUpload, setAttachments]
  );

  /**
   * The composer's `paste` handler.
   *
   * It only calls `preventDefault` when the clipboard carries images *and* no
   * text — so a copied paragraph pastes normally, and a rich copy carrying
   * both keeps its text in the textarea while the image becomes an attachment.
   * Image binary never reaches the textarea either way, because the browser
   * does not insert a `kind: 'file'` item as text.
   */
  const handlePaste = useCallback(
    (event) => {
      const images = imagesFromClipboard(event.clipboardData);
      if (!images.length) return; // ordinary text paste — untouched
      if (!clipboardHasText(event.clipboardData)) event.preventDefault();
      addFiles(images);
    },
    [addFiles]
  );

  const remove = useCallback(
    (id) => {
      cancelled.current.add(id);
      const target = current.current.find((a) => a.id === id);
      if (target) {
        releasePreview(target);
        previews.current.delete(target.previewUrl);
      }
      setAttachments?.((list) => list.filter((a) => a.id !== id));
      setAnnouncement(target ? `${target.name} removed.` : 'Attachment removed.');
    },
    [setAttachments]
  );

  const retry = useCallback(
    (id) => {
      const target = current.current.find((a) => a.id === id);
      if (!target) return;
      patchOne(id, { status: 'uploading', progress: 0 });
      runUpload(target);
    },
    [patchOne, runUpload]
  );

  return {
    attachments,
    announcement,
    addFiles,
    handlePaste,
    remove,
    retry,
    /** True while anything is still in flight. */
    uploading: attachments.some((a) => a.status === 'uploading'),
  };
}
