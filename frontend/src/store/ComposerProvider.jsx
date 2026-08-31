import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { clearDraft, draftKey, readDraft, writeDraft } from '../lib/draftStore';
import { ME } from '../lib/substituteData';

/**
 * Composer draft isolation.
 *
 * The bug this exists to make unrepresentable: the composer used to read and
 * write one global `input`/`mode` pair on the workspace store, so typing on
 * Home and then opening a project showed the Home text in the project's
 * composer. Every composer surface now addresses a **scope key** and can only
 * ever see its own slice — there is no shared slot left to leak through.
 *
 * A scope owns everything the user typed or chose while in it: text, the
 * Research/Curriculum scope mode, attachments, context chips, and any
 * mention/command state. It
 * is kept in memory for the session (so returning to a conversation restores
 * what was being written) and mirrored into `sessionStorage` under the
 * signed-in user's namespace, so an accidental close or reload is recoverable.
 *
 * Persistence rules that matter more than they look:
 *  - Every pending write carries **its own** storage key, captured when the
 *    edit happened. A route change that lands mid-debounce therefore flushes
 *    the previous scope to the previous key — it can never write the old
 *    route's text into the newly active composer.
 *  - Changing scope flushes only the scope being left.
 *  - A draft is restored only for an exact key match, only for this user
 *    (`draftKey` namespaces by user id), and only when the caller says the
 *    resource is resolved and readable (`canRestore`).
 *  - Sending clears exactly one scope. Nothing else is touched.
 */

export const EMPTY_COMPOSER = Object.freeze({
  text: '',
  // Defaults to 'general' (no tools, no Policy Gate prompt): a brand-new
  // composer has no signal yet that the user needs a campus-data tool, so
  // it starts on the cheaper, tool-free path. Switching to Curriculum is
  // one ScopeToggle click away the moment a college-data question needs it.
  mode: 'general',
  // CEO Vertex/Gemini audit #26 (2026-08-30) — "in AI Composer enable
  // level switching let user decide". 'fast' maps to gemini.js's own
  // existing GENERATION_CONFIG.thinkingConfig.thinkingLevel default
  // ('LOW') — a composer nobody has touched sends the exact same request
  // shape as before this field existed. Same per-scope-draft precedent
  // as `mode` above — a level chosen in one chat/project/artifact
  // composer never leaks into another.
  thinkingLevel: 'fast',
  attachments: [],
  contextChips: [],
  mention: null,
});

/** Long enough not to write on every keystroke, short enough to survive a fast exit. */
const PERSIST_DEBOUNCE_MS = 450;

/** Stable keys. One place, so no surface can invent a colliding or generic key. */
export const composerScope = {
  home: () => 'home',
  chat: (chatId) => `chat:${chatId}`,
  project: (projectId, conversationId) => `project:${projectId}:${conversationId ?? 'new'}`,
  artifactCreate: (artifactId) => `artifact:create:${artifactId}`,
  artifactRevision: (artifactId) => `artifact:${artifactId}:revision`,
};

export function isEmptyComposer(draft) {
  if (!draft) return true;
  return !draft.text?.trim() && !draft.attachments?.length && !draft.contextChips?.length && !draft.mention;
}

/** A stored value is only usable if it still looks like a composer draft. */
function isComposerShape(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.text === 'string';
}

const ComposerContext = createContext(null);

