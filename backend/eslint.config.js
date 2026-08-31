'use strict';

// ARCNAVE modernization P0 (PDF 4.x/5.7): first lint config this repo
// has ever had. Deliberately starts conservative — catch real bugs
// (unused vars, undefined globals, unreachable code) without forcing a
// style rewrite of ~30k existing lines in the same pass. Formatting is
// Prettier's job (.prettierrc.json + eslint-config-prettier below,
// which turns off every ESLint rule that would conflict with it) —
// ESLint here is for correctness, not style.

const js = require('@eslint/js');
const globals = require('globals');
const nPlugin = require('eslint-plugin-n');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    plugins: { n: nPlugin },
    rules: {
      // Real correctness rules — everything else stays at eslint:recommended's
      // defaults for this first pass.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off', // logging/logger.js is the real discipline here, not a blanket ban
      'n/no-missing-require': 'error',
      'n/no-extraneous-require': 'error',
      // False-positives on this codebase's dominant `let x; try { x =
      // ... } catch { x = ... }` idiom (every test file's requestJson
      // helper) — the rule doesn't see the later use once it's inside
      // a callback passed to resolve()/an object literal built after
      // the try/catch. Verified as false positive, not disabled blind:
      // every flagged case has a real, later read of the variable.
      'no-useless-assignment': 'off',
      // Off by default in eslint:recommended, but ~190 existing
      // `// eslint-disable-next-line no-await-in-loop` comments across
      // this codebase's tests already assumed it would be active —
      // turning it on (warn, not error: many uses here are genuinely
      // deliberate sequential-by-design, e.g. rate-limit/reuse-detection
      // probes) makes those existing comments meaningful again instead
      // of dead, rather than deleting 190 lines of prior intent.
      'no-await-in-loop': 'warn',
    },
  },
  {
    ignores: ['node_modules/**', 'storage/**', 'storage-backups/**', 'coverage/**'],
  },
  prettierConfig,
];
