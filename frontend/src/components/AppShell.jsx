import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { PanelLeftOpen } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { ScheduleDrawer } from './ScheduleDrawer';
import { ProfileDrawer } from './ProfileDrawer';
import { SidebarRevealHint, hasAcknowledgedRevealHint } from './SidebarRevealHint';
import { ErrorBoundary } from './ErrorBoundary';
import { isCurriculumPath } from './SidebarNavigation';
import { CurriculumFullscreenHint, hasSeenCurriculumHintToday } from './CurriculumFullscreenHint';
import { useWorkspace } from '../store/WorkspaceProvider';
import { cn } from '../lib/utils';

/** Hover intent before revealing, and a grace period before closing again. */
const OPEN_DELAY_MS = 130;
const CLOSE_DELAY_MS = 210;
/** Matches the `railOut` exit slide, so the panel leaves after it has played. */
const EXIT_MS = 170;

/**
 * The left edge trigger for a hidden sidebar: one transparent strip pinned to
 * the whole left edge, top to bottom, so the reveal works from any height
 * rather than from a single hotspot. It is only 18px wide and only exists
 * while the sidebar is hidden, so it never swallows clicks meant for the
 * workspace. It is a real focusable button, so hover is not the only way in.
 */
function EdgeTrigger({ onReveal, onCancel, onOpenNow }) {
  return (
    <button
      type="button"
      aria-label="Open sidebar"
      title="Open sidebar"
      onMouseEnter={onReveal}
      onMouseLeave={onCancel}
      onFocus={onOpenNow}
      onClick={onOpenNow}
      className="hidden lg:block fixed left-0 top-0 bottom-0 z-[70] w-[18px] border-0 p-0 bg-transparent cursor-pointer outline-none group"
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-1/2 -translate-y-1/2 h-[64px] w-[3px] rounded-r-full bg-transparent transition-colors duration-200 group-hover:bg-accent-line group-focus-visible:bg-accent"
      />
    </button>
  );
}

/**
 * Sidebar + workspace.
 *
 * A **pinned** sidebar is a real flex child: it takes layout width and the
 * workspace reflows beside it, so it can never overlap content. An **overlay**
 * sidebar is fixed above the workspace and reserves no width. **Hidden**
 * reserves nothing at all and leaves only the edge trigger. That is the whole
 * difference between the three modes — there is no separate "collapsed width".
 *
 * Shape follows mode: a docked rail is straight and flush to all three edges,
 * the temporary overlay is the rounded floating panel, and the rounded surface
 * in the normal composition is the workspace itself, inset from the app frame.
 */
