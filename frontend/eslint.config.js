import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettierConfig from 'eslint-config-prettier';

// ARCNAVE modernization P0 (PDF 5.7/5.10): first lint config this repo
// has ever had — jsx-a11y is the accessibility half of that finding
// (recommended ruleset, not the full strict variant, for the same
// "correctness first pass, not a style rewrite" reasoning
// backend/eslint.config.js's own comment gives).
export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      // eslint-plugin-react-hooks v7's `recommended` config is the new
      // React Compiler ruleset (set-state-in-effect, refs,
      // incompatible-library, static-components, ...) — real signal,
      // but it surfaced ~130 findings across already-shipped components
      // that each need individual behavioral review, not a mechanical
      // fix; too large a blast radius for this first-ever lint pass.
      // Scoped to the two classic, well-understood hook-correctness
      // rules for now (rules-of-hooks is a real bug class — calling a
      // hook conditionally; exhaustive-deps catches real stale-closure
      // bugs). Full React Compiler readiness is its own future pass —
      // see ARCNAVE-modernization-english.md P3/P4.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Real findings against already-shipped components (~10 across
      // the app: click-only divs with no keyboard handler, a
      // tabIndex on a non-interactive element, an unassociated form
      // label, a role/aria mismatch) — genuinely worth fixing, but a
      // full accessibility remediation is its own explicit later phase
      // (ARCNAVE-modernization-english.md 5.10: "P0 (lint), P4
      // (full)"). P0's job is turning the checks ON; kept at `warn` so
      // CI is green today and every finding is still visible, not
      // silenced — errors would block this unrelated CI-pipeline slice
      // on ~10 pre-existing UI fixes that need individual review.
      // P4 5.10 (full accessibility remediation pass) — this used to be
      // `Object.keys(...).map((rule) => [rule, 'warn'])`, which reads
      // only each RULE NAME from jsx-a11y's recommended config and
      // discards the VALUE entirely. Two real bugs followed from that:
      // (1) rules upstream deliberately sets to 'off' (e.g.
      // `label-has-for`, superseded by `label-has-associated-control`,
      // whose unconfigured default `required: { every: ['nesting',
      // 'id'] }` is stricter than real accessibility needs — either one
      // alone gives a control a valid accessible name) got silently
      // turned back on; (2) rules that ship with a tuned OPTIONS object
      // lost it — `control-has-associated-label`'s own recommended entry
      // is `['off', { ignoreElements: ['input', 'textarea', ...], ... }]`,
      // deliberately excluding `<input>`/`<textarea>` because THEIR
      // labeling is `label-has-associated-control`'s job, not this
      // rule's (meant for icon-only buttons/custom controls with no
      // `<label>` available) — losing that option list made this rule
      // wrongly flag every properly `<label>`-associated `<input>` in
      // the app. Confirmed both by reading
      // node_modules/eslint-plugin-jsx-a11y/lib/index.js directly, not
      // assumed. Fixed at the root: preserve each rule's own recommended
      // severity and options, only ever downgrading 'error' to 'warn'
      // (never upgrading an 'off' rule upstream chose not to enable) —
      // matches this file's own stated intent ("recommended ruleset...
      // kept at warn") more literally than the blanket version did.
      ...Object.fromEntries(
        Object.entries(jsxA11y.configs.recommended.rules).map(([rule, value]) => {
          const [severity, ...options] = Array.isArray(value) ? value : [value];
          const newSeverity = severity === 'off' ? 'off' : 'warn';
          return [rule, options.length ? [newSeverity, ...options] : newSeverity];
        }),
      ),
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // React 19 (this project's version, see package.json) no longer
      // needs React in scope for JSX — the classic rule predates the
      // new JSX transform this repo's Vite config already uses.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Stylistic only (XHTML-validity convention) — an unescaped
      // apostrophe in JSX text renders correctly in every real
      // browser; not a functional or security issue, and ~13 existing
      // UI copy strings would need hand review to change safely.
      'react/no-unescaped-entities': 'off',
    },
  },
  {
    // Node-context config files (CommonJS, run by Vite/Tailwind's own
    // Node process, never shipped to the browser) — need Node globals
    // instead of the browser set the rest of this config uses.
    files: ['vite.config.js', 'tailwind.config.js', 'postcss.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**'],
  },
  prettierConfig,
];
