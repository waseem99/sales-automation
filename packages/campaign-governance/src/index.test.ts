import assert from 'node:assert/strict';
import {
  applyPortfolioWarnings,
  campaignRunDecision,
  createCampaignGovernance,
  DEFAULT_CAMPAIGN_GOVERNANCE,
  detectCampaignOverlaps,
  detectEquivalentSearches,
  recordCampaignCapture,
  reviewCampaign,
  stableSearchFingerprint,
  transitionCampaignState,
  updateCampaignSearches,
  type CampaignGovernanceRecord,
  type CampaignSearchInput,
} from './index.js';

const now = '2026-07-31T12:00:00.000Z';

{
  const fintech = DEFAULT_CAMPAIGN_GOVERNANCE.find((item) => item.campaignId === 'fintech_buyer_direct')!;
  const overflow = DEFAULT_CAMPAIGN_GOVERNANCE.find((item) => item.campaignId === 'software_ai_overflow_partners')!;
  assert.equal(fintech.state, 'on_hold');
  assert.equal(campaignRunDecision(fintech).allowed, false);
  assert.match(campaignRunDecision(fintech).blockers.join(' '), /state on_hold is not runnable/i);
  assert.equal(overflow.state, 'pilot');
  assert.equal(campaignRunDecision(overflow).allowed, true);
  assert.equal(overflow.scheduleEnabled, true);
  assert.equal(overflow.owner, 'Waseem');
  assert.equal(overflow.searchFingerprint.length, 64);
  assert.equal(overflow.externalActionAutomated, false);
  assert.equal(Object.isFrozen(overflow), true);
}

const base = createCampaignGovernance({
  campaignId: 'test-campaign',
  version: 1,
  name: 'Test Campaign',
  owner: 'Seller Owner',
  state: 'draft',
  offerId: 'managed_software_ai_delivery',
  offerVersion: 1,
  route: 'delivery_partner',
  searches: [{
    searchId: 'test-search',
    source: 'linkedin',
    label: 'Implementation partner demand',
    url: 'https://www.linkedin.com/search/results/content/?keywords=software%20implementation%20partner&utm_source=test',
    criteria: {intent: ['vendor request', 'capacity need'], geography: 'global'},
  }],
  activationEvidence: {
    cataloguePinned: true,
    offerReadinessStatus: 'outreach_ready_limited',
    lastManualReviewAt: now,
    reviewReason: 'Initial controlled review.',
  },
  createdAt: now,
  createdBy: 'reviewer@codistan.org',
});

{
  const pilot = transitionCampaignState(base, 'pilot', {
    actor: 'reviewer@codistan.org',
    reason: 'Start controlled pilot.',
    occurredAt: '2026-07-31T12:10:00.000Z',
  });
  assert.equal(pilot.state, 'pilot');
  assert.equal(pilot.scheduleEnabled, true);
  assert.equal(pilot.transitionHistory.length, 1);
  assert.equal(pilot.transitionHistory[0]?.priorState, 'draft');
  assert.equal(pilot.transitionHistory[0]?.newState, 'pilot');
  const active = transitionCampaignState(pilot, 'active', {
    actor: 'reviewer@codistan.org',
    reason: 'Pilot evidence accepted.',
    occurredAt: '2026-07-31T13:00:00.000Z',
  });
  assert.equal(active.state, 'active');
  assert.equal(active.scheduleEnabled, true);
  const paused = transitionCampaignState(active, 'paused', {
    actor: 'reviewer@codistan.org',
    reason: 'Pause for commercial review.',
    occurredAt: '2026-07-31T14:00:00.000Z',
  });
  assert.equal(paused.scheduleEnabled, false);
  assert.equal(paused.transitionHistory.length, 3);
  const retired = transitionCampaignState(paused, 'retired', {
    actor: 'reviewer@codistan.org',
    reason: 'Campaign is no longer current.',
    occurredAt: '2026-07-31T15:00:00.000Z',
  });
  assert.equal(retired.scheduleEnabled, false);
  assert.equal(retired.searches.length, 1, 'retired campaign preserves search history');
  assert.equal(retired.transitionHistory.length, 4);
  assert.throws(() => transitionCampaignState(retired, 'active', {
    actor: 'reviewer@codistan.org',
    reason: 'Invalid direct reactivation.',
  }), /invalid campaign transition/i);
}

{
  const incomplete = createCampaignGovernance({
    campaignId: 'incomplete',
    version: 1,
    name: 'Incomplete Campaign',
    owner: 'Owner',
    state: 'draft',
    offerId: 'managed_software_ai_delivery',
    offerVersion: 1,
    route: 'direct_buyer',
    searches: [{searchId: 's1', source: 'upwork', label: 'SaaS jobs', url: 'https://www.upwork.com/nx/search/jobs/?q=saas'}],
    activationEvidence: {cataloguePinned: false, offerReadinessStatus: 'research_only'},
    createdAt: now,
    createdBy: 'reviewer@codistan.org',
  });
  assert.throws(() => transitionCampaignState(incomplete, 'pilot', {
    actor: 'reviewer@codistan.org',
    reason: 'Attempt activation without evidence.',
  }), /catalogue must be pinned|manual campaign review|required.*not runnable/i);
  assert.throws(() => createCampaignGovernance({
    ...{
      campaignId: 'ownerless', version: 1, name: 'Ownerless', state: 'draft' as const,
      offerId: 'managed_software_ai_delivery', offerVersion: 1, route: 'direct_buyer' as const,
      searches: [], activationEvidence: {cataloguePinned: true, offerReadinessStatus: 'outreach_ready' as const},
      createdAt: now, createdBy: 'reviewer@codistan.org',
    },
    owner: ' ',
  }), /owner is required/i);
}

