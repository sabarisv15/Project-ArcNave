'use strict';

const { appPool } = require('./pool');

// ARCNAVE modernization P0 (bka/70-checkpoint/CURRENT-STATE.md's
// ARCNAVE-modernization mandate; PDF finding 4.1, clash C5): the AI
// chat DB-lock bug. Every route used to hold one pg connection
// checked out of `appPool` for its whole lifetime (tenantTransaction.js's
// original design) — fine for a normal ~10ms request, but an AI turn's
// `askAgent` awaits the LLM provider over the network for 5-45s WHILE
// still holding that connection, so 20 concurrent AI requests (the
// pool's own size) starve the pool for every college, not just the
// ones talking to the AI.
//
// This wrapper is the fix: it presents the exact same `.query(text,
// params)` surface every one of the ~336 existing `req.dbClient`/
// `client` call sites across routes/repositories/services already
// uses (CLAUDE.md rule 1's "every AI tool calls a Business Service"
// contract passes this same object down), so NONE of them need to
// change. Only aiService.js's `completeMaybeStreaming` — the one
// choke point every LLM network call in the file funnels through —
// calls pauseForExternalCall()/resume() around the actual network
// await. Every other route never touches those two methods, so it is
// byte-identical in behavior to the old single-transaction-per-request
// design.
//
// The real trade-off (owner-approved, see the memory file this P0
// phase started from): pausing COMMITS the current short transaction
// and releases the connection — Postgres has no way to "park" an open
// transaction on a released connection. So for any request that
// actually pauses (only AI turns with an LLM call), the request is no
// longer one atomic all-or-nothing unit; each segment between a
// pause/resume boundary durably commits on its own. A tool write that
// happens before a pause survives even if a later step in the same
// turn fails. Every non-AI route never pauses, so this has zero effect
// there.
class PausedConnectionError extends Error {
  constructor() {
    super('TenantConnection: .query() called while paused for an external network call — pair pauseForExternalCall() with resume() in a try/finally.');
    this.name = 'PausedConnectionError';
  }
}

class TenantConnection {
  constructor(collegeId) {
    this.collegeId = collegeId;
    this._client = null;
    this._paused = false;
    this._errorListener = null;
  }

  async _begin() {
    const client = await appPool.connect();
    if (this._errorListener) client.on('error', this._errorListener);
    try {
      await client.query('BEGIN');
      if (this.collegeId !== null) {
        await client.query("SELECT set_config('app.current_tenant', $1, true)", [this.collegeId]);
      }
    } catch (err) {
      client.release();
      throw err;
    }
    this._client = client;
  }

  // Opens the connection for the first time — same moment
  // `appPool.connect()` used to happen in openTenantTransaction.
  async open() {
    await this._begin();
  }

  // A client-level 'error' listener (see tenantTransaction.js's own
  // comment for why one is required — an unhandled EventEmitter
  // 'error' crashes the whole process) has to be re-attached to each
  // new underlying client resume() acquires, since the old client (and
  // its listener) is gone once released.
  onClientError(listener) {
    this._errorListener = listener;
    if (this._client) this._client.on('error', listener);
  }

  async query(text, params) {
    if (this._paused || !this._client) {
      throw new PausedConnectionError();
    }
    return this._client.query(text, params);
  }

  isPaused() {
    return this._paused;
  }

  // Delegates to the underlying pg client's own backend PID — kept for
  // the one existing test (tenant-transaction-client-error.test.js)
  // that targets a live connection with pg_terminate_backend and needs
  // its real PID; not used by any application code.
  get processID() {
    return this._client ? this._client.processID : undefined;
  }

  async pauseForExternalCall() {
    if (this._paused) return;
    const client = this._client;
    this._client = null;
    this._paused = true;
    if (!client) return;
    try {
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  // Always called in a try/finally alongside pauseForExternalCall by
  // the caller, so this runs even when the paused-for network call
  // itself threw. If reacquiring the pool fails (pool exhausted), the
  // connection stays unset — commit()/rollback() below treat that as
  // "nothing left open," not a crash.
  async resume() {
    if (!this._paused) return;
    this._paused = false;
    await this._begin();
  }

  async commit() {
    if (this._paused || !this._client) {
      this._paused = false;
      this._client = null;
      return;
    }
    const client = this._client;
    this._client = null;
    try {
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  async rollback() {
    if (this._paused || !this._client) {
      this._paused = false;
      this._client = null;
      return;
    }
    const client = this._client;
    this._client = null;
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

module.exports = { TenantConnection, PausedConnectionError };
