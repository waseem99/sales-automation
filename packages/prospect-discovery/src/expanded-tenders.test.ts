import assert from 'node:assert/strict';
import {
  collectExpandedPublicTenderCandidates,
  EXPANDED_PUBLIC_TENDER_SOURCES,
  isTrustedSourceUrl,
} from './expanded-tenders.js';

assert.ok(EXPANDED_PUBLIC_TENDER_SOURCES.some((source) => source.portal === 'Punjab PPRA'));
assert.ok(EXPANDED_PUBLIC_TENDER_SOURCES.some((source) => source.portal === 'BC Bid'));
assert.ok(EXPANDED_PUBLIC_TENDER_SOURCES.some((source) => source.portal.includes('municipal')));
assert.equal(isTrustedSourceUrl('https://ppra.punjab.gov.pk/tenders/software-rfp', ['ppra.punjab.gov.pk']), true);
assert.equal(isTrustedSourceUrl('https://buyer.university.edu.pk/procurement/rfp', ['.edu.pk']), true);
assert.equal(isTrustedSourceUrl('https://attacker.example.com/?next=ppra.punjab.gov.pk', ['ppra.punjab.gov.pk']), false);

const fetchImpl: typeof fetch = async (input) => {
  const url = new URL(String(input));
  const query = decodeURIComponent(url.searchParams.get('q') ?? '');
  let item = '';
  if (query.includes('ppra.punjab.gov.pk')) {
    item = `<item><title>Request for Proposal — Digital Services Portal</title><link>https://ppra.punjab.gov.pk/tenders/digital-portal-rfp</link><description>Punjab public buyer request for proposal for software development, web portal implementation and support.</description><pubDate>Tue, 14 Jul 2026 10:00:00 GMT</pubDate></item>`;
  } else if (query.includes('bcbid.gov.bc.ca')) {
    item = `<item><title>RFP — Application Modernization Services</title><link>https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/204001</link><description>Formal RFP for application development, system integration and cloud migration services.</description><pubDate>Tue, 14 Jul 2026 10:00:00 GMT</pubDate></item>`;
  } else if (query.includes('bidsandtenders.ca')) {
    item = `<item><title>Hospital Digital Platform RFP</title><link>https://malicious.example.net/copied-rfp</link><description>Hospital request for proposal for a software platform.</description><pubDate>Tue, 14 Jul 2026 10:00:00 GMT</pubDate></item>`;
  }
  return new Response(`<?xml version="1.0"?><rss><channel>${item}</channel></rss>`, {
    status: 200,
    headers: { 'content-type': 'application/rss+xml' },
  });
};

const result = await collectExpandedPublicTenderCandidates(fetchImpl);
assert.equal(result.candidates.some((candidate) => candidate.tender?.portal === 'Punjab PPRA'), true);
assert.equal(result.candidates.some((candidate) => candidate.tender?.portal === 'BC Bid'), true);
assert.equal(result.candidates.some((candidate) => candidate.sourceUrl.includes('malicious.example.net')), false);
assert.ok(result.candidates.every((candidate) => candidate.sourceType === 'procurement'));
assert.ok(result.candidates.every((candidate) => candidate.opportunityStatus === 'live_opportunity'));

console.log('Trusted Pakistan and Canada expanded tender source tests passed');
