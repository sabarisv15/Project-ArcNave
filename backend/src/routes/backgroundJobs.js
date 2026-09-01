'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requirePermission } = require('../middleware/rbac');
const backgroundJobService = require('../services/backgroundJobService');
const identityService = require('../services/identityService');

function requireResolvedTenant(req, res) {
  if (req.collegeId === null) {
    res.status(400).json({ detail: 'No tenant could be resolved for this request' });
    return false;
  }
  return true;
}

function createBackgroundJobsRouter() {
  const router = express.Router();

  router.post(
    '/background-jobs',
    requirePermission('background_jobs.create'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const body = req.body || {};
      const job = await backgroundJobService.enqueue(req.dbClient, {
        collegeId: req.collegeId,
        name: body.name || 'manual_job',
        createdByUserId: identityService.resolveActorUserId(req.capabilities),
      });
      res.status(202).json(job);
    }),
  );

  router.get(
    '/background-jobs',
    requirePermission('background_jobs.read'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      res.json(await backgroundJobService.list(req.dbClient));
    }),
  );

  router.get(
    '/background-jobs/:id',
    requirePermission('background_jobs.read'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const job = await backgroundJobService.find(req.dbClient, req.params.id);
      if (!job) {
        res.status(404).json({ detail: 'Background job not found' });
        return;
      }
      res.json(job);
    }),
  );

  // P4 (5.4) — "notifications / job progress are polled today, should be
  // one live-events stream." Same SSE shape routes/ai.js's /ai/ask/stream
  // already established (writeEvent helper, text/event-stream headers) so
  // the frontend gets one familiar consumption pattern for both. No new
  // infra: this is a poll loop inside the request handler, same
  // single-app-instance posture every other "do not build early" item in
  // this codebase already carries (D1, C8's own feature-switch half) — an
  // actual pub/sub push mechanism is only worth it once there is more than
  // one app instance to fan a write out to.
  router.get(
    '/background-jobs/:id/stream',
    requirePermission('background_jobs.read'),
    asyncHandler(async (req, res) => {
      if (!requireResolvedTenant(req, res)) return;
      const first = await backgroundJobService.find(req.dbClient, req.params.id);
      if (!first) {
        res.status(404).json({ detail: 'Background job not found' });
        return;
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const writeEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const POLL_INTERVAL_MS = 500;
      // Safety net only — a real job is expected to reach a terminal
      // status well before this; this just stops an orphaned poll loop
      // (e.g. a job stuck at 'running' forever) from running indefinitely.
      const MAX_STREAM_MS = 10 * 60 * 1000;
      const collegeId = req.collegeId;
      const jobId = req.params.id;
      const startedAt = Date.now();
      let lastSent = null;
      let stopped = false;
      req.on('close', () => {
        stopped = true;
      });

      // req.dbClient (TenantConnection) holds a real pool connection
      // checked out and inside an open transaction for this whole
      // request — every poll tick below already uses its own
      // short-lived connection (findFresh), so req.dbClient is never
      // touched again after this point. Left un-paused it would still
      // sit idle-in-transaction for up to MAX_STREAM_MS, the exact P0
      // aiService.js DB-lock bug (clash C5), just triggered by an SSE
      // stream instead of a slow LLM call. Not resumed before res.end():
      // commit()/rollback() in the outer request middleware treats an
      // already-paused connection as "nothing to commit."
      await req.dbClient.pauseForExternalCall();

      const isTerminal = (job) => job.status === 'completed' || job.status === 'failed';
      const changed = (job) =>
        !lastSent || lastSent.status !== job.status || lastSent.progress !== job.progress;

      const sendIfChanged = (job) => {
        if (changed(job)) {
          lastSent = job;
          writeEvent('job', job);
        }
      };

      try {
        sendIfChanged(first);
        while (!stopped && !isTerminal(lastSent) && Date.now() - startedAt < MAX_STREAM_MS) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          if (stopped) break;
          // eslint-disable-next-line no-await-in-loop
          const job = await backgroundJobService.findFresh(collegeId, jobId);
          if (job) sendIfChanged(job);
        }
        if (!stopped) writeEvent('done', lastSent);
      } catch (err) {
        if (!stopped) writeEvent('error', { detail: err.message });
      } finally {
        res.end();
      }
    }),
  );

  return router;
}

module.exports = createBackgroundJobsRouter;
