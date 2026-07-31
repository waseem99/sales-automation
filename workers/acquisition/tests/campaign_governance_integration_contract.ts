import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  campaignRunDecision,
  createCampaignGovernance,
  detectCampaignOverlaps,
  detectEquivalentSearches,
  stableSearchFingerprint,
  transitionCampaignState,
  updateCampaignSearches,
} from '../../../packages/campaign-governance/src/index.js';

const cwd = process.cwd();
const root = existsSync(resolve(cwd, 'api/acquisition-ingest.ts')) ? cwd : resolve(cwd, '..', '..');
const api = readFileSync(resolve(root, 'api/acquisition-ingest.ts'), 'utf8');
const runtime = readFileSync(resolve(root, 'vercel/acquisition-campaign-governance-runtime.ts'), 'utf8');
const governance = readFileSync(resolve(root, 'packages/campaign-governance/src/index.ts'), 'utf8');

const campaignCall = 'const campaignResponse = await applyCampaignEngineAfterIntake';
const governanceCall = 'const governanceResponse = await applyCampaignGovernanceAfterIntake';
const catalogueCall = 'const catalogueResponse = await applyCommercialCatalogueAfterIntake';
assert(api.indexOf(campaignCall) >= 0);
assert(api.indexOf(governanceCall) > api.indexOf(campaignCall));
assert(api.indexOf(catalogueCall) > api.indexOf(governanceCall));

for (const marker of [
  "CAMPAIGN_GOVERNANCE_VERSION = 'campaign-governance.v1'",
  "'draft' | 'on_hold' | 'pilot' | 'active' | 'paused' | 'retired'",
  'transitionHistory',
  'searchHistory',
  'captureHistory',
  'activationPrerequisites',
  'cataloguePinned',
  'lastManualReviewAt',
  'searchFingerprint',
  'searchDriftWarning',
  'detectEquivalentSearches',
  'detectCampaignOverlaps',
  'lastSuccessfulCaptureAt',
  'scheduleEnabled',
  'externalActionAutomated: false',
]) {
  assert(governance.includes(marker), `Campaign governance contract is missing ${marker}`);
}

for (const marker of [
  'campaignGovernanceDecision',
  'campaignGovernanceRecord',
  'campaignScheduleEnabled',
  "disposition: ['priority_a', 'priority_b'].includes(currentDisposition ?? '') ? 'research'",
  'Campaign is not registered in the versioned governance portfolio.',
  'pausedAndRetiredRunDisabled: true',
  'lifecycleEnforcedServerSide: true',
  'externalActionAutomated: false',
]) {
  assert(runtime.includes(marker), `Campaign governance runtime is missing ${marker}`);
}

const reviewedAt = '2026-07-31T12:00:00.000Z';
const campaign = createCampaignGovernance({
  campaignId: 'integration-campaign',
  version: 1,
  name: 'Integration Campaign',
  owner: 'Named Owner',
  state: 'draft',
  offerId: 'managed_software_ai_delivery',
  offerVersion: 1,
  route: 'delivery_partner',
  searches: [{
    searchId: 'integration-search',
    source: 'linkedin',
    label: 'Agency delivery demand',
    url: 'https://www.linkedin.com/search/results/content/?keywords=software%20agency%20delivery%20partner&utm_source=x',
    criteria: {intent: ['capacity need', 'vendor request'], geography: 'global'},
  }],
  activationEvidence: {
    cataloguePinned: true,
    offerReadinessStatus: 'outreach_ready_limited',
    lastManualReviewAt: reviewedAt,
    reviewReason: 'Controlled pilot reviewed.',
  },
  createdAt: reviewedAt,
  createdBy: 'reviewer@codistan.org',
});
assert.equal(campaignRunDecision(campaign).allowed, false);
const pilot = transitionCampaignState(campaign, 'pilot', {
  actor: 'reviewer@codistan.org',
  reason: 'Start controlled pilot.',
  occurredAt: '2026-07-31T12:15:00.000Z',
});
assert.equal(campaignRunDecision(pilot).allowed, true);
assert.equal(pilot.scheduleEnabled, true);
const paused = transitionCampaignState(pilot, 'paused', {
  actor: 'reviewer@codistan.org',
  reason: 'Pause for review.',
  occurredAt: '2026-07-31T13:00:00.000Z',
});
assert.equal(campaignRunDecision(paused).allowed, false);
assert.equal(paused.scheduleEnabled, false);
assert.equal(paused.searchHistory.length, 0);
assert.equal(paused.transitionHistory.length, 2);

const drifted = updateCampaignSearches(pilot, [{
  searchId: 'integration-search',
  source: 'linkedin',
  label: 'Expanded agency delivery demand',
  url: 'https://www.linkedin.com/search/results/content/?keywords=software%20agency%20delivery%20overflow%20partner',
  criteria: {intent: ['capacity need', 'vendor request'], geography: ['usa', 'canada']},
}], {
  actor: 'reviewer@codistan.org',
  reason: 'Expanded target scope.',
  occurredAt: '2026-08-01T09:00:00.000Z',
});
assert.equal(campaignRunDecision(drifted).allowed, false);
assert.match(drifted.searchDriftWarning ?? '', /manual review is required/i);
assert.equal(drifted.scheduleEnabled, false);
assert.equal(drifted.searchHistory[0]?.driftDetected, true);

const firstFingerprint = stableSearchFingerprint({
  searchId: 'a', source: 'upwork', label: 'First',
  url: 'https://www.upwork.com/nx/search/jobs/?q=saas%20development&utm_source=x&sort=recency',
  criteria: {budget: 5000, skills: ['Node.js', 'React']},
});
const secondFingerprint = stableSearchFingerprint({
  searchId: 'b', source: 'upwork', label: 'Second',
  url: 'https://www.upwork.com/nx/search/jobs/?sort=recency&q=saas%20development',
  criteria: {skills: ['react', 'node js'], budget: 5000},
});
assert.equal(firstFingerprint, secondFingerprint);

const equivalentA = createCampaignGovernance({
  ...campaign,
  campaignId: 'equivalent-a',
  version: 1,
  state: 'pilot',
  searches: [{searchId: 'ea', source: 'upwork', label: 'SaaS jobs', url: 'https://www.upwork.com/nx/search/jobs/?q=saas%20development'}],
  createdAt: reviewedAt,
  createdBy: 'reviewer@codistan.org',
});
const equivalentB = createCampaignGovernance({
  ...campaign,
  campaignId: 'equivalent-b',
  version: 1,
  state: 'pilot',
  searches: [{searchId: 'eb', source: 'upwork', label: 'Same SaaS jobs', url: 'https://www.upwork.com/nx/search/jobs/?utm_source=x&q=saas%20development'}],
  createdAt: reviewedAt,
  createdBy: 'reviewer@codistan.org',
});
assert.equal(detectEquivalentSearches([equivalentA, equivalentB]).length, 1);
assert.ok(detectCampaignOverlaps([equivalentA, equivalentB], 0.2).length >= 1);

const combined = `${api}\n${runtime}\n${governance}`.toLowerCase();
for (const prohibited of [
  'externalactionautomated: true',
  'external_action_performed: true',
  'automaticsendingenabled: true',
]) {
  assert(!combined.includes(prohibited), `Automatic external-action boundary violated: ${prohibited}`);
}

console.log('Campaign governance integration contract passed.');
