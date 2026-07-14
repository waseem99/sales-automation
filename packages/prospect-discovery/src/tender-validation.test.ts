import assert from 'node:assert/strict';
import type { DiscoveryCandidate } from './types.js';
import { validateTenderCandidate } from './tender-validation.js';

const falsePositives: DiscoveryCandidate[] = [
  candidate(
    'https://www.merriam-webster.com/thesaurus/request',
    'Request synonyms and antonyms',
    'A thesaurus entry defining request and related words.',
    'Private and nonprofit public notices',
  ),
  candidate(
    'https://remoteok.com/remote-jobs/remote-assistente-de-gente-e-cultura-junior-joyn-group-1134711',
    'Assistente de Gente e Cultura Junior',
    'Remote job opening. Apply now for a people and culture role.',
    'Private and nonprofit public notices',
  ),
  candidate(
    'https://www.runoob.com/python3/python-requests.html',
    'Python Requests tutorial',
    'Learn Python requests with code examples and documentation.',
    'Private and nonprofit public notices',
  ),
  candidate(
    'https://blog.csdn.net/python03012/article/details/137588709',
    'Python requests article',
    'Python tutorial and programming guide.',
    'Private and nonprofit public notices',
  ),
];

for (const item of falsePositives) {
  const result = validateTenderCandidate(item);
  assert.equal(result.qualified, false, `${item.sourceUrl} must be rejected`);
  assert.equal(result.hardReject, true, `${item.sourceUrl} must be a hard rejection`);
}

const validPpra = candidate(
  'https://epms.ppra.gov.pk/public/tenders/tender-details/TS123456E',
  'Request for Proposal for development of a management information system',
  'Technical and financial proposals are invited for software development. Submission deadline 30 July 2026.',
  'Pakistan PPRA/EPADS',
  'TS123456E',
  '2026-07-30T12:00:00.000Z',
);
assert.equal(validateTenderCandidate(validPpra).qualified, true);

const validPunjab = candidate(
  'https://ppra.punjab.gov.pk/tenders/digital-services-platform',
  'RFP for digital services platform implementation',
  'Formal procurement notice for software development and system integration services.',
  'Punjab PPRA',
);
assert.equal(validateTenderCandidate(validPunjab).qualified, true);

const fakePunjab = candidate(
  'https://ppra-punjab.example.com/copied-tender',
  validPunjab.title,
  validPunjab.summary,
  'Punjab PPRA',
);
assert.equal(validateTenderCandidate(fakePunjab).qualified, false);
assert.equal(validateTenderCandidate(fakePunjab).hardReject, true);

const validEducation = candidate(
  'https://procurement.exampleuniversity.edu.pk/rfp/digital-campus',
  'Request for Proposal for a digital campus portal',
  'Procurement notice for web portal and application development services.',
  'Pakistan education and health public buyers',
);
assert.equal(validateTenderCandidate(validEducation).qualified, true);

const validCanada = candidate(
  'https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/pw-26-12345',
  'RFP for web portal and application development services',
  'The contracting authority requests technical proposals for a digital platform. Closing date 20 August 2026.',
  'CanadaBuys',
  'PW-26-12345',
  '2026-08-20T20:00:00.000Z',
);
assert.equal(validateTenderCandidate(validCanada).qualified, true);

const validBcBid = candidate(
  'https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/204001',
  'RFP for application modernization services',
  'Formal procurement notice for software development, cloud migration and system integration.',
  'BC Bid',
);
assert.equal(validateTenderCandidate(validBcBid).qualified, true);

const validFrench = candidate(
  'https://www.seao.ca/OpportunityPublication/avisConsultes/12345',
  'Appel d’offres — plateforme numérique',
  'Demande de propositions pour le développement de logiciel et des services informatiques. Date limite à confirmer.',
  'SEAO Quebec',
);
assert.equal(validateTenderCandidate(validFrench).qualified, true);

const fakeCanadaHost = candidate(
  'https://example-blog.com/canada-rfp-guide',
  validCanada.title,
  validCanada.summary,
  'CanadaBuys',
  'PW-26-12345',
  '2026-08-20T20:00:00.000Z',
);
const fakeCanadaValidation = validateTenderCandidate(fakeCanadaHost);
assert.equal(fakeCanadaValidation.qualified, false);
assert.equal(fakeCanadaValidation.hardReject, true);

const validNonprofit = candidate(
  'https://examplefoundation.org/procurement/rfp-digital-platform',
  'Request for Proposal: nonprofit digital platform development',
  'Technical proposal and financial proposal are required for web application development. Closing date 25 August 2026.',
  'Private and nonprofit public notices',
  'RFP-2026-14',
  '2026-08-25T17:00:00.000Z',
);
assert.equal(validateTenderCandidate(validNonprofit).qualified, true);

console.log('strict and expanded tender validation false-positive tests passed');

function candidate(
  sourceUrl: string,
  title: string,
  summary: string,
  portal: string,
  reference?: string,
  deadline?: string,
): DiscoveryCandidate {
  return {
    sourceName: portal,
    sourceType: 'procurement',
    sourceUrl,
    title,
    summary,
    opportunityStatus: 'live_opportunity',
    tender: {
      portal,
      reference,
      deadline,
      sector: portal.includes('PPRA') || portal.includes('Canada') || portal.includes('Bid') || portal.includes('SEAO') || portal.includes('education') ? 'public' : 'nonprofit',
      opportunityType: 'rfp',
    },
  };
}