{
  const pilot = transitionCampaignState(base, 'pilot', {
    actor: 'reviewer@codistan.org',
    reason: 'Start pilot.',
  });
  const changed = updateCampaignSearches(pilot, [{
    searchId: 'test-search',
    source: 'linkedin',
    label: 'Implementation and overflow demand',
    url: 'https://www.linkedin.com/search/results/content/?keywords=software%20implementation%20overflow%20partner',
    criteria: {intent: ['vendor request', 'capacity need'], geography: ['usa', 'canada']},
  }], {
    actor: 'reviewer@codistan.org',
    reason: 'Expand search geography and overflow terms.',
    occurredAt: '2026-08-01T09:00:00.000Z',
  });
  assert.notEqual(changed.searchFingerprint, pilot.searchFingerprint);
  assert.match(changed.searchDriftWarning ?? '', /manual review is required/i);
  assert.equal(changed.scheduleEnabled, false);
  assert.equal(changed.searchHistory[0]?.driftDetected, true);
  assert.equal(changed.lastManualReviewAt, undefined);
  const reviewed = reviewCampaign(changed, {
    actor: 'reviewer@codistan.org',
    reason: 'New search scope reviewed and approved.',
    occurredAt: '2026-08-01T10:00:00.000Z',
  });
  assert.equal(reviewed.activationBlockers.length, 1, 'drift warning remains until a versioned search record is intentionally accepted');
  assert.match(reviewed.activationBlockers[0] ?? '', /search drift/i);
}

{
  const normalizedA = stableSearchFingerprint({
    searchId: 'a',
    source: 'linkedin',
    label: 'A',
    url: 'https://www.linkedin.com/search/results/content/?keywords=software%20partner&utm_source=test&sortBy=date_posted',
    criteria: {geography: ['USA', 'Canada'], intent: 'Vendor Request'},
  });
  const normalizedB = stableSearchFingerprint({
    searchId: 'b',
    source: 'linkedin',
    label: 'Different label',
    url: 'https://www.linkedin.com/search/results/content/?sortBy=date_posted&keywords=software%20partner',
    criteria: {intent: 'vendor request', geography: ['canada', 'usa']},
  });
  assert.equal(normalizedA, normalizedB, 'tracking, parameter order, IDs and labels do not change search identity');
}

function withSearch(campaignId: string, search: CampaignSearchInput): CampaignGovernanceRecord {
  return createCampaignGovernance({
    campaignId,
    version: 1,
    name: campaignId,
    owner: 'Owner',
    state: 'pilot',
    offerId: 'managed_software_ai_delivery',
    offerVersion: 1,
    route: 'delivery_partner',
    searches: [search],
    activationEvidence: {
      cataloguePinned: true,
      offerReadinessStatus: 'outreach_ready_limited',
      lastManualReviewAt: now,
      reviewReason: 'Reviewed.',
    },
    createdAt: now,
    createdBy: 'reviewer@codistan.org',
  });
}

{
  const left = withSearch('left', {
    searchId: 'left-search', source: 'sales_navigator', label: 'Agency delivery leaders',
    url: 'https://www.linkedin.com/sales/search/people?keywords=software%20agency%20delivery%20director',
    criteria: {role: ['delivery director', 'operations director'], company: 'software agency'},
  });
  const equivalent = withSearch('equivalent', {
    searchId: 'equivalent-search', source: 'sales_navigator', label: 'Same criteria',
    url: 'https://www.linkedin.com/sales/search/people?utm_source=x&keywords=software%20agency%20delivery%20director',
    criteria: {company: 'software agency', role: ['operations director', 'delivery director']},
  });
  const overlap = withSearch('overlap', {
    searchId: 'overlap-search', source: 'sales_navigator', label: 'Agency operations leaders',
    url: 'https://www.linkedin.com/sales/search/people?keywords=software%20agency%20operations%20director',
    criteria: {role: ['operations director', 'delivery head'], company: 'software agency'},
  });
  const equivalents = detectEquivalentSearches([left, equivalent, overlap]);
  assert.equal(equivalents.length, 1);
  assert.deepEqual(equivalents[0]?.campaigns.map((item) => item.campaignId).sort(), ['equivalent', 'left']);
  const overlaps = detectCampaignOverlaps([left, overlap], 0.4);
  assert.equal(overlaps.length, 1);
  assert.ok((overlaps[0]?.sharedTokens.length ?? 0) > 0);
  const warned = applyPortfolioWarnings([left, equivalent, overlap]);
  assert.ok(warned.find((item) => item.campaignId === 'left')?.overlapWarnings.length);
}

{
  const pilot = transitionCampaignState(base, 'pilot', {actor: 'reviewer@codistan.org', reason: 'Pilot approved.'});
  const captured = recordCampaignCapture(pilot, {
    actor: 'collector@codistan.local',
    source: 'linkedin',
    capturedRecords: 4,
    occurredAt: '2026-08-01T11:00:00.000Z',
  });
  assert.equal(captured.lastSuccessfulCaptureAt, '2026-08-01T11:00:00.000Z');
  assert.equal(captured.captureHistory[0]?.capturedRecords, 4);
  assert.equal(captured.captureHistory[0]?.externalActionAutomated, false);
  assert.throws(() => recordCampaignCapture(base, {
    actor: 'collector@codistan.local', source: 'linkedin', capturedRecords: 1,
  }), /campaign capture is blocked/i);
}

console.log('Campaign governance tests passed.');
