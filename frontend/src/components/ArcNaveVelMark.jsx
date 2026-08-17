import { cn } from '../lib/utils';

/**
 * The ArcNave **Vel** mark — arc + blade — and the one place its motion
 * vocabulary is defined. Every animated ArcNave brand/loading moment renders
 * this component; nothing else draws the mark or invents a state for it.
 *
 * Geometry (128×128 user space, four parts):
 *   - the **arc**, a 300° sweep of radius 46 around the centre
 *   - the **shaft**, a short vertical stroke from the blade's foot down
 *   - the **blade**, a tapered leaf rising from the foot to the top
 *   - the **node**, a rotated diamond seated on the blade's shoulder
 *
 * Colour follows the interface, not the brand sheet: the blade, shaft and arc
 * take `currentColor` (so a caller decides `text-ink` vs `text-ink-soft` in
 * context) and only the node and the moving probe carry the restrained accent.
 * There is no dark surface anywhere in here.
 *
 * ## States
 * | state       | when                                    | motion |
 * | ----------- | --------------------------------------- | ------ |
 * | `static`    | one of many marks on screen             | none at all |
 * | `idle`      | the single hero mark, resting           | a near-imperceptible arc drift and blade breath |
 * | `listening` | microphone capture / active voice input | the blade leans, the arc counter-shifts |
 * | `thinking`  | AI reasoning                            | a probe steps around the arc — deliberate, not a spinner |
 * | `working`   | upload or long-running background task  | flow up the shaft, slow arc progress |
 * | `success`   | completed generation / valid upload     | one-shot lift and settle |
 * | `error`     | recoverable failure                     | one small off-axis tip, then square again |
 *
 * `success` and `error` are one-shot by construction (`animation-fill-mode:
 * both`, no iteration count) — remount with a `key` to replay one.
 *
 * ## Accessibility
 * Pass a `label` when the mark *is* the status ("ArcNave is preparing a
 * response") and it renders as `role="img"` with that accessible name. Omit it
 * for decoration and the SVG is `aria-hidden`. Under `prefers-reduced-motion`
 * every animation is suppressed by the global rule in `index.css`, leaving the
 * static mark — which is why each state still reads correctly when still.
 *
 * ## Usage rules
 * Full size on Home and in a meaningful empty state; 16–20px for a composer or
 * chat loading indicator. Never more than one *animating* mark on a screen,
 * and never one per row, cell or button.
 *
 * `static` exists to make that rule enforceable rather than aspirational: a
 * transcript renders one mark per assistant message, and if every settled one
 * kept drifting, a long conversation would be twenty marks breathing at once.
 * Only the message actually being generated animates; the rest are `static`.
 * That is also why `static` is the default — a caller has to opt *into*
 * motion.
 */
export function ArcNaveVelMark({ size = 46, state = 'static', label, className }) {
  const decorative = !label;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      data-vel-state={state}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={decorative ? undefined : label}
      className={cn('vel shrink-0 overflow-visible', className)}
    >
      {!decorative && <title>{label}</title>}

      {/* Arc — its own group, so it can drift and counter-lean independently
          of the blade rather than the whole mark rotating as one piece. */}
      <g className="vel-arc">
        <path
          d="M41 24.2 A46 46 0 1 0 87 24.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="6.5"
          strokeLinecap="round"
          opacity="0.28"
        />
        {/* Progress sweep — only drawn while `working`. */}
        <path
          className="vel-progress"
          d="M41 24.2 A46 46 0 1 0 87 24.2"
          fill="none"
          stroke="rgb(var(--c-accent))"
          strokeWidth="6.5"
          strokeLinecap="round"
          strokeDasharray="241"
          strokeDashoffset="241"
          opacity="0"
        />
        {/* Probe — the short segment that steps between positions while
            `thinking`. Discrete jumps, never a continuous spinner sweep. */}
        <path
          className="vel-probe"
          d="M41 24.2 A46 46 0 1 0 87 24.2"
          fill="none"
          stroke="rgb(var(--c-accent))"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray="15 226"
          strokeDashoffset="0"
          opacity="0"
        />
      </g>

      {/* Blade — pivots at the foot of the shaft (64,108) and moves as one
          rigid piece, so a lean never detaches the node from the blade. */}
      <g className="vel-blade">
        <path d="M64 84 V108" fill="none" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" />
        {/* Flow up the shaft — only drawn while `working`. */}
        <path
          className="vel-flow"
          d="M64 108 V84"
          fill="none"
          stroke="rgb(var(--c-accent))"
          strokeWidth="4.2"
          strokeLinecap="round"
          strokeDasharray="5 9"
          opacity="0"
        />
        <path d="M64 8 C82 28 86 42 64 84 C42 42 46 28 64 8 Z" fill="currentColor" />
        {/* Success ring — expands once out of the node and fades. */}
        <rect
          className="vel-ring"
          x="52"
          y="28"
          width="24"
          height="24"
          rx="5"
          transform="rotate(45 64 40)"
          fill="none"
          stroke="rgb(var(--c-accent))"
          strokeWidth="2"
          opacity="0"
        />
        <g className="vel-node">
          <rect
            x="56"
            y="32"
            width="16"
            height="16"
            rx="3.5"
            transform="rotate(45 64 40)"
            fill="rgb(var(--c-accent))"
          />
        </g>
      </g>
    </svg>
  );
}
