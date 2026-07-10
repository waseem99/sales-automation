import assert from 'node:assert/strict';
import { generateDrafts } from '@sales-automation/drafting';
import { matchPortfolio } from '@sales-automation/portfolio-matching';
import { recommendProfile } from '@sales-automation/routing';
import { scoreLead } from '@sales-automation/scoring';
import { sampleLeads, samplePortfolioItems } from '@sales-automation/fixtures';
import {
  buildAlertPlan,
  createDashboardAlertAdapter,
  createExternalChannelPlaceholderAdapter,
  createLogAlertAdapter,
  createSlackWebhookAlertAdapter,
  deliverAlert,
  deliverAlertAsync,
  formatSlackWebhookPayload,
  isDuplicateAlert,
  type AlertDeliveryAdapter,
  type SlackWebhookFetch,
} from './index.js';

const generatedAt = '2026-07-08T18:30:00.000Z';
const ragLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-rag-001');
assert.ok(ragLead, 'RAG sample lead should exist');

const ragPortfolioMatches = matchPortfolio({ lead: ragLead, portfolioItems: samplePortfolioItems });
const ragScore = scoreLead({
  lead: ragLead,
  matchingPortfolioCount: ragPortfolioMatches.length,
  hasStrongBuyerSignal: true,
  hasStrongBudgetSignal: true,
});
const ragProfile = recommendProfile(ragLead, ragScore);
const ragDrafts = generateDrafts({
  lead: ragLead,
  score: ragScore,
  profileRecommendation: ragProfile,
  portfolioMatches: ragPortfolioMatches,
  generatedAt,
});

const ragAlert = buildAlertPlan({
  lead: ragLead,
  score: ragScore,
  profileRecommendation: ragProfile,
  portfolioMatches: ragPortfolioMatches,
  drafts: ragDrafts,
  recommendedNextAction: 'Review immediately and prepare a tailored response.',
});

assert.equal(ragAlert.shouldAlert, true);
assert.equal(ragAlert.priority, 'urgent');
assert.ok(ragAlert.channels.includes('dashboard'));
assert.ok(ragAlert.channels.includes('log'));
assert.equal(ragAlert.payload.sourceUrl, ragLead.sourceUrl);
assert.equal(isDuplicateAlert(ragAlert.dedupeKey, new Set([ragAlert.dedupeKey])), true);

const dryRunDelivery = deliverAlert({ plan: ragAlert, deliveredAt: generatedAt });
assert.equal(dryRunDelivery.attempted, true);
assert.equal(dryRunDelivery.records.length, 2);
assert.ok(dryRunDelivery.records.every((record) => record.status === 'dry_run'));
assert.ok(dryRunDelivery.records.every((record) => record.message.includes('No')));

const duplicateDelivery = deliverAlert({
  plan: ragAlert,
  previouslySentKeys: new Set([ragAlert.dedupeKey]),
  dryRun: false,
});
assert.equal(duplicateDelivery.attempted, false);
assert.equal(duplicateDelivery.records.length, 0);
assert.ok(duplicateDelivery.skippedReason?.includes('dedupe'));

const realSafeDelivery = deliverAlert({
  plan: ragAlert,
  dryRun: false,
  deliveredAt: generatedAt,
  adapters: {
    log: createLogAlertAdapter(generatedAt),
    dashboard: createDashboardAlertAdapter(generatedAt),
  },
});
assert.equal(realSafeDelivery.attempted, true);
assert.equal(realSafeDelivery.records.length, 2);
assert.ok(realSafeDelivery.records.every((record) => record.status === 'sent'));
assert.ok(realSafeDelivery.records.some((record) => record.providerMessageId === `log:${ragAlert.dedupeKey}`));

const configuredExternalAlert = buildAlertPlan({
  lead: ragLead,
  score: ragScore,
  profileRecommendation: ragProfile,
  portfolioMatches: ragPortfolioMatches,
  drafts: ragDrafts,
  recommendedNextAction: 'Review immediately and prepare a tailored response.',
  configuredChannels: ['email', 'slack', 'whatsapp'],
});
const externalPlaceholderDelivery = deliverAlert({
  plan: configuredExternalAlert,
  dryRun: false,
  adapters: {
    email: createExternalChannelPlaceholderAdapter('email'),
    slack: createExternalChannelPlaceholderAdapter('slack'),
    whatsapp: createExternalChannelPlaceholderAdapter('whatsapp'),
  },
});
assert.equal(externalPlaceholderDelivery.records.length, 3);
assert.ok(externalPlaceholderDelivery.records.every((record) => record.status === 'skipped'));
assert.ok(externalPlaceholderDelivery.records.every((record) => record.message.includes('not configured')));

