import assert from 'node:assert/strict';
import {
  applyAutomaticAssignment,
  buildOwnerWorkload,
  recommendProspectApproach,
} from './assignment.js';
import {
  buildTenderMetadata,
  classifyTenderOpportunityType,
  collectPpraTenderCandidates,
  isSoftwareTender,
} from './tenders.js';
import { tenderCandidateToLead } from './tender-runner.js';
import type { DiscoveryCandidate } from './types.js';

const capturedAt = '2026-07-14T12:00:00.000Z';
const candidate: DiscoveryCandidate = {
  sourceName: 'Pakistan PPRA/EPADS',
  sourceType: 'procurement',
  sourceUrl: 'https://epms.ppra.gov.pk/public/tenders/tender-detail/TS123456E',
  title: 'Request for proposal for software development and digital services platform',
  summary: 'RFP for design, development, system integration, implementation and maintenance of a web application, mobile application, management dashboard and API platform. International firms may participate through electronic submission.',
  publishedAt: '2026-07-13T08:00:00.000Z',
  companyName: 'Federal Digital Services Agency',
  companyWebsite: 'https://ppra.gov.pk/',
  country: 'Pakistan',
  opportunityStatus: 'live_opportunity',
  evidenceSummary: 'Active software-development RFP published on Pakistan PPRA/EPADS.',
  tender: {
    portal: 'Pakistan PPRA/EPADS',
    reference: 'TS123456E',
    sector: 'public',
    opportunityType: 'rfp',
    publishedAt: '2026-07-13T08:00:00.000Z',
    deadline: '2026-07-25T12:00:00.000Z',
    estimatedValue: 'PKR 25,000,000',
    submissionMethod: 'EPADS electronic submission',
    localPresenceRequired: 'no',
    consortiumAllowed: 'yes',
  },
};

assert.equal(isSoftwareTender(`${candidate.title} ${candidate.summary}`), true);
assert.equal(isSoftwareTender('Tender for supply of laptop computers, printers and toner cartridges'), false);
assert.equal(classifyTenderOpportunityType('Expression of Interest for IT consulting services'), 'eoi');
assert.equal(classifyTenderOpportunityType('Request for Quotation for application maintenance'), 'rfq');

const metadata = buildTenderMetadata(candidate, capturedAt);
assert.ok(metadata);
assert.equal(metadata.portal, 'Pakistan PPRA/EPADS');
assert.equal(metadata.reference, 'TS123456E');
assert.equal(metadata.daysRemaining, 11);
assert.ok(metadata.closeabilityScore >= 80);
assert.equal(metadata.recommendation, 'priority_bid');

const lead = tenderCandidateToLead(candidate, capturedAt);
assert.equal(lead.source, 'public_procurement');
assert.equal(lead.tender?.recommendation, 'priority_bid');
assert.equal(lead.tender?.closeabilityScore, metadata.closeabilityScore);
assert.equal(lead.timelineSignal?.includes('days remaining'), true);

const assignment = applyAutomaticAssignment(lead, buildOwnerWorkload([]), capturedAt);
assert.equal(assignment.assignment.owner, 'jawad.jutt@codistan.org');
assert.equal(assignment.lead.owner, 'jawad.jutt@codistan.org');
assert.equal(assignment.approach.channel, 'procurement_portal');
assert.equal(recommendProspectApproach(assignment.lead).channel, 'procurement_portal');

const localOnly: DiscoveryCandidate = {
  ...candidate,
  sourceUrl: 'https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/local-only',
  title: 'RFP for Canadian government software development services',
  country: 'Canada',
  summary: 'The supplier must be registered in Canada. Consortium and subcontracting are not allowed. Software application development and maintenance services are required.',
  tender: {
    ...candidate.tender!,
    portal: 'CanadaBuys',
    reference: 'CAN-LOCAL-1',
    localPresenceRequired: 'yes',
    consortiumAllowed: 'no',
  },
};
const localOnlyMetadata = buildTenderMetadata(localOnly, capturedAt);
assert.equal(localOnlyMetadata?.recommendation, 'reject');
assert.ok(localOnlyMetadata?.riskFlags.some((risk) => risk.includes('Canadian')));

const ppraHtml = `<table><tbody><tr>
<td>TS987654E</td><td>Request for Proposal for development and implementation of a web portal and management information system</td>
<td>Services</td><td>Federal IT Authority</td><td>Published Jul 13, 2026 09:00 AM</td><td>Closing Jul 28, 2026 11:00 AM</td>
<td><a href="/public/tenders/tender-detail/TS987654E">View tender</a></td>
</tr></tbody></table>`;
const fetchImpl: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes('active-tenders')) return new Response(ppraHtml, { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response('Not found', { status: 404 });
};
const ppra = await collectPpraTenderCandidates(fetchImpl);
assert.equal(ppra.sourceName, 'pakistan_ppra');
assert.equal(ppra.candidates.length, 1);
assert.equal(ppra.candidates[0]?.tender?.reference, 'TS987654E');
assert.equal(ppra.candidates[0]?.country, 'Pakistan');

console.log('Tender source filtering, closeability scoring and Jawad routing tests passed');
