import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyAutomaticAssignment,
  buildOwnerWorkload,
  buildTenderMetadata,
  tenderCandidateToLead,
  type DiscoveryCandidate,
} from '@sales-automation/prospect-discovery';

async function main(): Promise<void> {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
    functions?: Record<string, { maxDuration?: number }>;
    crons?: Array<{ path: string; schedule: string }>;
    rewrites?: Array<{ source: string; destination: string }>;
  };
  assert.equal(config.functions?.['api/tenders.ts']?.maxDuration, 300);
  assert.equal(config.functions?.['api/tender-discovery.ts']?.maxDuration, 300);
  assert.equal(config.crons?.find((cron) => cron.path === '/api/tender-discovery')?.schedule, '15 */6 * * *');
  assert.equal(config.rewrites?.find((rewrite) => rewrite.source === '/tenders')?.destination, '/api/tenders');

  const tenderApiSource = readFileSync(new URL('../api/tender-discovery.ts', import.meta.url), 'utf8');
  const tenderPageSource = readFileSync(new URL('../api/tenders.ts', import.meta.url), 'utf8');
  assert.match(tenderApiSource, /runTenderDiscovery/);
  assert.match(tenderApiSource, /tender-rfp-discovery/);
  assert.match(tenderPageSource, /Tender & RFP Pipeline/);
  assert.match(tenderPageSource, /Refresh tenders & RFPs/);
  assert.match(tenderPageSource, /Jawad’s queue/);

  const candidate: DiscoveryCandidate = {
    sourceName: 'CanadaBuys',
    sourceType: 'procurement',
    sourceUrl: 'https://canadabuys.canada.ca/en/tender-opportunities/example-rfp',
    title: 'Request for Proposal for software development and digital platform implementation',
    summary: 'RFP for web application development, mobile application, system integration, API services and ongoing maintenance. International suppliers may submit electronically.',
    publishedAt: '2026-07-14T08:00:00.000Z',
    companyName: 'Canadian Public Buyer',
    companyWebsite: 'https://canadabuys.canada.ca/',
    country: 'Canada',
    opportunityStatus: 'live_opportunity',
    tender: {
      portal: 'CanadaBuys',
      reference: 'CB-2026-001',
      sector: 'public',
      opportunityType: 'rfp',
      publishedAt: '2026-07-14T08:00:00.000Z',
      deadline: '2026-07-28T12:00:00.000Z',
      estimatedValue: 'CAD 500,000',
      submissionMethod: 'Electronic submission',
      localPresenceRequired: 'no',
      consortiumAllowed: 'yes',
    },
  };
  const metadata = buildTenderMetadata(candidate, '2026-07-14T12:00:00.000Z');
  assert.ok(metadata);
  assert.ok(metadata.closeabilityScore >= 80);
  assert.equal(metadata.recommendation, 'priority_bid');

  const lead = tenderCandidateToLead(candidate, '2026-07-14T12:00:00.000Z');
  const assignment = applyAutomaticAssignment(lead, buildOwnerWorkload([]), '2026-07-14T12:00:00.000Z');
  assert.equal(assignment.lead.owner, 'jawad.jutt@codistan.org');
  assert.equal(assignment.approach.channel, 'procurement_portal');

  console.log('Tender sources, qualification, Jawad routing and Vercel workspace smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