export function ComposerProvider({ children }) {
  const [scopes, setScopes] = useState({});

  // Reading the live map without subscribing — used by the hydration guard, so
  // an already-typed scope is never overwritten by a stale stored copy.
  const scopesRef = useRef(scopes);
  scopesRef.current = scopes;

  const peekScope = useCallback((key) => scopesRef.current[key], []);

  const patchScope = useCallback((key, changes) => {
    if (!key) return;
    setScopes((prev) => {
      const base = prev[key] ?? EMPTY_COMPOSER;
      const next = typeof changes === 'function' ? changes(base) : { ...base, ...changes };
      return { ...prev, [key]: next };
    });
  }, []);

  const dropScope = useCallback((key) => {
    if (!key) return;
    setScopes((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ scopes, peekScope, patchScope, dropScope }),
    [scopes, peekScope, patchScope, dropScope],
  );

  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
}

function useComposerStore() {
  const ctx = useContext(ComposerContext);
  if (!ctx) throw new Error('useComposer must be used inside ComposerProvider');
  return ctx;
}

/**
 * One composer's state.
 *
 * @param {string}  scopeKey     from `composerScope.*` — never a hand-written literal
 * @param {object}  [opts]
 * @param {boolean} [opts.canRestore] false while the resource is still resolving or
 *        is not readable by this user; no stored draft is restored until it is true.
 * @param {'general'|'curriculum'} [opts.defaultMode] what this surface opens on while
 *        its scope is untouched. It is a property of the *scope*, not a global
 *        setting, so an Artifact opening on Curriculum cannot change what Home, a
 *        chat or a project opens on, and no surface's mode can leak into another. A
 *        scope the user has already set keeps their choice — this only supplies the
 *        starting point.
 */
export function useComposer(scopeKey, { canRestore = true, defaultMode = EMPTY_COMPOSER.mode } = {}) {
  const { scopes, peekScope, patchScope, dropScope } = useComposerStore();

  const storageKey = scopeKey ? draftKey(ME.id, 'composer', scopeKey) : null;
  const empty = useMemo(
    () =>
      defaultMode === EMPTY_COMPOSER.mode ? EMPTY_COMPOSER : Object.freeze({ ...EMPTY_COMPOSER, mode: defaultMode }),
    [defaultMode],
  );
  const draft = (scopeKey && scopes[scopeKey]) || empty;

  /* ---- persistence: every pending write carries its own key ---- */

  const timer = useRef(null);
  const pending = useRef(null); // { storageKey, value }

  const commit = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const job = pending.current;
    pending.current = null;
    if (!job) return;
    if (isEmptyComposer(job.value)) clearDraft(job.storageKey);
    else writeDraft(job.storageKey, job.value);
  }, []);

  const schedulePersist = useCallback(
    (key, value) => {
      if (!key) return;
      // A write queued for a different scope belongs to that scope: land it
      // where it came from before queueing this one.
      if (pending.current && pending.current.storageKey !== key) commit();
      pending.current = { storageKey: key, value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(commit, PERSIST_DEBOUNCE_MS);
    },
    [commit],
  );

  // Leaving this scope — by navigation or unmount — lands whatever is pending.
  // The cleanup closes over the *previous* key's job, which is exactly right.
  useEffect(() => () => commit(), [scopeKey, commit]);

  /* ---- restore: exact key, this user, resolved resource, once ---- */

  const hydratedKey = useRef(null);
  useEffect(() => {
    if (!scopeKey || !canRestore) return;
    if (hydratedKey.current === scopeKey) return;
    hydratedKey.current = scopeKey;
    // Something already typed this session wins over anything on disk.
    if (peekScope(scopeKey)) return;
    const stored = readDraft(storageKey);
    if (!stored || !isComposerShape(stored.value)) return;
    patchScope(scopeKey, { ...EMPTY_COMPOSER, ...stored.value });
  }, [scopeKey, canRestore, storageKey, peekScope, patchScope]);

  /* ---- mutators: all scoped, none global ---- */

  const patch = useCallback(
    (changes) => {
      patchScope(scopeKey, (base) => {
        const next = typeof changes === 'function' ? changes(base) : { ...base, ...changes };
        schedulePersist(storageKey, next);
        return next;
      });
    },
    [patchScope, schedulePersist, scopeKey, storageKey],
  );

  const setText = useCallback((text) => patch({ text }), [patch]);
  const setMode = useCallback((mode) => patch({ mode }), [patch]);
  const setThinkingLevel = useCallback((thinkingLevel) => patch({ thinkingLevel }), [patch]);
  /**
   * Accepts a value or an updater. The updater form matters: several
   * attachment uploads report progress on their own timers, and two of them
   * landing in the same tick, each holding a captured copy of the array, would
   * silently drop one.
   */
  const setAttachments = useCallback(
    (next) =>
      patch((base) => ({
        ...base,
        attachments: typeof next === 'function' ? next(base.attachments ?? []) : next,
      })),
    [patch],
  );
  const setContextChips = useCallback((contextChips) => patch({ contextChips }), [patch]);
  const setMention = useCallback((mention) => patch({ mention }), [patch]);

  /** After a successful send, or an explicit discard. Clears this scope only. */
  const reset = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
    dropScope(scopeKey);
    if (storageKey) clearDraft(storageKey);
  }, [dropScope, scopeKey, storageKey]);

  return {
    scopeKey,
    draft,
    text: draft.text,
    mode: draft.mode,
    thinkingLevel: draft.thinkingLevel ?? EMPTY_COMPOSER.thinkingLevel,
    attachments: draft.attachments,
    contextChips: draft.contextChips,
    setText,
    setMode,
    setThinkingLevel,
    setAttachments,
    setContextChips,
    setMention,
    patch,
    reset,
    flush: commit,
  };
}
