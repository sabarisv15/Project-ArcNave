/**
 * The "is being scrolled right now" half of the auto-hiding scrollbar.
 *
 * Hover and keyboard focus are expressible in CSS alone; "the wheel is moving"
 * is not, so one capture-phase listener marks whichever scroll container the
 * event came from and unmarks it after a short idle. It is deliberately a
 * single delegated listener rather than a hook every scroll region has to
 * remember to call: scroll events don't bubble, but they do capture, so one
 * root listener sees every container in the app — including ones mounted later
 * in portals — and no component has to know this exists.
 *
 * Nothing here touches `overflow`, scroll position or event handling: the
 * class is cosmetic, and the styling that reads it lives in `index.css`.
 */

/** Long enough that a paused wheel doesn't flicker, short enough to stay quiet. */
const HIDE_DELAY_MS = 850;

const timers = new WeakMap();

/** Native overflow containers opt in with `scroll-quiet`; Radix viewports with `recents-viewport`. */
const MARKED = ['scroll-quiet', 'recents-viewport'];

function mark(el) {
  el.classList.add('is-scrolling');
  clearTimeout(timers.get(el));
  timers.set(
    el,
    setTimeout(() => {
      el.classList.remove('is-scrolling');
      timers.delete(el);
    }, HIDE_DELAY_MS),
  );
}

export function startAutoHideScrollbars(root = document) {
  const onScroll = (event) => {
    const el = event.target;
    if (!(el instanceof Element)) return; // document/window scroll — no thumb of ours
    if (MARKED.some((c) => el.classList.contains(c))) mark(el);
  };
  // Capture, because `scroll` does not bubble.
  root.addEventListener('scroll', onScroll, true);
  return () => root.removeEventListener('scroll', onScroll, true);
}
