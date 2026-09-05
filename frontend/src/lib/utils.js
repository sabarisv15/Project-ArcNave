import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Send is enabled only when a real character has been typed (spaces do not count). */
export function hasTypedContent(value) {
  return /[a-zA-Z0-9]/.test(value || '');
}

/** Concise, human-readable conversation title from the first prompt. */
export function titleFromPrompt(text) {
  const words = text.trim().replace(/\s+/g, ' ').split(' ').slice(0, 10);
  let t = words.join(' ');
  if (t.length > 78) t = t.slice(0, 78) + '…';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
