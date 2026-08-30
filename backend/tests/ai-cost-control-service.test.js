'use strict';

// Unit tests for aiCostControlService.js (CEO Vertex/Gemini audit
// #42/C20/C21, 2026-08-30 — Per-Tenant Cost/Quota Control + Rate
// Limits). auditLogRepository/configurationService are stubbed via
// node:test's built-in mock, same "fresh property lookup on the shared
// module object" reasoning every other service's own unit tests in
// this codebase rely on (see document-extraction-service.test.js's own
// file header comment).

const test = require('node:test');
const assert = require('node:assert/strict');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const configurationService = require('../src/services/configurationService');
const globalConfig = require('../src/config');
const aiCostControlService = require('../src/services/aiCostControlService');

function mockUsageWindow(t, { periodTokens = 0, periodCallCount = 0, windowCallCount = 0 } = {}) {
  const m = t.mock.method(auditLogRepository, 'getAiUsageWindow', async () => ({
    periodTokens, periodCallCount, windowCallCount,
  }));
  t.after(() => m.mock.restore());
  return m;
}

function mockQuotaConfig(t, configuration = null) {
  const m = t.mock.method(configurationService, 'getConfiguration', async () => (
    configuration ? { configuration } : null
  ));
  t.after(() => m.mock.restore());
  return m;
}

test('getMonthlyTokenQuota', async (t) => {
  await t.test('falls back to the global default when no per-college override is configured', async () => {
    mockQuotaConfig(t, null);
    const quota = await aiCostControlService.getMonthlyTokenQuota({}, 'c1');
    assert.equal(quota, globalConfig.aiDefaultMonthlyTokenQuota);
  });

  await t.test('uses a college-specific override when configured', async () => {
    mockQuotaConfig(t, { monthlyTokenQuota: 5000 });
    const quota = await aiCostControlService.getMonthlyTokenQuota({}, 'c1');
    assert.equal(quota, 5000);
  });

  await t.test('a configured 0 is honored (an explicit "cut this college off"), never treated as falsy-and-ignored', async () => {
    mockQuotaConfig(t, { monthlyTokenQuota: 0 });
    const quota = await aiCostControlService.getMonthlyTokenQuota({}, 'c1');
    assert.equal(quota, 0);
  });
});

test('getUsageStatus', async (t) => {
  await t.test('reports withinBudget/withinLimit true when usage is well under both ceilings', async () => {
    mockQuotaConfig(t, null);
    mockUsageWindow(t, { periodTokens: 100, periodCallCount: 5, windowCallCount: 2 });

    const status = await aiCostControlService.getUsageStatus({}, 'c1');
    assert.equal(status.quota.withinBudget, true);
    assert.equal(status.quota.tokensUsed, 100);
    assert.equal(status.rateLimit.withinLimit, true);
    assert.equal(status.rateLimit.callsInWindow, 2);
  });

  await t.test('reports withinBudget: false once usage reaches the quota (>=, not just >)', async () => {
    mockQuotaConfig(t, { monthlyTokenQuota: 1000 });
    mockUsageWindow(t, { periodTokens: 1000, periodCallCount: 1, windowCallCount: 1 });

    const status = await aiCostControlService.getUsageStatus({}, 'c1');
    assert.equal(status.quota.withinBudget, false);
    assert.equal(status.quota.percentUsed, 100);
  });

  await t.test('reports withinLimit: false once calls-in-window reach the rate limit', async () => {
    mockQuotaConfig(t, null);
    mockUsageWindow(t, { periodTokens: 0, periodCallCount: globalConfig.aiRateLimitPerMinute, windowCallCount: globalConfig.aiRateLimitPerMinute });

    const status = await aiCostControlService.getUsageStatus({}, 'c1');
    assert.equal(status.rateLimit.withinLimit, false);
  });
});

test('checkUsageLimits', async (t) => {
  await t.test('passes silently (returns the status) when both quota and rate limit are within bounds', async () => {
    mockQuotaConfig(t, null);
    mockUsageWindow(t, { periodTokens: 10, periodCallCount: 1, windowCallCount: 1 });
    const status = await aiCostControlService.checkUsageLimits({}, 'c1');
    assert.equal(status.quota.withinBudget, true);
  });

  await t.test('throws AiQuotaExceededError when over the monthly token quota', async () => {
    mockQuotaConfig(t, { monthlyTokenQuota: 100 });
    mockUsageWindow(t, { periodTokens: 500, periodCallCount: 3, windowCallCount: 1 });
    await assert.rejects(
      () => aiCostControlService.checkUsageLimits({}, 'c1'),
      aiCostControlService.AiQuotaExceededError,
    );
  });

  await t.test('throws AiRateLimitExceededError when under quota but over the per-minute rate limit', async () => {
    mockQuotaConfig(t, null);
    mockUsageWindow(t, { periodTokens: 10, periodCallCount: 40, windowCallCount: globalConfig.aiRateLimitPerMinute + 5 });
    await assert.rejects(
      () => aiCostControlService.checkUsageLimits({}, 'c1'),
      aiCostControlService.AiRateLimitExceededError,
    );
  });

  await t.test('quota is checked before rate limit — an over-quota-AND-over-rate-limit college gets the quota error', async () => {
    mockQuotaConfig(t, { monthlyTokenQuota: 100 });
    mockUsageWindow(t, { periodTokens: 500, periodCallCount: 100, windowCallCount: globalConfig.aiRateLimitPerMinute + 5 });
    await assert.rejects(
      () => aiCostControlService.checkUsageLimits({}, 'c1'),
      aiCostControlService.AiQuotaExceededError,
    );
  });
});

test('getOpsStatus never throws for an over-quota/over-limit college — an admin dashboard must be able to show that state', async (t) => {
  mockQuotaConfig(t, { monthlyTokenQuota: 100 });
  mockUsageWindow(t, { periodTokens: 500, periodCallCount: 100, windowCallCount: globalConfig.aiRateLimitPerMinute + 5 });
  const status = await aiCostControlService.getOpsStatus({}, 'c1');
  assert.equal(status.quota.withinBudget, false);
  assert.equal(status.rateLimit.withinLimit, false);
});
