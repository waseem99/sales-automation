import assert from 'node:assert/strict';
import type { DiscoveryCandidate } from './types.js';
import {
  analyzeTenderText,
  enrichTenderDocumentIntelligence,
  extractTextFromPdfBytes,
  withAmendmentStatus,
} from './tender-documents.js';

const checkedAt = '2026-07-14T19:00:00.000Z';
const candidate: DiscoveryCandidate = {
  sourceName: 'Official buyer portal',
  sourceType: 'procurement',
  sourceUrl: 'https://buyer.example.ca/procurement/rfp-26-104',
  title: 'RFP 26-104 — Digital Service Platform',
  summary: 'Formal RFP for design and implementation of a citizen digital service platform.',
  companyName: 'Example Municipality',
  country: 'Canada',
  opportunityStatus: 'live_opportunity',
  tender: {
    portal: 'Example Municipality Procurement',
    reference: 'RFP-26-104',
    sector: 'public',
    opportunityType: 'rfp',
    deadline: '2026-08-15T17:00:00.000Z',
  },
};

const html = `<!doctype html><html><body>
<h1>RFP 26-104</h1>
<h2>Scope of Work</h2><p>The selected vendor will design, develop, integrate and deploy a secure citizen digital service platform.</p>
<h2>Deliverables</h2><ul><li>Design user-centred web and mobile interfaces.</li><li>Implement the platform and integrate the municipal CRM.</li><li>Provide training, maintenance and knowledge transfer.</li></ul>
<h2>Eligibility</h2><ul><li>Must have completed three similar projects in the last five years.</li><li>Provide audited financial statements and corporate registration.</li></ul>
<h2>Evaluation Criteria</h2><ul><li>Technical proposal: 70 points.</li><li>Financial proposal: 30 points.</li></ul>
<p>Key personnel: Project Manager, Solution Architect, UI/UX Specialist, Software Developers and QA Engineer. Submit 5 CVs.</p>
<p>Bid security: CAD 25,000.</p>
<p>Questions deadline: July 28, 2026.</p>
<p>Submit proposals through the official online procurement portal.</p>
<p>Consortium and subcontracting arrangements are allowed.</p>
<a href="/documents/rfp-26-104.pdf">Download RFP document</a>
</body></html>`;

const pdf = `%PDF-1.4
1 0 obj
<< /Length 260 >>
stream
BT
/F1 12 Tf
72 720 Td
(Terms of Reference. The vendor shall implement a digital platform and migrate legacy data.) Tj
0 -18 Td
(Deliverables: configure hosting, integrate APIs, train users and provide twelve months support.) Tj
0 -18 Td
(Eligibility: minimum five years experience and two similar assignments.) Tj
0 -18 Td
(Evaluation criteria: technical proposal 80 points and financial proposal 20 points.) Tj
ET
endstream
endobj
%%EOF`;

const pdfText = extractTextFromPdfBytes(new TextEncoder().encode(pdf));
assert.match(pdfText, /implement a digital platform/i);
assert.match(pdfText, /technical proposal 80 points/i);

const fetchImpl: typeof fetch = async (input) => {
  const url = String(input);
  if (url === candidate.sourceUrl) {
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  if (url === 'https://buyer.example.ca/documents/rfp-26-104.pdf') {
    return new Response(new TextEncoder().encode(pdf), { status: 200, headers: { 'content-type': 'application/pdf' } });
  }
  return new Response('Not found', { status: 404 });
};

const enriched = await enrichTenderDocumentIntelligence(fetchImpl, candidate, checkedAt);
const intelligence = enriched.tender?.documentIntelligence;
assert.ok(intelligence);
assert.equal(intelligence.format, 'pdf_text');
assert.ok(intelligence.contentHash);
assert.ok(intelligence.documentUrls.includes(candidate.sourceUrl));
assert.ok(intelligence.documentUrls.includes('https://buyer.example.ca/documents/rfp-26-104.pdf'));
assert.match(intelligence.scopeSummary ?? '', /digital service platform/i);
assert.ok(intelligence.deliverables.some((item) => /integrate/i.test(item)));
assert.ok(intelligence.eligibilityRequirements.some((item) => /similar projects|similar assignments/i.test(item)));
assert.ok(intelligence.evaluationCriteria.some((item) => /technical proposal/i.test(item)));
assert.ok(intelligence.requiredTeamRoles.includes('Project Manager'));
assert.ok(intelligence.requiredTeamRoles.includes('Software/Solution Architect'));
assert.equal(intelligence.requiredCvCount, 5);
assert.match(intelligence.bidSecurity ?? '', /CAD 25,000/i);
assert.match(intelligence.submissionMethod ?? '', /online procurement portal/i);
assert.match(intelligence.bidNoBidBrief, /BID \/ NO-BID BRIEF/);
assert.match(intelligence.bidNoBidBrief, /Human decision required/);
assert.equal(intelligence.amendmentStatus, 'new');
assert.ok(intelligence.citations.length >= 2);

const updated = withAmendmentStatus(intelligence, 'changed', 'Deadline or mandatory requirements changed in the latest retained document.');
assert.equal(updated.amendmentStatus, 'changed');
assert.match(updated.bidNoBidBrief, /Amendment status: changed/);

const sparse = analyzeTenderText({
  candidate,
  checkedAt,
  format: 'notice_summary',
  text: 'Formal RFP for software services. Closing date August 15, 2026.',
});
assert.ok(sparse.missingInformation.some((item) => /eligibility/i.test(item)));
assert.match(sparse.bidNoBidBrief, /Confirm mandatory eligibility/i);

console.log('Tender HTML, text-PDF extraction, structured brief and amendment tests passed');
