/**
 * Local draft persistence — the fallback layer that makes an accidental drawer
 * close, an outside click, a route change or a failed save non-destructive.
 *
 * `sessionStorage` on purpose: a draft is per-tab working state, not a
 * long-lived document. Every write is guarded, because a private-mode or
 * quota-exhausted browser must degrade to "no fallback", never to a crash in
 * the middle of someone's data entry.
 *
 * Drafts are namespaced by the signed-in staff member, so nothing written here
 * can surface under a different user on a shared machine. Real authorization
 * still belongs to the server — this is a convenience cache of the user's own
 * unsent input, never a source of truth or of permission.
 */

const PREFIX = 'arcnave.draft';

/** Bump when a stored draft's shape changes, so stale shapes are ignored rather than restored. */
const SCHEMA = 1;

function storage() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function draftKey(userId, kind, id) {
  return `${PREFIX}.${userId}.${kind}.${id}`;
}

/** Returns `{ value, savedAt }` for a usable draft, or `null`. Never throws. */
export function readDraft(key) {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schema !== SCHEMA) return null;
    return { value: parsed.value, savedAt: parsed.savedAt ? new Date(parsed.savedAt) : null };
  } catch {
    return null;
  }
}

export function writeDraft(key, value) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify({ schema: SCHEMA, value, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(key) {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* nothing to clean up if storage is unavailable */
  }
}

/** Every draft this user left behind, newest first — backs the "unsent drafts" surfaces. */
export function listDrafts(userId, kind) {
  const store = storage();
  if (!store) return [];
  const prefix = `${PREFIX}.${userId}.${kind}.`;
  const out = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const entry = readDraft(key);
      if (entry) out.push({ key, id: key.slice(prefix.length), ...entry });
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => (b.savedAt?.getTime() ?? 0) - (a.savedAt?.getTime() ?? 0));
}
