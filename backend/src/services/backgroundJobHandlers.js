'use strict';

// ARCNAVE modernization P2 (4.5 / clash C8) — the job_type -> handler
// registry jobs/backgroundJobWorker.js's poll loop resolves against. A
// handler registered here must be resumable from the job row ALONE
// (job.payload, never a closure captured at enqueue time) — that is
// what makes it safe for a SEPARATE poll cycle, possibly reached after
// the original enqueue() call's own process tick has long since ended,
// to run it. A caller that instead passes an inline closure straight to
// backgroundJobService.enqueue() (e.g. studentAdmissionDraftService's
// own admission_extraction handler today) is NOT resumable this way —
// converting a specific feature to a payload-driven, registry-resolvable
// handler is its own separate, scoped follow-up, not attempted here.
//
// A Map here rather than a flag on the job row, or scattered require()s
// inside the worker itself — same "auditable in one place" posture
// aiService.js's own BUDGET_EXEMPT_LOOKUP_TOOLS hardcoded set comment
// already established for a different registry: every job type this
// loop can actually resume is visible by reading this one file.

const handlers = new Map();

// handler: async (job) => result | undefined. `job` is the real
// background_jobs row (id, college_id, job_type, payload, ...) —
// everything the handler needs to resume must already be in `payload`,
// set at enqueue time (backgroundJobService.enqueue's own `payload`
// param).
function registerHandler(jobType, handler) {
  if (!jobType || typeof jobType !== 'string') {
    throw new Error('registerHandler() requires a non-empty string jobType');
  }
  if (typeof handler !== 'function') {
    throw new Error(`registerHandler(${jobType}) requires a function handler`);
  }
  handlers.set(jobType, handler);
}

function getHandler(jobType) {
  return handlers.get(jobType) || null;
}

// The worker's own claimQueuedJobs call needs this to know which
// job_types it is even allowed to pick up — an unregistered job_type
// (or one enqueued with no job_type at all, e.g. the generic
// POST /background-jobs route) is invisible to the poll loop, exactly
// as if it did not exist; it simply stays 'queued' until its own
// setImmediate dispatch (if any) runs it.
function listRegisteredJobTypes() {
  return Array.from(handlers.keys());
}

module.exports = { registerHandler, getHandler, listRegisteredJobTypes };
