/**
 * Code syntax highlighting (P2.1) — a thin wrapper around Shiki's on-demand
 * `codeToHtml`, which dynamically imports only the grammar/theme a given
 * call actually needs rather than bundling every language up front.
 *
 * A single theme (github-light), not a light/dark pair: this app's dark
 * mode is not actively toggled anywhere in the UI today (main.jsx pins
 * `defaultTheme="light"`, `enableSystem={false}`), and Shiki's dual-theme
 * output needs a small global CSS rule wired to the `.dark` class to
 * actually switch — real, but separate wiring not worth adding for a mode
 * nothing currently turns on. Revisit if/when dark mode ships for real.
 *
 * Results are cached by `${lang}:${code}` — a chat message never re-renders
 * with different code for the same block, so this avoids re-highlighting
 * identical text on every parent re-render (React state changes elsewhere
 * in the transcript, a sibling message streaming in, etc.).
 */

const cache = new Map();

const LANGUAGE_ALIASES = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
};

export function languageFromClassName(className) {
  const match = /language-(\S+)/.exec(className || '');
  if (!match) return 'text';
  const raw = match[1].toLowerCase();
  return LANGUAGE_ALIASES[raw] || raw;
}

export async function highlightCode(code, lang) {
  const key = `${lang}:${code}`;
  if (cache.has(key)) return cache.get(key);

  const promise = (async () => {
    try {
      const { codeToHtml } = await import('shiki');
      return await codeToHtml(code, { lang, theme: 'github-light' });
    } catch {
      // An unknown language alias, or the grammar failed to load — fall
      // back to plain, unhighlighted text rather than a broken block.
      return null;
    }
  })();

  cache.set(key, promise);
  return promise;
}