const failingAdapter: AlertDeliveryAdapter = {
  channel: 'dashboard',
  send: () => {
    throw new Error('dashboard unavailable');
  },
};
const failedDelivery = deliverAlert({
  plan: ragAlert,
  dryRun: false,
  adapters: {
    dashboard: failingAdapter,
    log: createLogAlertAdapter(generatedAt),
  },
  deliveredAt: generatedAt,
});
assert.ok(failedDelivery.records.some((record) => record.status === 'failed' && record.error === 'dashboard unavailable'));

const slackRequests: Array<{ url: string; body: string }> = [];
let slackAttempts = 0;
const slackFetch: SlackWebhookFetch = async (url, init) => {
  slackAttempts += 1;
  slackRequests.push({ url, body: init.body });
  if (slackAttempts === 1) {
    return {
      ok: false,
      status: 500,
      async text() { return 'temporary failure'; },
      headers: { get() { return null; } },
    };
  }
  return {
    ok: true,
    status: 200,
    async text() { return 'ok'; },
    headers: { get() { return null; } },
  };
};
const retryDelays: number[] = [];
const slackPlan = { ...ragAlert, channels: ['slack'] as const };
const slackDelivery = await deliverAlertAsync({
  plan: slackPlan,
  dryRun: false,
  deliveredAt: generatedAt,
  adapters: {
    slack: createSlackWebhookAlertAdapter({
      webhookUrl: 'https://hooks.slack.test/services/example',
      dashboardBaseUrl: 'https://leads.codistan.test',
      fetchImpl: slackFetch,
      maxAttempts: 2,
      retryDelayMs: 25,
      sleep: async (milliseconds) => { retryDelays.push(milliseconds); },
      now: () => generatedAt,
    }),
  },
});
assert.equal(slackDelivery.attempted, true);
assert.equal(slackDelivery.records[0]?.status, 'sent');
assert.equal(slackAttempts, 2);
assert.deepEqual(retryDelays, [25]);
assert.equal(slackRequests.length, 2);
const slackPayload = JSON.parse(slackRequests[1]!.body) as ReturnType<typeof formatSlackWebhookPayload>;
assert.match(slackPayload.text, /score/i);
assert.ok(slackPayload.blocks.some((block) => block.type === 'actions'));
assert.match(JSON.stringify(slackPayload), /Open source/);
assert.match(JSON.stringify(slackPayload), /Open Lead Desk/);

const failedSlackDelivery = await deliverAlertAsync({
  plan: slackPlan,
  dryRun: false,
  deliveredAt: generatedAt,
  adapters: {
    slack: createSlackWebhookAlertAdapter({
      webhookUrl: 'https://hooks.slack.test/services/fail',
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        async text() { return 'invalid_payload'; },
      }),
      maxAttempts: 3,
      retryDelayMs: 0,
    }),
  },
});
assert.equal(failedSlackDelivery.records[0]?.status, 'failed');
assert.match(failedSlackDelivery.records[0]?.error ?? '', /HTTP 400/);

await assert.rejects(
  async () => createSlackWebhookAlertAdapter({ webhookUrl: 'http://hooks.slack.test/insecure' }),
  /HTTPS/,
);

const lowBudgetLead = sampleLeads.find((lead) => lead.id === 'lead-upwork-lowbudget-001');
assert.ok(lowBudgetLead, 'Low budget sample lead should exist');

const lowBudgetScore = scoreLead({
  lead: lowBudgetLead,
  matchingPortfolioCount: 0,
  hasStrongBuyerSignal: false,
  hasStrongBudgetSignal: false,
  redFlags: [
    { code: 'low_budget_signal', severity: 'high', reason: 'Budget signal appears too low for Codistan target opportunities.' },
    { code: 'free_work_request', severity: 'high', reason: 'Lead appears to request free or unpaid sample work.' },
  ],
});
const lowBudgetProfile = recommendProfile(lowBudgetLead, lowBudgetScore);
const lowBudgetAlert = buildAlertPlan({
  lead: lowBudgetLead,
  score: lowBudgetScore,
  profileRecommendation: lowBudgetProfile,
  portfolioMatches: [],
  drafts: [],
  recommendedNextAction: 'Reject or archive.',
});

assert.equal(lowBudgetAlert.shouldAlert, false);
assert.deepEqual(lowBudgetAlert.channels, []);
const skippedLowBudget = deliverAlert({ plan: lowBudgetAlert, dryRun: false });
assert.equal(skippedLowBudget.attempted, false);
assert.equal(skippedLowBudget.skippedReason, 'Alert plan is not eligible for delivery.');

console.log('Alert planner, delivery adapter, and Slack webhook tests passed.');
