import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  analyzeTenderText,
  applyAutomaticAssignment,
  buildOwnerWorkload,
  buildTenderMetadata,
  EXPANDED_PUBLIC_TENDER_SOURCES,
  tenderCandidateToLead,
  validateTenderCandidate,
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
  const runnerSource = readFileSync(new URL('../packages/prospect-discovery/src/tender-runner.ts', import.meta.url), 'utf8');
  const documentSource = readFileSync(new URL('../packages/prospect-discovery/src/tender-documents.ts', import.meta.url), 'utf8');
  assert.match(tenderApiSource, /runTenderDiscovery/);
  assert.match(tenderApiSource, /deleteLeadRecords/);
  assert.match(tenderApiSource, /shouldRemoveStoredTenderLead/);
  assert.match(tenderApiSource, /TENDER_DOCUMENT_INTELLIGENCE_ENABLED/);
  assert.match(tenderApiSource, /TENDER_EXPANDED_PUBLIC_SOURCES_ENABLED/);
  assert.match(tenderApiSource, /documentIntelligenceCount/);
  assert.match(tenderApiSource, /amendmentCount/);
  assert.match(tenderPageSource, /Tender & RFP Pipeline/);
  assert.match(tenderPageSource, /Refresh tenders & documents/);
  assert.match(tenderPageSource, /Jawad’s queue/);
  assert.match(tenderPageSource, /validateStoredTenderLead/);
  assert.match(tenderPageSource, /Open one-page bid\/no-bid brief/);
  assert.match(tenderPageSource, /Changed — re-review/);
  assert.match(runnerSource, /enrichTenderDocumentIntelligence/);
  assert.match(runnerSource, /tender_amendment::changed/);
  assert.match(documentSource, /Human decision required/);
  assert.match(documentSource, /extractTextFromPdfBytes/);
  assert.ok(EXPANDED_PUBLIC_TENDER_SOURCES.some((source) => source.portal === 'Punjab PPRA'));
  assert.ok(EXPANDED_PUBLIC_TENDER_SOURCES.some((source) => source.portal === 'BC Bid'));
  assert.ok(EXPANDED_PUBLIC_TENDER_SOURCES.some((source) => source.portal === 'SEAO Quebec'));

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
  assert.equal(validateTenderCandidate(candidate).qualified, true);
  const metadata = buildTenderMetadata(candidate, '2026-07-14T12:00:00.000Z');
  assert.ok(metadata);
  assert.ok(metadata.closeabilityScore >= 80);
  assert.equal(metadata.recommendation, 'priority_bid');

  const intelligence = analyzeTenderText({
    candidate,
    checkedAt: '2026-07-14T12:00:00.000Z',
    format: 'notice_summary',
    text: `Scope of Work: The vendor shall design and implement a digital service platform.
Deliverables
- Develop the web application and API integrations.
- Migrate data and train users.
Eligibility
- Minimum five years experience and three similar projects.
Evaluation Criteria
- Technical proposal 70 points.
- Financial proposal 30 points.
Project Manager and Solution Architect CVs are required.
Bid security: CAD 10,000.
Submit proposals through the CanadaBuys electronic portal.`,
  });
  assert.ok(intelligence.contentHash);
  assert.match(intelligence.scopeSummary ?? '', /digital service platform/i);
  assert.ok(intelligence.deliverables.length > 0);
  assert.ok(intelligence.eligibilityRequirements.length > 0);
  assert.ok(intelligence.evaluationCriteria.length > 0);
  assert.ok(intelligence.requiredTeamRoles.includes('Project Manager'));
  assert.match(intelligence.bidNoBidBrief, /BID \/ NO-BID BRIEF/);
  assert.match(intelligence.bidNoBidBrief, /Human decision required/);

  candidate.tender!.documentIntelligence = intelligence;
  const lead = tenderCandidateToLead(candidate, '2026-07-14T12:00:00.000Z');
  assert.equal(lead.tender?.documentIntelligence?.contentHash, intelligence.contentHash);
  const assignment = applyAutomaticAssignment(lead, buildOwnerWorkload([]), '2026-07-14T12:00:00.000Z');
  assert.equal(assignment.lead.owner, 'jawad.jutt@codistan.org');
  assert.equal(assignment.approach.channel, 'procurement_portal');

  const rejectedUrls = [
    'https://www.merriam-webster.com/thesaurus/request',
    'https://remoteok.com/remote-jobs/remote-assistente-de-gente-e-cultura-junior-joyn-group-1134711',
    'https://www.runoob.com/python3/python-requests.html',
    'https://blog.csdn.net/python03012/article/details/137588709',
  ];
  for (const sourceUrl of rejectedUrls) {
    const falsePositive: DiscoveryCandidate = {
      ...candidate,
      sourceName: 'Private and nonprofit public notices',
      sourceUrl,
      title: 'Python request tutorial remote job',
      summary: 'Dictionary, tutorial, documentation, code example or job opening.',
      tender: {
        ...candidate.tender!,
        portal: 'Private and nonprofit public notices',
      },
    };
    const validation = validateTenderCandidate(falsePositive);
    assert.equal(validation.qualified, false, `${sourceUrl} must not qualify`);
    assert.equal(validation.hardReject, true, `${sourceUrl} must be hard rejected`);
  }

  console.log('Tender source trust, document intelligence, bid briefs, amendment UI, Jawad routing and Vercel workspace smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
