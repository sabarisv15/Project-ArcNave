import { Component } from 'react';

/**
 * P4 5.12 — a small, isolated error area: catches a render-time throw in
 * whatever it wraps and shows a fallback instead of letting it blank the
 * rest of the app. Class component because `getDerivedStateFromError`/
 * `componentDidCatch` are the only way React exposes this — no hook
 * equivalent exists.
 *
 * Reset is deliberately NOT built in here as retry-counter state — callers
 * pass a `key` that changes when whatever they're guarding legitimately
 * changes (a new route, new content), and React's own remount-on-key-change
 * clears any caught error for free. See AppShell.jsx (keyed on the current
 * route) and Markdown.jsx (keyed on the rendered source) for the two real
 * uses.
 */
export class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught a render error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="m-0 p-[10px] rounded-[10px] bg-soft border border-line-light text-[12.5px] text-ink-soft">
            {this.props.label ? `This ${this.props.label} hit a problem.` : 'This hit a problem.'}
          </div>
        )
      );
    }
    return this.props.children;
  }
}