export function AppShell() {
  const { sidebarMode, revealSidebar, hideOverlay, collapseSidebar, activeWorkspaceMode, setActiveWorkspaceMode } =
    useWorkspace();
  const [mobileNav, setMobileNav] = useState(false);
  const [overlayClosing, setOverlayClosing] = useState(false);
  const [revealHint, setRevealHint] = useState(false);
  const [curriculumHint, setCurriculumHint] = useState(false);
  const openTimer = useRef(null);
  const closeTimer = useRef(null);
  const exitTimer = useRef(null);

  // Route → mode, on real navigations only. This component never unmounts, so
  // toggling Home/Curriculum (which changes no route) can never be undone by a
  // remount, and the toggle stays the sole owner of the mode between routes.
  const { pathname } = useLocation();
  const lastPath = useRef(null); // null so a deep link resolves its mode on mount
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    // `/department` is the HOD seat's own root but is still the Curriculum
    // context, so the predicate is shared with the sidebar rather than repeated.
    setActiveWorkspaceMode(isCurriculumPath(pathname) ? 'curriculum' : 'home');
  }, [pathname, setActiveWorkspaceMode]);

  /*
   * The discovery hint, triggered by the *transition into* `hidden` rather
   * than by the state itself — reloading on a collapsed sidebar is not a
   * collapse, and should not re-teach something already learned. A ref of the
   * previous mode is what draws that distinction; reading `sidebarMode` alone
   * cannot.
   *
   * `hasAcknowledgedRevealHint` is consulted at the moment of the collapse,
   * not on mount, so acknowledging it in another tab takes effect here too.
   */
  const prevSidebarMode = useRef(sidebarMode);
  useEffect(() => {
    const wasVisible = prevSidebarMode.current !== 'hidden';
    prevSidebarMode.current = sidebarMode;
    if (sidebarMode !== 'hidden' || !wasVisible) return;
    if (hasAcknowledgedRevealHint()) return;
    setRevealHint(true);
  }, [sidebarMode]);

  // Revealing the rail answers the question the hint was asking.
  useEffect(() => {
    if (revealHint && sidebarMode !== 'hidden') setRevealHint(false);
  }, [revealHint, sidebarMode]);

  /*
   * The Curriculum full-screen offer: once per user per calendar day, on the
   * first move into Curriculum — whether that was the sidebar toggle or a deep
   * link straight onto a Curriculum route. Leaving Curriculum takes it down.
   *
   * It is never raised while the sidebar is already hidden: that *is* full
   * screen, and offering it there would be advice the user has already taken.
   */
  useEffect(() => {
    if (activeWorkspaceMode !== 'curriculum') {
      setCurriculumHint(false);
      return;
    }
    if (sidebarMode === 'hidden') return;
    if (hasSeenCurriculumHintToday()) return;
    setCurriculumHint(true);
  }, [activeWorkspaceMode, sidebarMode]);

  const clearTimers = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  useEffect(
    () => () => {
      clearTimers();
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    [],
  );

  const openOverlay = () => {
    clearTimers();
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    setOverlayClosing(false);
    revealSidebar();
  };

  const scheduleReveal = () => {
    clearTimers();
    openTimer.current = setTimeout(openOverlay, OPEN_DELAY_MS);
  };

  // The overlay plays its exit slide before it is actually removed, so closing
  // reads as the reverse of opening instead of a disappearance.
  const closeOverlay = () => {
    if (exitTimer.current) return;
    setOverlayClosing(true);
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      setOverlayClosing(false);
      hideOverlay();
    }, EXIT_MS);
  };

  // Moving from the edge strip into the revealed sidebar crosses a gap; the
  // close is delayed and cancelled on re-entry so that never flickers shut.
  const scheduleClose = () => {
    clearTimers();
    closeTimer.current = setTimeout(closeOverlay, CLOSE_DELAY_MS);
  };

  useEffect(() => {
    if (sidebarMode !== 'overlay') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeOverlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarMode, hideOverlay]);

  return (
    <div className="flex h-full w-full bg-frame overflow-hidden font-sans text-ink">
      {/* Pinned: a real layout column, so the workspace reflows beside it. */}
      {sidebarMode === 'pinned' && (
        <div className="hidden lg:block shrink-0 w-[282px] h-full">
          <Sidebar />
        </div>
      )}

      {sidebarMode === 'hidden' && (
        <EdgeTrigger onReveal={scheduleReveal} onCancel={clearTimers} onOpenNow={openOverlay} />
      )}

      {revealHint && <SidebarRevealHint onDismiss={() => setRevealHint(false)} />}

      {curriculumHint && (
        <CurriculumFullscreenHint onGoFullScreen={collapseSidebar} onDismiss={() => setCurriculumHint(false)} />
      )}

      {/* Overlay: fixed above the workspace, reserving no layout width. */}
      {sidebarMode === 'overlay' && (
        <>
          <div
            aria-hidden="true"
            onClick={closeOverlay}
            className="hidden lg:block fixed inset-0 z-[88] bg-overlay/10"
          />
          <div
            onMouseEnter={clearTimers}
            onMouseLeave={scheduleClose}
            className={cn(
              'hidden lg:block fixed left-0 top-0 bottom-0 z-[90] w-[282px]',
              overlayClosing ? 'animate-railOut' : 'animate-railIn',
              'motion-reduce:animate-none',
            )}
          >
            <Sidebar floating />
          </div>
        </>
      )}

      {/* Mobile: always a drawer — never persistent layout width. */}
      <Dialog.Root open={mobileNav} onOpenChange={setMobileNav}>
        <Dialog.Portal>
          <Dialog.Overlay className="lg:hidden fixed inset-0 z-[80] bg-overlay/15 animate-fadeUp" />
          <Dialog.Content
            aria-label="Sidebar navigation"
            className="lg:hidden fixed inset-y-0 left-0 z-[81] w-[282px] outline-none data-[state=open]:animate-railIn motion-reduce:animate-none"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- this onClick only ever fires via bubbling from Sidebar's own real links/buttons (native click events also fire when those are keyboard-activated), never as a direct interaction with this div; Dialog.Root also already provides Escape/focus-trap dismissal */}
            <div className="h-full" onClick={() => setMobileNav(false)}>
              <Sidebar floating />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/*
        The workspace is an independent rounded island floating on the shared
        app ground, and it is the only real surface in the shell — the rail
        sits directly on that same ground with no background and no divider of
        its own, so nothing behind the chrome reads as two competing panels.

        The island keeps the same 10px inset on all four sides in every sidebar
        mode, docked included — that even margin is what makes the rounded
        shape legible, and it is small enough never to read as a gap. Because
        the ground on every side of it is one colour, the only edge anywhere in
        the shell is the island's own. Whatever width the rail is not using,
        the island takes; collapsing the sidebar simply hands it that space
        with its corners intact.
      */}
      <main
        className={cn(
          'relative flex-1 min-w-0 flex flex-col bg-paper overflow-hidden',
          'm-[8px] lg:m-[10px] rounded-[22px] border border-divider shadow-island',
        )}
      >
        <button
          type="button"
          aria-label="Open sidebar"
          title="Open sidebar"
          onClick={() => setMobileNav(true)}
          className="lg:hidden absolute top-[14px] left-[14px] z-20 w-[32px] h-[32px] grid place-items-center rounded-[9px] bg-paper border border-line text-ink-soft cursor-pointer transition-colors duration-200 hover:bg-tint2"
        >
          <PanelLeftOpen size={17} strokeWidth={1.8} />
        </button>

        {/* P4 5.12 — keyed on the route path: a crash on one page must not
            keep showing its fallback after the user navigates elsewhere.
            React remounts (clearing any caught error) whenever this key
            changes; `pathname` is already read above for the sidebar. */}
        <ErrorBoundary key={pathname} label="page">
          <Outlet />
        </ErrorBoundary>
        <ScheduleDrawer />
      </main>

      <ProfileDrawer />
    </div>
  );
}
