import { useCallback, useEffect, useRef, useState } from 'react';
import {
  attachedAnnouncement,
  buildAttachment,
  clipboardHasText,
  imagesFromClipboard,
  releasePreview,
} from '../lib/composerAttachments';

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
 * The upload is the mock the rest of this build uses: stepped progress that
 * occasionally fails, so the failed/retry path is genuinely reachable rather
 * than theoretical. Swapping in the real endpoint means replacing `runUpload`
 * and nothing else — the record shape, retry, announcements and draft
 * behaviour all stay put.
 */

const TICK_MS = 140;
const FAILURE_RATE = 0.08;

export function useComposerAttachments(composer) {
  const attachments = composer?.attachments ?? [];
  const setAttachments = composer?.setAttachments;

  // Announcements go through a live region rather than a toast: an attachment
  // is a change to the surface the user is already looking at, and a toast per
  // paste would be noise in a long prompt.
  const [announcement, setAnnouncement] = useState('');

  const timers = useRef(new Map());
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
      let progress = 0;
      const failAt = Math.random() < FAILURE_RATE ? 0.3 + Math.random() * 0.5 : null;

      const timer = setInterval(() => {
        progress = Math.min(1, progress + 0.12 + Math.random() * 0.1);

        if (failAt !== null && progress >= failAt) {
          clearInterval(timer);
          timers.current.delete(attachment.id);
          patchOne(attachment.id, { status: 'failed', progress: 0 });
          setAnnouncement(`${attachment.name} failed to upload.`);
          return;
        }
        if (progress >= 1) {
          clearInterval(timer);
          timers.current.delete(attachment.id);
          patchOne(attachment.id, { status: 'ready', progress: 1 });
          return;
        }
        patchOne(attachment.id, { progress });
      }, TICK_MS);

      timers.current.set(attachment.id, timer);
    },
    [patchOne]
  );

  // A route change unmounts the composer, possibly mid-upload. The intervals
  // must not outlive it and keep writing into a scope nobody is looking at,
  // and the preview URLs must not outlive it either.
  useEffect(() => {
    const running = timers.current;
    const urls = previews.current;
    return () => {
      running.forEach((t) => clearInterval(t));
      running.clear();
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
      const timer = timers.current.get(id);
      if (timer) {
        clearInterval(timer);
        timers.current.delete(id);
      }
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
