import assert from 'node:assert/strict';
import { samplePortfolioItems } from '@sales-automation/fixtures';
import { InMemoryLeadRepository } from '@sales-automation/storage';
import { InMemoryProspectDiscoveryRunStore } from './run-store.js';
import { runTenderDiscovery } from './tender-runner.js';

const firstCheckedAt = '2026-07-14T19:30:00.000Z';
const secondCheckedAt = '2026-07-14T20:30:00.000Z';
const noticeUrl = 'https://epms.ppra.gov.pk/public/tenders/detail/TS123456E';
let documentVersion = 1;

const activeRows = `<html><body><table><tr>
<td>TS123456E</td>
<td>Request for Proposal for software development and implementation of a digital services platform</td>
<td>Services</td>
<td>Jul 14, 2026</td>
<td>Aug 15, 2026</td>
<td><a href="/public/tenders/detail/TS123456E">View tender notice</a></td>
</tr></table></body></html>`;

const firstDocument = `<html><body>
<h2>Scope of Work</h2><p>The selected firm shall design, develop and deploy a public digital services platform.</p>
<h2>Deliverables</h2><p>Implement the web portal, integrate APIs and train users.</p>
<h2>Eligibility</h2><p>Minimum five years experience and three similar projects are required.</p>
<h2>Evaluation Criteria</h2><p>Technical proposal 70 points and financial proposal 30 points.</p>
<p>Submit through EPADS. Bid security: PKR 500,000.</p>
</body></html>`;

const amendedDocument = `<html><body>
<h2>Corrigendum 1</h2><p>The submission deadline is extended and the mandatory team composition has changed.</p>
<h2>Scope of Work</h2><p>The selected firm shall design, develop and deploy a public digital services platform with a mobile application.</p>
<h2>Deliverables</h2><p>Implement the web portal and mobile app, integrate APIs, migrate data and train users.</p>
<h2>Eligibility</h2><p>Minimum seven years experience and five similar projects are required.</p>
<h2>Evaluation Criteria</h2><p>Technical proposal 80 points and financial proposal 20 points.</p>
<p>Project Manager, Solution Architect and QA Engineer CVs are mandatory. Submit through EPADS. Bid security: PKR 750,000.</p>
</body></html>`;

const fetchImpl: typeof fetch = async (input) => {
  const url = String(input);
  if (url === 'https://epms.ppra.gov.pk/public/tenders/active-tenders') {
    return new Response(activeRows, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (url === noticeUrl) {
    return new Response(documentVersion === 1 ? firstDocument : amendedDocument, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }
  if (url.startsWith('https://www.bing.com/search?format=rss')) {
    return new Response('<?xml version="1.0"?><rss><channel></channel></rss>', {
      status: 200,
      headers: { 'content-type': 'application/rss+xml' },
    });
  }
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
};

const repository = new InMemoryLeadRepository();
const runStore = new InMemoryProspectDiscoveryRunStore();
const first = await runTenderDiscovery({
  repository,
  runStore,
  portfolioItems: samplePortfolioItems,
  fetchImpl,
  now: sequenceClock(firstCheckedAt),
  ppraEnabled: true,
  canadaBuysEnabled: false,
  ungmEnabled: false,
  privateNonprofitTendersEnabled: false,
  expandedPublicTendersEnabled: false,
  tenderDocumentIntelligenceEnabled: true,
  maxCandidates: 10,
});

assert.equal(first.run.newTenderCount, 1);
assert.equal(first.run.tenderDocumentIntelligenceCount, 1);
assert.equal(first.run.tenderAmendmentCount, 0);
const firstRecord = repository.listLeads()[0];
assert.ok(firstRecord);
assert.equal(firstRecord.lead.owner, 'jawad.jutt@codistan.org');
assert.ok(firstRecord.lead.tender?.documentIntelligence?.contentHash);
assert.match(firstRecord.lead.tender?.documentIntelligence?.bidNoBidBrief ?? '', /BID \/ NO-BID BRIEF/);
assert.match(firstRecord.lead.tender?.documentIntelligence?.bidSecurity ?? '', /500,000/);

const firstHash = firstRecord.lead.tender?.documentIntelligence?.contentHash;
documentVersion = 2;
const second = await runTenderDiscovery({
  repository,
  runStore,
  portfolioItems: samplePortfolioItems,
  fetchImpl,
  now: sequenceClock(secondCheckedAt),
  ppraEnabled: true,
  canadaBuysEnabled: false,
  ungmEnabled: false,
  privateNonprofitTendersEnabled: false,
  expandedPublicTendersEnabled: false,
  tenderDocumentIntelligenceEnabled: true,
  maxCandidates: 10,
});

assert.equal(second.run.newTenderCount, 0);
assert.equal(second.run.tenderAmendmentCount, 1);
assert.equal(repository.listLeads().length, 1);
const amended = repository.listLeads()[0];
assert.notEqual(amended.lead.tender?.documentIntelligence?.contentHash, firstHash);
assert.equal(amended.lead.tender?.documentIntelligence?.amendmentStatus, 'changed');
assert.match(amended.lead.tender?.documentIntelligence?.bidNoBidBrief ?? '', /Amendment status: changed/);
assert.match(amended.lead.tender?.documentIntelligence?.bidSecurity ?? '', /750,000/);
assert.ok(amended.notes.some((note) => note.startsWith('tender_amendment::changed::')));
assert.equal(amended.lead.owner, 'jawad.jutt@codistan.org');

console.log('Tender document intelligence persistence and amendment monitoring tests passed');

function sequenceClock(start: string): () => string {
  let offset = 0;
  const base = Date.parse(start);
  return () => new Date(base + offset++ * 1_000).toISOString();
}
