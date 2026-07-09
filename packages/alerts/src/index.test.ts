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
  deliverAlert,
  isDuplicateAlert,
  type AlertDeliveryAdapter,
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

console.log('Alert planner and delivery adapter tests passed.');
