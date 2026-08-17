'use strict';

// AI Experience Layer (AIX) — shared value formatters. Pure, stateless
// string helpers only; no tool/business logic here (docs/architecture/
// AI-Style-Guide.md is the source of truth these implement).

const ID_KEY_PATTERN = /(^id$|Id$|_id$|ID$)/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_KEY_PATTERN = /(rate|percent|percentage)/i;
const AMOUNT_KEY_PATTERN = /(amount|fee|balance|paid|due|price|cost)/i;
const DATE_KEY_PATTERN = /(date|_at$|At$)/;
// UAT finding (live NIM run against finance_status_summary): a count
// field like "Fee Structures Count" or "Paid Count" matches
// AMOUNT_KEY_PATTERN on the substring "fee"/"paid" and was rendered as
// "₹4"/"₹2" — a plain count is never a currency amount. Checked before
// AMOUNT_KEY_PATTERN in formatValue below, so any key naming a count
// wins regardless of which other substrings it also happens to contain.
const COUNT_KEY_PATTERN = /count/i;

function isIdLike(key, value) {
  if (typeof key === 'string' && ID_KEY_PATTERN.test(key)) return true;
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function humanizeKey(key) {
  if (!key) return '';
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return `${Number(value).toFixed(1)}%`;
}

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatValue(key, value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return null;
  if (RATE_KEY_PATTERN.test(key) && typeof value === 'number') return formatPercent(value);
  if (COUNT_KEY_PATTERN.test(key) && typeof value === 'number') return String(value);
  if (AMOUNT_KEY_PATTERN.test(key) && typeof value === 'number') return formatCurrency(value);
  if (DATE_KEY_PATTERN.test(key) && (typeof value === 'string')) {
    const formatted = formatDate(value);
    return formatted || String(value);
  }
  return String(value);
}

module.exports = {
  isIdLike,
  humanizeKey,
  formatDate,
  formatPercent,
  formatCurrency,
  formatValue,
  RATE_KEY_PATTERN,
  AMOUNT_KEY_PATTERN,
  COUNT_KEY_PATTERN,
};
