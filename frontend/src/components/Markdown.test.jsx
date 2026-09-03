import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// react-markdown's own parsing (remark-math/rehype-katex especially) can
// throw synchronously during render on malformed input — mocked here so
// this test proves the boundary/reset wiring directly rather than
// depending on a specific external-library input reliably throwing today.
vi.mock('react-markdown', () => ({
  default: ({ children }) => {
    if (children === 'throw me') throw new Error('malformed content');
    return <div>{children}</div>;
  },
}));

const { Markdown } = await import('./Markdown');

describe('Markdown — content error boundary (P4 5.12)', () => {
  it('shows a fallback instead of blanking the pane when content fails to render', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<Markdown>throw me</Markdown>);

    expect(screen.getByText('This content hit a problem.')).toBeInTheDocument();
  });

  it('a different message after a prior crash gets a fresh render attempt', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender } = render(<Markdown>throw me</Markdown>);
    expect(screen.getByText('This content hit a problem.')).toBeInTheDocument();

    rerender(<Markdown>a perfectly fine message</Markdown>);

    expect(screen.getByText('a perfectly fine message')).toBeInTheDocument();
    expect(screen.queryByText('This content hit a problem.')).not.toBeInTheDocument();
  });

  it('renders normal content unaffected', () => {
    render(<Markdown>hello world</Markdown>);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });
});
