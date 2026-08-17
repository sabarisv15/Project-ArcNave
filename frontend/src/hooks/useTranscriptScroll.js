import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Anchors to the newest response while the user is near the bottom, never force-scrolls
 * them back down after they scroll up, and surfaces "Jump to latest" only when needed.
 */
export function useTranscriptScroll(messages) {
  const ref = useRef(null);
  const anchored = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el && anchored.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = useCallback((e) => {
    const el = e.currentTarget;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    anchored.current = near;
    setShowJump(!near);
  }, []);

  const jumpToLatest = useCallback(() => {
    anchored.current = true;
    const el = ref.current;
    // Smooth on the way back down — the reader chose to travel, and an instant
    // jump loses where they came from. Re-anchoring after new messages stays
    // instant (above), because there is no journey to show there.
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowJump(false);
  }, []);

  return { ref, onScroll, showJump, jumpToLatest, anchor: () => (anchored.current = true) };
}
