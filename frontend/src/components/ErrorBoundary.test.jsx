import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Thrower() {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('shows a fallback instead of crashing when a child throws during render', () => {
    // React logs the caught error to the console by default; keep the test
    // output clean without hiding a real assertion on it.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary label="page">
        <Thrower />
      </ErrorBoundary>,
    );

    expect(screen.getByText('This page hit a problem.')).toBeInTheDocument();
  });

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary label="page">
        <p>real content</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('real content')).toBeInTheDocument();
  });

  it('changing key remounts and clears a previously caught error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender } = render(
      <ErrorBoundary key="a" label="page">
        <Thrower />
      </ErrorBoundary>,
    );
    expect(screen.getByText('This page hit a problem.')).toBeInTheDocument();

    rerender(
      <ErrorBoundary key="b" label="page">
        <p>a different page</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('a different page')).toBeInTheDocument();
    expect(screen.queryByText('This page hit a problem.')).not.toBeInTheDocument();
  });
});
