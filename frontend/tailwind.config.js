/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      /*
       * Two families, one job each. `sans` is the interface default — every
       * non-chat surface inherits it and no component has to ask for it.
       * `chat` is opt-in and applied at exactly four boundaries (transcript,
       * chat composer, chat title, Sources), so the reading face can never
       * leak into the interface and a non-chat component can never mix the two.
       */
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        chat: ['"DM Sans"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      /*
       * Every colour is a CSS variable defined once in `index.css` (`:root`),
       * expressed as RGB channels so opacity modifiers like `border-line/70`
       * still work. Components never name a hex value; they name a token.
       *
       * White is the canvas, not the lift. `paper` (`#FFFFFF`) is the workspace
       * island and everything primary on it — cards, tables, panels, the
       * composer — while `frame` (`#F2F6FB`) is the cool paper ground it floats
       * on and `sidebar` (`#F8FBFD`) is the rail between the two. Those steps
       * are deliberately large enough to see; a ramp inside 4/255 is what made
       * the interface read flat. `raised` is the same white as `paper` — a
       * drawer, dialog or popover separates itself with `line-strong` and a
       * soft shadow instead.
       * The tinted fields are small and each has a job:
       * `surface`/`soft`/`tint` (`#F1F5FA`) for insets and table heads, `mist`
       * (`#EDF4FA`) for scope and panel headers, `tint2`/`hoverline`
       * (`#EEF5FB`) for the cool hover, and `active` (`#DFEDF5`) for the
       * selected navigation row. Teal is reserved for primary actions, focus,
       * active tab underlines and genuine current/eligible state; never a large
       * background.
       */
      colors: {
        frame: 'rgb(var(--c-frame) / <alpha-value>)',
        sidebar: 'rgb(var(--c-sidebar) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        paper: 'rgb(var(--c-paper) / <alpha-value>)',
        /* The elevated tier — drawers, dialogs, popovers and menus, and only
           those. The same pure white as the canvas: on a white workspace a
           floating surface can no longer be *whiter*, so what lifts it is the
           firmer `line-strong` edge and a soft shadow, never a tone step. */
        raised: 'rgb(var(--c-raised) / <alpha-value>)',
        soft: 'rgb(var(--c-soft) / <alpha-value>)',
        tint: 'rgb(var(--c-tint) / <alpha-value>)',
        tint2: 'rgb(var(--c-tint2) / <alpha-value>)',
        hoverline: 'rgb(var(--c-hover) / <alpha-value>)',
        active: 'rgb(var(--c-active) / <alpha-value>)',
        /* The calm cool field under a *header* — a scope line, or the header
           band of a panel or monitoring card. Distinct from `tint` on purpose:
           labelling a section and heading a table are different jobs. */
        mist: 'rgb(var(--c-mist) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          soft: 'rgb(var(--c-ink-soft) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--c-ink-faint) / <alpha-value>)',
          ghost: 'rgb(var(--c-ink-ghost) / <alpha-value>)',
          disabled: 'rgb(var(--c-ink-disabled) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          hover: 'rgb(var(--c-accent-hover) / <alpha-value>)',
          press: 'rgb(var(--c-accent-press) / <alpha-value>)',
          soft: 'rgb(var(--c-accent-soft) / <alpha-value>)',
          soft2: 'rgb(var(--c-accent-soft2) / <alpha-value>)',
          line: 'rgb(var(--c-accent-line) / <alpha-value>)',
        },
        /* The single saturated tone in the interface — a warm amber used on the
           avatar fallback and nowhere else. Never a CTA, never destructive,
           never a navigation or table colour. */
        warm: {
          DEFAULT: 'rgb(var(--c-warm) / <alpha-value>)',
          soft: 'rgb(var(--c-warm-soft) / <alpha-value>)',
        },
        /* One neutral scrim for every modal/drawer overlay. Never blue-tinted. */
        overlay: 'rgb(var(--c-overlay) / <alpha-value>)',
        line: {
          DEFAULT: 'rgb(var(--c-line) / <alpha-value>)',
          light: 'rgb(var(--c-line-light) / <alpha-value>)',
          lighter: 'rgb(var(--c-line-lighter) / <alpha-value>)',
          strong: 'rgb(var(--c-line-strong) / <alpha-value>)',
        },
        /* The app's one structural boundary — the docked rail against the
           workspace. Slightly firmer than `line`, and used nowhere else. */
        divider: 'rgb(var(--c-divider) / <alpha-value>)',
        /*
         * The status families. One definition each, so the same meaning renders
         * identically in every seat — a pending revision in the department
         * workspace, in the delegated queue and in the institution's approval
         * table is one colour, not three hex literals that happen to match
         * today. `DEFAULT` is the text tone, `soft` the wash it sits on.
         */
        success: {
          DEFAULT: 'rgb(var(--c-success) / <alpha-value>)',
          soft: 'rgb(var(--c-success-soft) / <alpha-value>)',
        },
        pending: {
          DEFAULT: 'rgb(var(--c-pending) / <alpha-value>)',
          soft: 'rgb(var(--c-pending-soft) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--c-warning) / <alpha-value>)',
          soft: 'rgb(var(--c-warning-soft) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--c-info) / <alpha-value>)',
          soft: 'rgb(var(--c-info-soft) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)',
          hover: 'rgb(var(--c-danger-hover) / <alpha-value>)',
          soft: 'rgb(var(--c-danger-soft) / <alpha-value>)',
        },
      },
      /* Extremely subtle and strictly neutral — a pure black scrim in the
         reference's own 4-6% band, giving a floating feel without heavy depth.
         Separation is the job of tone and the hairline; on the floating tier
         it is `line-strong` that says "this is raised", so a shadow only has
         to soften the edge under it: the composer sits at 6%, cards at 4%, and
         nothing but the dark toast goes meaningfully past that. */
      boxShadow: {
        composer: '0 2px 12px rgba(0,0,0,.06)',
        /* The workspace island, floating on the shared app ground. Barely
           there on purpose — the rounded shape and the hairline do the work,
           and the shadow only stops the corners looking cut out. */
        island: '0 2px 12px rgba(8,8,8,.035)',
        pop: '0 8px 28px rgba(0,0,0,.08)',
        dialog: '0 16px 44px -20px rgba(0,0,0,.14)',
        card: '0 1px 6px rgba(0,0,0,.04)',
        typeCard: '0 1px 6px rgba(0,0,0,.04)',
        avatar: '0 2px 8px rgba(0,0,0,.06)',
        restore: '0 2px 8px rgba(0,0,0,.05)',
        chip: '0 1px 3px rgba(0,0,0,.05)',
        seg: '0 1px 3px rgba(0,0,0,.06)',
        shell: '0 1px 2px rgba(0,0,0,.03)',
        docsheet: '0 2px 10px rgba(0,0,0,.05)',
        jump: '0 4px 14px -6px rgba(0,0,0,.1)',
        toast: '0 10px 26px -12px rgba(0,0,0,.22)',
      },
      keyframes: {
        breathe: {
          '0%,100%': { transform: 'scale(1)', opacity: '.92' },
          '50%': { transform: 'scale(1.045)', opacity: '1' },
        },
        spinSlow: { to: { transform: 'rotate(360deg)' } },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '.45' },
          '50%': { opacity: '1' },
        },
        rowIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        /* First send: the composer leaves its large start state and arrives
           docked and compact. Opacity and a small settle only — no scale, no
           bounce, nothing that reads as the composer "jumping" to the bottom. */
        composerDock: {
          from: { opacity: '.55', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        /* The Home mark travels in from slightly off-position and lands beside
           the greeting. One controlled arrival, once — never an attract loop. */
        velTravel: {
          from: { opacity: '0', transform: 'translate(-14px, 8px) scale(.9)' },
          '70%': { opacity: '1', transform: 'translate(2px, -1px) scale(1.02)' },
          to: { opacity: '1', transform: 'none' },
        },
        // The overlay sidebar slides horizontally, never scales or bounces.
        railIn: {
          from: { opacity: '.35', transform: 'translateX(-100%)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        railOut: {
          from: { opacity: '1', transform: 'translateX(0)' },
          to: { opacity: '.25', transform: 'translateX(-100%)' },
        },
        /* Sources arrives from the right edge it belongs to — a short 10px
           slide inward under a fade, never the left-to-right entrance the rail
           uses. Closing runs the same path back out toward the right. */
        sourcesIn: {
          from: { opacity: '0', transform: 'translateX(10px)' },
          to: { opacity: '1', transform: 'none' },
        },
        sourcesOut: {
          from: { opacity: '1', transform: 'none' },
          to: { opacity: '0', transform: 'translateX(10px)' },
        },
        /* A right drawer travels its own full width, right to left, and leaves
           the same way — it is a panel pulled out of the app's right edge, not
           a card fading in near it. */
        drawerIn: {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        drawerOut: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
      },
      animation: {
        breathe: 'breathe 4.6s ease-in-out infinite',
        spinSlow: 'spinSlow 14s linear infinite',
        fadeUp: 'fadeUp 160ms ease',
        viewIn: 'fadeUp 180ms ease',
        pulseSoft: 'pulseSoft 1.5s ease-in-out infinite',
        rowIn: 'rowIn 240ms ease-out both',
        composerDock: 'composerDock 200ms ease-out both',
        velTravel: 'velTravel 620ms cubic-bezier(.22,.61,.36,1) both',
        railIn: 'railIn 220ms cubic-bezier(.22,.61,.36,1) both',
        railOut: 'railOut 170ms cubic-bezier(.4,0,.7,.35) both',
        sourcesIn: 'sourcesIn 200ms ease-out both',
        sourcesOut: 'sourcesOut 180ms ease-out both',
        drawerIn: 'drawerIn 240ms cubic-bezier(.22,.61,.36,1) both',
        drawerOut: 'drawerOut 190ms cubic-bezier(.4,0,.7,.35) both',
      },
      transitionDuration: { 180: '180ms', 200: '200ms' },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
